/**
 * How long the learner actually practised.
 *
 * Notes played is a proxy; minutes is the thing. It is the number a teacher
 * asks for, the one that predicts progress, and the one that lets "sesión de 10
 * minutos" mean ten minutes rather than three pieces.
 *
 * The whole difficulty is honesty. A clock started when the practice screen
 * opens and stopped when it closes would happily bank forty minutes for a phone
 * left face-up on the piano, and that number would then be worthless. So:
 *
 *  - the clock only runs while the practice screen is in front of the learner —
 *    it is paused on `visibilitychange`, on a sheet opening over the top, and
 *    while the piece itself is paused;
 *  - a single unbroken segment is capped, because a device that sleeps without
 *    firing `visibilitychange` (it happens) must not be able to bank an hour.
 *
 * Pure and injectable: `now` is a parameter, never `Date.now()`, so the whole
 * thing is testable without a clock.
 */

/**
 * Longest single stretch that counts, in seconds.
 *
 * Twenty minutes of unbroken playing without touching the screen is a real
 * practice session; two hours is a phone nobody is holding.
 */
export const MAX_SEGMENT_SEC = 20 * 60;

export class PracticeClock {
  /** `now` at which the current segment began, or null when not running. */
  private since: number | null = null;
  private banked = 0;

  /** Begin (or continue) counting. Calling it twice in a row is harmless. */
  start(now: number): void {
    if (this.since === null) this.since = now;
  }

  /** Stop counting, banking whatever the current segment was worth. */
  pause(now: number): void {
    if (this.since === null) return;
    this.banked += Math.min(MAX_SEGMENT_SEC, Math.max(0, now - this.since));
    this.since = null;
  }

  /** True while the clock is accumulating. */
  get running(): boolean {
    return this.since !== null;
  }

  /** Seconds counted so far, including the segment in progress. */
  seconds(now: number): number {
    const open = this.since === null ? 0 : Math.min(MAX_SEGMENT_SEC, Math.max(0, now - this.since));
    return this.banked + open;
  }

  /**
   * Take everything counted so far and reset to zero, staying in whatever
   * running state the clock was already in.
   *
   * Taking rather than reading is what stops the same minute being banked twice
   * — the caller writes the returned seconds to storage and the clock forgets
   * them, so an interrupted session and its result screen cannot double count.
   */
  take(now: number): number {
    const total = this.seconds(now);
    this.banked = 0;
    if (this.since !== null) this.since = now;
    return total;
  }
}

/** "12 min" / "1 h 05 min" — practice time, in the units a learner thinks in. */
export function formatDuration(seconds: number): string {
  const total = Math.max(0, Math.round(seconds / 60));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  return `${hours} h ${String(total % 60).padStart(2, "0")} min`;
}
