/**
 * MOTOR 2 behind a worker, with a main-thread fallback.
 *
 * Two responsibilities beyond forwarding messages:
 *
 *  1. **Memoise by window identity.** The combiner calls `detect(frames)` once per
 *     frame while it stays on the polyphonic decision — up to four times with the
 *     *same* window. In-process, `BasicPitchDetector` catches that by array
 *     identity; across a worker boundary every message is a fresh copy, so without
 *     memoising here the same two seconds of audio would be run through the
 *     network four times.
 *  2. **Degrade rather than fail, including on a hang.** Module workers need
 *     Safari 15+, a same-origin script and a working import graph — and even with
 *     all of that, TensorFlow.js initialising inside a worker is not something
 *     this project can claim to have verified: in testing the first inference
 *     never returned, with no error to catch. An `error` listener is therefore not
 *     enough. Every request is time-bounded, and a request that does not answer
 *     retires the worker for good and continues in-page.
 *
 *     Consequence worth stating: the worker is an optimisation, never a
 *     dependency. Chord practice works either way; off the main thread it just
 *     does not cost animation frames.
 */
import type { DetectedNote, PolyphonicDetector, AudioFrame } from "@arpeggio/practice-engine";

import type { PolyRequest, PolyResponse } from "./polyWorker.js";

export interface WorkerPolyOptions {
  /** URL of the Basic Pitch model, resolved against the document base. */
  modelUrl: string;
  /** URL of the bundled worker script. */
  workerUrl: string;
  /** Called with each real detection, for the UI. */
  onDetect?: (notes: DetectedNote[]) => void;
}

/**
 * Time budget for a worker reply.
 *
 * The first request still pays for the model download and the backend starting
 * up — but it now happens during {@link WorkerPolyDetector.warmUp}, before the
 * learner plays anything, so nothing is waiting on it. During practice a reply
 * slower than a couple of seconds is useless anyway: the note it describes is
 * long gone.
 */
const FIRST_BUDGET_MS = 20000;
const LATE_BUDGET_MS = 2500;

/** A second of silence at the microphone's usual rate, to force a first inference. */
const WARMUP_SAMPLE_RATE = 44100;
const WARMUP_FRAMES = 4;
const WARMUP_FRAME_SAMPLES = 2048;

export class WorkerPolyDetector implements PolyphonicDetector {
  private worker: Worker | null = null;
  /** Set once the worker has answered at least one request. */
  private answered = false;
  /** Set once a real inference has completed, by either path. */
  private warm = false;
  /** The warm-up in flight, so it is only ever started once. */
  private warming: Promise<void> | null = null;
  /** Set once the worker path is known to be unusable. */
  private fallback: PolyphonicDetector | null = null;
  private nextId = 1;
  private readonly pending = new Map<
    number,
    { resolve: (notes: DetectedNote[]) => void; reject: (err: Error) => void }
  >();

  private lastFrames: AudioFrame[] | null = null;
  private lastResult: DetectedNote[] = [];

  constructor(private readonly opts: WorkerPolyOptions) {
    try {
      this.worker = new Worker(opts.workerUrl, { type: "module" });
      this.worker.addEventListener("message", (e: MessageEvent<PolyResponse>) =>
        this.onMessage(e.data),
      );
      // A worker that dies (import failure, out of memory) must not hang the
      // practice loop: reject everything in flight and switch to in-page.
      this.worker.addEventListener("error", () => void this.degrade("worker failed to load"));
      this.post({ type: "init", modelUrl: opts.modelUrl });
    } catch {
      this.worker = null;
    }
  }

  /** True while inference is running off the main thread. */
  get offThread(): boolean {
    return this.worker !== null && this.fallback === null;
  }

  /**
   * False until a real inference has completed once.
   *
   * The combiner reads this and simply does not escalate while it is false, so
   * a model that is still downloading — or a worker that turns out never to
   * answer — costs the practice loop nothing at all. It stays on MOTOR 1, which
   * cannot hear chords but can hear the note the learner just played.
   */
  get ready(): boolean {
    return this.warm;
  }

  /**
   * Load the model and run one inference on silence.
   *
   * Called when a microphone session starts, so the whole cost lands during the
   * count-in instead of under the learner's first chord. Never throws: a warm-up
   * that fails simply leaves `ready` false for ever, and practice continues on
   * MOTOR 1.
   */
  warmUp(): Promise<void> {
    if (this.warming) return this.warming;
    this.warming = (async () => {
      const silence: AudioFrame[] = Array.from({ length: WARMUP_FRAMES }, (_, i) => ({
        samples: new Float32Array(WARMUP_FRAME_SAMPLES),
        sampleRate: WARMUP_SAMPLE_RATE,
        timeSec: (i * WARMUP_FRAME_SAMPLES) / WARMUP_SAMPLE_RATE,
      }));
      try {
        // Twice: the first attempt may discover that the worker is unusable and
        // switch to the in-page detector, and it is the surviving path that has
        // to be warm — not the one that just failed.
        await this.run(silence);
        if (!this.warm) await this.run(silence);
      } catch {
        // Left cold on purpose: see the doc comment.
      }
    })();
    return this.warming;
  }

  async detect(frames: AudioFrame[]): Promise<DetectedNote[]> {
    if (frames.length === 0) return [];
    if (frames === this.lastFrames) return this.lastResult.map((n) => ({ ...n }));

    const notes = await this.run(frames);
    this.lastFrames = frames;
    this.lastResult = notes;
    if (notes.length > 0) this.opts.onDetect?.(notes.map((n) => ({ ...n })));
    return notes.map((n) => ({ ...n }));
  }

  reset(): void {
    this.lastFrames = null;
    this.lastResult = [];
    this.post({ type: "reset" });
    (this.fallback as { reset?: () => void } | null)?.reset?.();
  }

  /** Release the worker thread. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.pending.clear();
  }

  // --- internals ------------------------------------------------------------

  private async run(frames: AudioFrame[]): Promise<DetectedNote[]> {
    if (this.worker && !this.fallback) {
      const id = this.nextId++;
      // The first request pays for the model download and the backend coming up;
      // after that, anything slower than a couple of seconds is useless anyway,
      // because the note it describes is long gone.
      const budgetMs = this.answered ? LATE_BUDGET_MS : FIRST_BUDGET_MS;
      try {
        const notes = await new Promise<DetectedNote[]>((resolve, reject) => {
          const timer = window.setTimeout(
            () => reject(new Error(`worker did not answer in ${budgetMs} ms`)),
            budgetMs,
          );
          this.pending.set(id, {
            resolve: (value) => {
              window.clearTimeout(timer);
              resolve(value);
            },
            reject: (err) => {
              window.clearTimeout(timer);
              reject(err);
            },
          });
          // Copy, not transfer: these arrays belong to the practice loop.
          this.post({
            type: "detect",
            id,
            frames: frames.map((f) => ({
              samples: new Float32Array(f.samples),
              sampleRate: f.sampleRate,
              timeSec: f.timeSec,
            })),
          });
        });
        this.answered = true;
        this.warm = true;
        return notes;
      } catch {
        this.pending.delete(id);
        await this.degrade("worker inference unavailable");
        this.warm = false;
        // Drop this window rather than re-running it in-page: by the time the
        // fallback has loaded, the audio it describes is stale, and the follower
        // simply does not advance on a window it never hears about.
        return [];
      }
    }
    const local = await this.ensureFallback();
    const notes = await local.detect(frames);
    this.warm = true;
    return notes;
  }

  private onMessage(message: PolyResponse): void {
    if (message.type === "ready") return;
    const entry = this.pending.get(message.id);
    if (!entry) return;
    this.pending.delete(message.id);
    if (message.type === "result") entry.resolve(message.notes);
    else entry.reject(new Error(message.message));
  }

  private async degrade(reason: string): Promise<void> {
    const error = new Error(reason);
    for (const [, entry] of this.pending) entry.reject(error);
    this.pending.clear();
    this.worker?.terminate();
    this.worker = null;
    await this.ensureFallback();
  }

  private async ensureFallback(): Promise<PolyphonicDetector> {
    if (!this.fallback) {
      const { BasicPitchDetector } = await import("@arpeggio/motor2-basicpitch");
      this.fallback = new BasicPitchDetector({ modelUrl: this.opts.modelUrl });
    }
    return this.fallback;
  }

  private post(message: PolyRequest): void {
    this.worker?.postMessage(message);
  }
}
