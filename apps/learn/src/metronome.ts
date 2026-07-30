/**
 * A metronome that does not drift.
 *
 * `setInterval` is the obvious implementation and the wrong one: timer callbacks
 * are throttled and jittered by whatever else the page is doing, so the click
 * wanders — and a click that wanders is worse than no click, because the learner
 * trusts it. Instead this schedules clicks *ahead* on the audio clock, which is
 * sample-accurate, and only uses a timer to decide when to schedule more.
 *
 *     wake every 120 ms ──► schedule every beat falling in the next 400 ms
 */
import type { Synth } from "./synth.js";

/** How far ahead beats are scheduled, and how often we top the queue up. */
const LOOKAHEAD_SEC = 0.4;
const TICK_MS = 120;

export class Metronome {
  private timer = 0;
  /** Audio-clock time of the next beat still to be scheduled. */
  private nextBeatTime = 0;
  /** Beat counter within the bar, for the accent. */
  private beat = 0;
  private secPerBeat = 0.5;
  private beatsPerBar = 4;

  constructor(private readonly synth: Synth) {}

  get running(): boolean {
    return this.timer !== 0;
  }

  /**
   * Start clicking. `startAt` is an audio-clock time so the metronome can be
   * aligned with something else that was scheduled — the count-in, or the demo
   * playback — rather than starting whenever the timer happens to fire.
   */
  start(bpm: number, beatsPerBar: number, startAt?: number): void {
    this.stop();
    this.secPerBeat = 60 / Math.max(20, bpm);
    this.beatsPerBar = Math.max(1, Math.round(beatsPerBar));
    this.beat = 0;
    this.nextBeatTime = startAt ?? this.synth.now;
    this.schedule();
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = 0;
  }

  private schedule(): void {
    const horizon = this.synth.now + LOOKAHEAD_SEC;
    // Guard against a long stall (a backgrounded tab): rather than firing a burst
    // of overdue clicks, skip forward to the present.
    if (this.nextBeatTime < this.synth.now - LOOKAHEAD_SEC) {
      this.nextBeatTime = this.synth.now;
      this.beat = 0;
    }
    while (this.nextBeatTime < horizon) {
      this.synth.clickAt(this.nextBeatTime, this.beat % this.beatsPerBar === 0);
      this.nextBeatTime += this.secPerBeat;
      this.beat++;
    }
  }
}
