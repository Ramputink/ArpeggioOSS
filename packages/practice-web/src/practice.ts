/**
 * LivePractice — the live practice loop that binds an audio {@link FrameSource}
 * to the {@link PracticeSession} engine and drives the UI through
 * {@link PracticeCallbacks}.
 *
 *     FrameSource ─(frames)─► buffer ─(windows)─► PracticeSession.listen()
 *                                                        │
 *                                     PlayerEvent[] ─────┤─► callbacks.onEvents
 *                                     FollowState ───────┘─► callbacks.onProgress
 *
 * The audio callback stays cheap: it only appends to a buffer and kicks a
 * single-flight async "pump". The pump is the sole caller of `session.listen`,
 * so listen calls never overlap (see the serialization note below).
 */
import { PracticeSession, expectedNotesFromScore } from "@arpeggio/practice-engine";
import type { PolyphonicDetector } from "@arpeggio/practice-engine";
import type { Score } from "@arpeggio/musicxml-parser";

import type {
  AudioFrame,
  FrameSource,
  PlayerEvent,
  PracticeCallbacks,
} from "./contracts.js";

/**
 * Frames per processed window.
 *
 * Windowing choice: fixed frame count rather than a wall-clock timer. A count
 * needs no `setTimeout`/clock reads inside the hot audio callback, is fully
 * deterministic, and — since frames arrive at a steady rate — already bounds
 * latency to roughly this many frames' worth of audio (~4 frames is a note or
 * short slice, matching what `session.listen` expects to judge at once).
 */
const WINDOW_FRAMES = 4;

/** Construction knobs for {@link LivePractice}. */
export interface LivePracticeOptions {
  /**
   * Frames batched into one processed window. Fewer frames means lower latency
   * and more calls: a window cannot be judged until its last frame has been
   * captured, so at 2048 samples and 44.1 kHz each frame costs 46 ms before any
   * processing starts. 4 (the default) is ~186 ms of unavoidable delay, which is
   * fine when tapping a screen and clearly visible at a real piano; 2 halves it
   * and is the right choice for a monophonic line.
   */
  windowFrames?: number;
}

export class LivePractice {
  private readonly session: PracticeSession;
  /** Precomputed expected-note count — the practice "total" for progress. */
  private readonly total: number;
  private readonly callbacks: PracticeCallbacks;

  /** The active source, kept so `stop()` can stop it. */
  private source: FrameSource | null = null;
  /** Frames waiting to be batched into a window (queued, never dropped). */
  private buffer: AudioFrame[] = [];
  /** Single-flight guard: true while the pump loop owns `session.listen`. */
  private pumping = false;
  /** Set by `stop()` (or end-of-piece) to halt the pump and reject new work. */
  private stopped = false;
  /** Guards against emitting the final done-progress more than once. */
  private finished = false;
  /** Frames per processed window; see {@link LivePracticeOptions.windowFrames}. */
  private readonly windowFrames: number;

  /**
   * @param poly Optional real MOTOR 2 (polyphonic) detector. When omitted the
   *   session falls back to the built-in stub and only YIN (monophonic) runs —
   *   pass a `BasicPitchDetector` to actually transcribe chords.
   */
  constructor(
    score: Score,
    callbacks: PracticeCallbacks,
    poly?: PolyphonicDetector,
    opts: LivePracticeOptions = {},
  ) {
    this.session = new PracticeSession(score, poly ? { poly } : {});
    this.total = expectedNotesFromScore(score).length;
    this.callbacks = callbacks;
    this.windowFrames = Math.max(1, Math.round(opts.windowFrames ?? WINDOW_FRAMES));
  }

  /**
   * Start listening. Wires the source's frames into our buffer and begins
   * draining windows through the engine.
   */
  async start(source: FrameSource): Promise<void> {
    this.source = source;
    this.stopped = false;
    this.finished = false;
    await source.start((frame) => this.onFrame(frame));
  }

  /** Stop the source. Per contract this flushes nothing further. */
  stop(): void {
    this.stopped = true;
    this.source?.stop();
    this.source = null;
  }

  // --- UI HUD read helpers ---------------------------------------------------

  /** Overall accuracy = total correct / total attempts across all measures. */
  get accuracy(): number {
    let attempts = 0;
    let correct = 0;
    for (const stat of this.session.student.statsByMeasure().values()) {
      attempts += stat.attempts;
      correct += stat.correct;
    }
    return attempts > 0 ? correct / attempts : 0;
  }

  /** The (up to) three measures the student model suggests drilling next. */
  get recommend(): number[] {
    return this.session.student.recommendPractice(3);
  }

  /** True once the follower has reached the end of the piece. */
  get done(): boolean {
    return this.session.follower.state.done;
  }

  // --- Internals -------------------------------------------------------------

  /**
   * Hot path: keep it cheap. Just buffer the frame and nudge the pump. The
   * pump is single-flight, so this never launches an overlapping listen call.
   */
  private onFrame(frame: AudioFrame): void {
    if (this.stopped) return;
    this.buffer.push(frame);
    // Backpressure valve: if the engine can't keep up (e.g. Basic Pitch inference
    // in chord mode runs slower than real time on a weak device), the queue would
    // grow without bound and latency would climb forever. Cap it and drop the
    // OLDEST frames — a bounded lag beats an ever-growing one.
    const MAX_BUFFER_FRAMES = this.windowFrames * 8;
    if (this.buffer.length > MAX_BUFFER_FRAMES) {
      this.buffer.splice(0, this.buffer.length - MAX_BUFFER_FRAMES);
    }
    void this.pump();
  }

  /**
   * Drain full windows through `session.listen`, one at a time.
   *
   * Serialization choice: single-flight *queue* (not drop-if-busy). If a call
   * arrives while a window is in flight, `this.pumping` short-circuits it and
   * the already-running loop picks up the newly buffered frames on its next
   * iteration. Nothing overlaps and nothing is dropped — frames just wait their
   * turn in `this.buffer`. We queue rather than drop because dropped windows
   * would desynchronise the follower from the actual performance.
   */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.buffer.length >= this.windowFrames && !this.stopped) {
        const window = this.buffer.splice(0, this.windowFrames);
        await this.processWindow(window);
      }
    } finally {
      this.pumping = false;
    }
  }

  /** Feed one window to the engine and drive the UI callbacks from the result. */
  private async processWindow(window: AudioFrame[]): Promise<void> {
    const events: PlayerEvent[] = await this.session.listen(window);
    // Note: `stop()` may have run while we were awaiting; still deliver this
    // window's results so no judged events are silently lost.
    this.callbacks.onEvents(events);

    const state = this.session.follower.state;
    this.callbacks.onProgress({
      index: state.index,
      total: this.total,
      measure: state.measure,
      done: state.done,
      positionBeats: state.positionBeats,
    });

    // End of piece: stop the source and emit one final progress snapshot.
    if (state.done && !this.finished) {
      this.finished = true;
      this.stop();
      this.callbacks.onProgress({
        index: state.index,
        total: this.total,
        measure: state.measure,
        done: true,
        positionBeats: state.positionBeats,
      });
    }
  }
}
