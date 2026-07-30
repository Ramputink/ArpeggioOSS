/**
 * audio.ts — browser audio capture for the practice loop.
 *
 * Exposes two `FrameSource` implementations (see contracts.ts):
 *   - MicSource: real microphone capture via the Web Audio API.
 *   - SimSource: a mic-less simulator that synthesizes the expected melody so
 *     the whole practice loop is demoable and testable without any hardware.
 *
 * Both emit `AudioFrame`s of ~2048 mono Float32 samples to an `onFrame`
 * callback, tagged with the sample rate and a monotonically increasing
 * `timeSec` on the audio clock.
 */

import type { AudioFrame } from "@arpeggio/practice-engine";
import { expectedNotesFromScore } from "@arpeggio/practice-engine";
import type { Score } from "@arpeggio/musicxml-parser";
import type { FrameSource } from "./contracts.js";

/** Frames are ~2048 samples: a good latency/resolution tradeoff for YIN. */
const FRAME_SIZE = 2048;

/**
 * Minimal structural type for `webkitAudioContext`, the prefixed constructor
 * still needed by older Safari/iOS builds where `window.AudioContext` is absent.
 */
interface WebkitWindow {
  webkitAudioContext?: typeof AudioContext;
}

/** Resolve the (possibly prefixed) AudioContext constructor, or null. */
function resolveAudioContext(): typeof AudioContext | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as WebkitWindow).webkitAudioContext ?? null;
}

/** MIDI note number -> frequency in Hz (A4 = 69 = 440 Hz). */
function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// MicSource — real microphone
// ---------------------------------------------------------------------------

/**
 * Captures live microphone audio and emits mono Float32 frames.
 *
 * Implementation note: this uses a `ScriptProcessorNode`, which is deprecated
 * but requires no separate worklet module — keeping the esbuild bundle fully
 * self-contained (no extra file to serve at a fixed URL). The production
 * upgrade is an `AudioWorkletNode` loaded via `audioWorklet.addModule(...)`,
 * which runs capture off the main thread for lower, more stable latency.
 */
export class MicSource implements FrameSource {
  private _label = "idle";
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private sink: GainNode | null = null;
  /** Set by stop(); if it flips during the async getUserMedia prompt we must
   *  release the just-granted stream instead of leaking an open microphone. */
  private stopped = false;

  get label(): string {
    return this._label;
  }

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    this.stopped = false;
    // Guard against environments without the Web Audio API entirely.
    const Ctx = resolveAudioContext();
    if (!Ctx || typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      this._label = "audio capture unsupported";
      throw new Error(this._label);
    }

    // Request the raw signal: disable the browser's voice-oriented DSP, which
    // would otherwise distort pitch/onset detection.
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
    } catch (err) {
      // Permission denied, no device, or device in use.
      this._label = this.describeGetUserMediaError(err);
      // Re-throw so the UI can surface the failure to the user.
      throw err instanceof Error ? err : new Error(this._label);
    }

    // If practice was stopped while the permission prompt was open, don't build
    // the graph — release the microphone we were just granted and bail.
    if (this.stopped) {
      this.stream.getTracks().forEach((track) => track.stop());
      this.stream = null;
      this._label = "stopped";
      return;
    }

    try {
      this.ctx = new Ctx();
      // Safari/iOS start the context suspended; it can only be resumed from a
      // user-gesture call stack (which start() is expected to be invoked from).
      if (this.ctx.state === "suspended") {
        await this.ctx.resume();
      }

      const ctx = this.ctx;
      this.source = ctx.createMediaStreamSource(this.stream);

      // 2048 buffer, 1 input channel, 1 output channel.
      this.processor = ctx.createScriptProcessor(FRAME_SIZE, 1, 1);
      this.processor.onaudioprocess = (event: AudioProcessingEvent) => {
        const input = event.inputBuffer.getChannelData(0);
        // Copy: the event buffer is a live view reused across callbacks, so we
        // must not retain it — hand the consumer its own Float32Array.
        const samples = new Float32Array(input.length);
        samples.set(input);
        onFrame({
          samples,
          sampleRate: ctx.sampleRate,
          timeSec: ctx.currentTime,
        });
      };

      // A zero-gain sink so the graph reaches a destination and the processor
      // actually runs, without playing the mic back through the speakers.
      this.sink = ctx.createGain();
      this.sink.gain.value = 0;

      this.source.connect(this.processor);
      this.processor.connect(this.sink);
      this.sink.connect(ctx.destination);

      // A stop() that landed during ctx.resume() await: tear down now.
      if (this.stopped) {
        this.stop();
        return;
      }
      this._label = "listening";
    } catch (err) {
      // Something in the graph setup failed — clean up and report.
      this.stop();
      this._label = "audio setup failed";
      throw err instanceof Error ? err : new Error(this._label);
    }
  }

  stop(): void {
    this.stopped = true;
    // Disconnect nodes (order doesn't matter; guard each for partial setup).
    this.processor?.disconnect();
    if (this.processor) this.processor.onaudioprocess = null;
    this.source?.disconnect();
    this.sink?.disconnect();
    this.processor = null;
    this.source = null;
    this.sink = null;

    // Release the microphone so the OS/hardware indicator turns off.
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;

    // Close the context to free the audio thread.
    if (this.ctx && this.ctx.state !== "closed") {
      // close() returns a promise; we don't need to await it during teardown.
      void this.ctx.close();
    }
    this.ctx = null;

    if (this._label === "listening") this._label = "stopped";
  }

  /** Map a getUserMedia rejection to a short, UI-friendly label. */
  private describeGetUserMediaError(err: unknown): string {
    const name = err instanceof Error ? err.name : "";
    switch (name) {
      case "NotAllowedError":
      case "SecurityError":
        return "microphone blocked";
      case "NotFoundError":
      case "OverconstrainedError":
        return "no microphone found";
      case "NotReadableError":
        return "microphone in use";
      default:
        return "microphone unavailable";
    }
  }
}

// ---------------------------------------------------------------------------
// SimSource — mic-less simulator
// ---------------------------------------------------------------------------

/** One expected note projected to the minimum the simulator needs. */
interface SimNote {
  midi: number;
  /** Onset in quarter-note beats. */
  onset: number;
}

/** Options controlling the simulated performance. */
export interface SimOptions {
  /** Playback tempo in quarter-note beats per minute (default 90). */
  bpm?: number;
  /** Probability in [0, 1] of playing a wrong pitch for a given note. */
  errorRate?: number;
}

/**
 * Synthesizes the score's melody as audio frames in near-real-time, so the
 * follower advances and the cursor moves without any microphone. Useful for
 * demos, automated tests, and developing on machines with no audio input.
 *
 * The simulation is monophonic: it takes the top (highest) note of each onset
 * so chords collapse to their melody line.
 */
export class SimSource implements FrameSource {
  readonly label = "simulating";

  private readonly melody: SimNote[];
  private readonly bpm: number;
  private readonly errorRate: number;
  private readonly sampleRate = 44100;
  /**
   * Frames of sine synthesized per note. A multiple of the consumer's window
   * size (LivePractice batches 4 frames) so every note's frames form complete
   * windows and none are left in a trailing partial window — otherwise the last
   * note could be dropped and the follower would never reach `done`.
   */
  private readonly framesPerNote = 8;

  private timers: ReturnType<typeof setTimeout>[] = [];
  private running = false;
  /** Last emitted timeSec, to keep the synthetic clock strictly increasing. */
  private lastTimeSec = -1;

  constructor(score: Score, opts: SimOptions = {}) {
    this.bpm = opts.bpm ?? 90;
    this.errorRate = Math.min(1, Math.max(0, opts.errorRate ?? 0));
    this.melody = SimSource.buildMelody(score);
  }

  /**
   * Project a `Score` to a monophonic melody: group expected notes by onset and
   * keep the highest MIDI in each group. `expectedNotesFromScore` returns notes
   * sorted by onset then MIDI ascending, so the top note is the last of a group.
   */
  private static buildMelody(score: Score): SimNote[] {
    const expected = expectedNotesFromScore(score);
    const melody: SimNote[] = [];
    const chordEpsilon = 1e-3;
    for (const note of expected) {
      const prev = melody[melody.length - 1];
      if (prev && Math.abs(note.onset - prev.onset) <= chordEpsilon) {
        // Same onset: keep the higher pitch (ascending order => overwrite).
        if (note.midi > prev.midi) prev.midi = note.midi;
      } else {
        melody.push({ midi: note.midi, onset: note.onset });
      }
    }
    return melody;
  }

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    this.running = true;
    this.lastTimeSec = -1;
    if (this.melody.length === 0) return;

    const beatSec = 60 / this.bpm;
    const frameDurSec = FRAME_SIZE / this.sampleRate;
    // Normalize so the first note starts at t = 0 on the synthetic clock.
    const firstOnset = this.melody[0].onset;

    for (const note of this.melody) {
      // With errorRate, occasionally substitute a nearby wrong pitch so the
      // follower emits a "wrong" judgement and adaptation has something to see.
      const playedMidi =
        this.errorRate > 0 && Math.random() < this.errorRate
          ? note.midi + (Math.random() < 0.5 ? -1 : 2)
          : note.midi;

      // Real (wall-clock) time this note should sound, scaled by tempo.
      const noteStartSec = (note.onset - firstOnset) * beatSec;
      const timer = setTimeout(
        () => {
          if (!this.running) return;
          this.emitBurst(onFrame, playedMidi, noteStartSec, frameDurSec);
        },
        Math.max(0, noteStartSec * 1000),
      );
      this.timers.push(timer);
    }
  }

  /** Emit `framesPerNote` sine frames for one note, on a monotonic clock. */
  private emitBurst(
    onFrame: (frame: AudioFrame) => void,
    midi: number,
    noteStartSec: number,
    frameDurSec: number,
  ): void {
    const hz = midiToHz(midi);
    for (let k = 0; k < this.framesPerNote; k++) {
      // Derive timeSec from the beat clock, but clamp to strictly exceed the
      // last emitted time so a fast tempo (where consecutive note bursts would
      // otherwise overlap in time) can't make the clock step backwards.
      const timeSec = Math.max(noteStartSec + k * frameDurSec, this.lastTimeSec + frameDurSec);
      this.lastTimeSec = timeSec;
      const samples = this.synthesize(hz, timeSec);
      onFrame({ samples, sampleRate: this.sampleRate, timeSec });
    }
  }

  /** Fill one frame with a sine at `hz`, phase-continuous via absolute time. */
  private synthesize(hz: number, startSec: number): Float32Array {
    const samples = new Float32Array(FRAME_SIZE);
    const twoPiF = 2 * Math.PI * hz;
    for (let i = 0; i < FRAME_SIZE; i++) {
      const t = startSec + i / this.sampleRate;
      // Modest amplitude keeps it clearly voiced but away from clipping.
      samples[i] = 0.6 * Math.sin(twoPiF * t);
    }
    return samples;
  }

  stop(): void {
    this.running = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.timers = [];
  }
}

// ---------------------------------------------------------------------------
// ChordSource — synthetic polyphonic test signal (mic-less MOTOR 2 check)
// ---------------------------------------------------------------------------

/** Options for {@link ChordSource}. */
export interface ChordOptions {
  /** Sample rate of the synthesized audio (default 44100). */
  sampleRate?: number;
  /** How long to sustain the chord, in seconds (default 3). */
  durationSec?: number;
}

/**
 * Emits a sustained, harmonically-rich chord as audio frames, so the real
 * MOTOR 2 (Basic Pitch) can be exercised end-to-end in the browser WITHOUT a
 * microphone or a physical piano. Unlike {@link SimSource} (which collapses to a
 * monophonic melody), this deliberately sounds several pitches at once — the
 * whole point of MOTOR 2.
 *
 * Each note is a fundamental plus a few decaying harmonics, which reads to Basic
 * Pitch far more like a piano than a bare sine would.
 */
export class ChordSource implements FrameSource {
  readonly label = "chord test";

  private readonly midis: number[];
  private readonly sampleRate: number;
  private readonly durationSec: number;
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  constructor(midis: number[] = [60, 64, 67], opts: ChordOptions = {}) {
    this.midis = midis;
    this.sampleRate = opts.sampleRate ?? 44100;
    this.durationSec = opts.durationSec ?? 3;
  }

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    this.running = true;
    const totalFrames = Math.ceil((this.durationSec * this.sampleRate) / FRAME_SIZE);
    const frameDurSec = FRAME_SIZE / this.sampleRate;
    // Emit one LivePractice window (4 frames) per tick, in near-real-time, so
    // the detector's rolling ~2 s buffer fills just as it would from a mic.
    const framesPerTick = 4;
    let emitted = 0;
    this.timer = setInterval(
      () => {
        if (!this.running) return;
        for (let k = 0; k < framesPerTick && emitted < totalFrames; k++, emitted++) {
          const timeSec = emitted * frameDurSec;
          onFrame({ samples: this.synthesize(timeSec), sampleRate: this.sampleRate, timeSec });
        }
        if (emitted >= totalFrames) this.stop();
      },
      framesPerTick * frameDurSec * 1000,
    );
  }

  /** One frame: the sum of every chord tone, each with decaying harmonics. */
  private synthesize(startSec: number): Float32Array {
    const samples = new Float32Array(FRAME_SIZE);
    const harmonics = [1, 0.5, 0.25, 0.125]; // fundamental + 3 partials
    // Normalize so the summed chord stays well clear of clipping.
    const norm = 0.7 / (this.midis.length * harmonics.reduce((a, b) => a + b, 0));
    for (const midi of this.midis) {
      const hz = midiToHz(midi);
      for (let i = 0; i < FRAME_SIZE; i++) {
        const t = startSec + i / this.sampleRate;
        let s = 0;
        for (let h = 0; h < harmonics.length; h++) {
          s += harmonics[h] * Math.sin(2 * Math.PI * hz * (h + 1) * t);
        }
        samples[i] += s * norm;
      }
    }
    return samples;
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
