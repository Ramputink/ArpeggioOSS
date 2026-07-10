/**
 * MOTOR 2 — real polyphonic transcription (Spotify Basic Pitch via TensorFlow.js).
 *
 * Implements the `PolyphonicDetector` seam from @arpeggio/practice-engine so it
 * drops straight into a `PracticeSession` (`new PracticeSession(score, { poly })`)
 * with no change to the combiner. This is the piece the cheap monophonic YIN
 * engine cannot do: left-hand chords / two-hand polyphony played into the mic.
 *
 * Two impedance mismatches between the practice loop and the model are resolved
 * here, inside `detect()`:
 *
 *  1. SAMPLE RATE. Basic Pitch runs at a fixed 22050 Hz and does NOT resample —
 *     `evaluateModel` asserts the rate on an AudioBuffer, and reads a Float32Array
 *     verbatim. The mic delivers frames at the AudioContext's native rate
 *     (44100/48000 Hz), so we resample to 22050 before inference.
 *
 *  2. WINDOW LENGTH. The model needs ~2 s of context (43844 samples @ 22050), but
 *     the practice loop hands us ~186 ms windows (4×2048 samples). So we keep a
 *     rolling ~2 s buffer of recent audio, run inference over the whole buffer,
 *     and emit only note onsets that fall past everything already reported — the
 *     overlapping buffers would otherwise re-report the same notes every call.
 *
 * The combiner may call `detect(frames)` several times with the SAME window inside
 * one `PracticeSession.listen()` (once per frame while the decision stays on poly).
 * Inference is expensive, so results are memoized by the `frames` array identity:
 * repeated calls with the same window return the cached notes and do NOT re-run the
 * model or re-append to the rolling buffer.
 *
 * The heavy `@spotify/basic-pitch` / `@tensorflow/tfjs` dependency is dynamically
 * imported only on the real inference path, and the transcription step is an
 * injectable seam (`opts.transcribe`) so the resampling / buffering / dedup logic
 * can be unit-tested headlessly without loading the ML runtime.
 */
import type {
  AudioFrame,
  DetectedNote,
  PolyphonicDetector,
} from "@arpeggio/practice-engine";
import type { NoteEventTime } from "@spotify/basic-pitch";

/** Fixed input sample rate of the Basic Pitch model. */
export const BASIC_PITCH_SAMPLE_RATE = 22050;

/** Mono @22050 Hz audio -> timed note events. The seam we mock in tests. */
export type Transcribe = (mono22k: Float32Array) => Promise<NoteEventTime[]>;

export interface BasicPitchDetectorOptions {
  /**
   * URL of the Basic Pitch TF.js GraphModel (`model.json` + weight shards).
   * Defaults to `/models/basic-pitch/model.json` (served from the web app's
   * `public/`). Ignored when `transcribe` is injected.
   */
  modelUrl?: string;
  /** Rolling context buffer length in seconds. Default 2 (the model's window). */
  contextSec?: number;
  /** Onset peak threshold for `outputToNotesPoly`. Default 0.5. */
  onsetThresh?: number;
  /** Frame threshold for `outputToNotesPoly`. Default 0.3. */
  frameThresh?: number;
  /** Drop notes whose amplitude/confidence is below this. Default 0 (keep all). */
  minConfidence?: number;
  /**
   * Injectable transcription seam. Defaults to Basic Pitch. Provide a fake in
   * tests to exercise the resample/buffer/dedup logic without the ML runtime.
   */
  transcribe?: Transcribe;
  /**
   * Called on every REAL detection (cache misses only) with the fresh notes.
   * Handy for a UI that wants to show MOTOR 2 fired and how many notes it heard.
   */
  onDetect?: (notes: DetectedNote[]) => void;
}

/**
 * Resample mono PCM to a new rate by linear interpolation.
 *
 * Adequate for feeding Basic Pitch in an MVP; it does no anti-alias low-pass, so
 * a polyphase / `OfflineAudioContext` resampler is a documented future upgrade
 * for downsampling quality.
 */
export function resampleLinear(
  input: Float32Array,
  fromRate: number,
  toRate: number,
): Float32Array {
  if (fromRate === toRate || input.length === 0) return input.slice();
  const ratio = toRate / fromRate;
  const outLen = Math.max(1, Math.round(input.length * ratio));
  const out = new Float32Array(outLen);
  const lastIn = input.length - 1;
  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = i0 < lastIn ? i0 + 1 : lastIn;
    const t = srcPos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/**
 * A note counts as "currently sounding" if its interval reaches within this many
 * seconds of the buffer's end (the recent moment). Notes that already finished
 * earlier in the buffer are not considered present.
 */
const RECENT_SEC = 0.25;

export class BasicPitchDetector implements PolyphonicDetector {
  private readonly modelUrl: string;
  private readonly contextSec: number;
  private readonly onsetThresh: number;
  private readonly frameThresh: number;
  private readonly minConfidence: number;
  private readonly transcribe: Transcribe;
  private readonly onDetect?: (notes: DetectedNote[]) => void;

  // Rolling buffer of recent audio at the mic's native rate.
  private buffer: Float32Array = new Float32Array(0);
  private nativeRate = 0;
  /** Audio-clock time (s) of the oldest sample currently in `buffer`. */
  private bufferStartSec = 0;
  /**
   * MIDI pitches believed to be currently sounding (from the previous window).
   * We dedup by presence, not by onset: a pitch is emitted only on the
   * transition from not-sounding to sounding. A held note/chord therefore fires
   * once — the onset-based scheme re-fired it every window once its true onset
   * scrolled out of the rolling buffer (its buffer-relative onset stays ≈0 while
   * `bufferStartSec` climbs, looking like an ever-newer attack).
   */
  private sounding = new Set<number>();

  // Per-window memoization (see class comment).
  private lastFrames: AudioFrame[] | null = null;
  private lastResult: DetectedNote[] = [];

  private enginePromise?: Promise<import("@spotify/basic-pitch").BasicPitch>;

  constructor(opts: BasicPitchDetectorOptions = {}) {
    this.modelUrl = opts.modelUrl ?? "/models/basic-pitch/model.json";
    this.contextSec = opts.contextSec ?? 2;
    this.onsetThresh = opts.onsetThresh ?? 0.5;
    this.frameThresh = opts.frameThresh ?? 0.3;
    this.minConfidence = opts.minConfidence ?? 0;
    this.transcribe = opts.transcribe ?? ((mono) => this.basicPitchTranscribe(mono));
    this.onDetect = opts.onDetect;
  }

  async detect(frames: AudioFrame[]): Promise<DetectedNote[]> {
    // Memo hit: same window as last call -> return cached notes, touch nothing.
    if (frames.length > 0 && frames === this.lastFrames) {
      return this.lastResult.map((n) => ({ ...n }));
    }
    if (frames.length === 0) return [];

    this.append(frames);

    const mono22k = resampleLinear(this.buffer, this.nativeRate, BASIC_PITCH_SAMPLE_RATE);
    const timed = await this.transcribe(mono22k);
    const bufDurSec = this.nativeRate > 0 ? this.buffer.length / this.nativeRate : 0;

    // Which pitches are sounding at the recent end of the buffer, keeping the
    // strongest event per pitch. `minConfidence` gates membership directly, so a
    // dropped note simply isn't "present" — it can neither be emitted nor block a
    // genuine later one (the old high-water mark advanced on dropped notes).
    const present = new Map<number, NoteEventTime>();
    for (const n of timed) {
      const confidence = clamp01(n.amplitude);
      if (confidence < this.minConfidence) continue;
      const endSec = n.startTimeSeconds + n.durationSeconds;
      if (endSec < bufDurSec - RECENT_SEC) continue; // finished earlier; not "now"
      const midi = Math.round(n.pitchMidi);
      const prev = present.get(midi);
      if (!prev || n.amplitude > prev.amplitude) present.set(midi, n);
    }

    // Emit only pitches that NEWLY appeared since the last window (a real attack).
    // Onset stays the model's buffer-relative time on the absolute audio clock,
    // which is accurate the moment a note first appears.
    const fresh: DetectedNote[] = [];
    for (const [midi, n] of present) {
      if (this.sounding.has(midi)) continue; // still ringing -> not a new attack
      const onsetSec = this.bufferStartSec + n.startTimeSeconds;
      fresh.push({
        midi,
        onsetSec,
        offsetSec: onsetSec + n.durationSeconds,
        confidence: clamp01(n.amplitude),
        engine: "poly",
      });
    }
    this.sounding = new Set(present.keys());
    // Order by onset, then by pitch so a chord's simultaneous notes come out
    // low-to-high deterministically (handy for the UI; the follower is order-
    // agnostic since it matches on pitch).
    fresh.sort((a, b) => a.onsetSec - b.onsetSec || a.midi - b.midi);

    this.lastFrames = frames;
    this.lastResult = fresh;
    if (fresh.length > 0) this.onDetect?.(fresh.map((n) => ({ ...n })));
    return fresh.map((n) => ({ ...n }));
  }

  /** Clear all rolling state between takes (e.g. when practice restarts). */
  reset(): void {
    this.buffer = new Float32Array(0);
    this.nativeRate = 0;
    this.bufferStartSec = 0;
    this.sounding.clear();
    this.lastFrames = null;
    this.lastResult = [];
  }

  // --- helpers --------------------------------------------------------------

  /** Append a window to the rolling buffer, trimming it to `contextSec`. */
  private append(frames: AudioFrame[]): void {
    const rate = frames[0].sampleRate;

    // If this window doesn't follow the buffer's end in time (a gap — e.g. the
    // combiner only escalates to poly intermittently in the mic mono-fallback
    // path), the buffer would splice non-adjacent audio and the onset clock would
    // be wrong. Drop the stale context and start fresh from this window.
    if (this.buffer.length > 0) {
      const bufferEndSec = this.bufferStartSec + this.buffer.length / this.nativeRate;
      const gapTol = (2 * frames[0].samples.length) / rate; // ~2 frames of slack
      if (rate !== this.nativeRate || Math.abs(frames[0].timeSec - bufferEndSec) > gapTol) {
        this.buffer = new Float32Array(0);
        this.sounding.clear();
      }
    }

    this.nativeRate = rate;
    if (this.buffer.length === 0) this.bufferStartSec = frames[0].timeSec;

    const incoming = frames.reduce((sum, f) => sum + f.samples.length, 0);
    const merged = new Float32Array(this.buffer.length + incoming);
    merged.set(this.buffer, 0);
    let off = this.buffer.length;
    for (const f of frames) {
      merged.set(f.samples, off);
      off += f.samples.length;
    }

    const maxSamples = Math.max(1, Math.round(this.contextSec * this.nativeRate));
    if (merged.length > maxSamples) {
      const drop = merged.length - maxSamples;
      this.buffer = merged.slice(drop);
      this.bufferStartSec += drop / this.nativeRate;
    } else {
      this.buffer = merged;
    }
  }

  /** The real Basic Pitch path (dynamically imported to keep tests light). */
  private async basicPitchTranscribe(mono22k: Float32Array): Promise<NoteEventTime[]> {
    const { BasicPitch, outputToNotesPoly, noteFramesToTime } = await import(
      "@spotify/basic-pitch"
    );
    if (!this.enginePromise) {
      this.enginePromise = Promise.resolve(new BasicPitch(this.modelUrl));
    }
    const engine = await this.enginePromise;

    const framesAcc: number[][] = [];
    const onsetsAcc: number[][] = [];
    await engine.evaluateModel(
      mono22k,
      (f, o) => {
        for (const row of f) framesAcc.push(row);
        for (const row of o) onsetsAcc.push(row);
      },
      () => {
        /* progress ignored */
      },
    );
    const notes = outputToNotesPoly(framesAcc, onsetsAcc, this.onsetThresh, this.frameThresh);
    return noteFramesToTime(notes);
  }
}

function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
