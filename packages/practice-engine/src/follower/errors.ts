/**
 * Classification of a single player action against what the score expected.
 *
 * This is the shared judgement primitive used by both the follow-you state
 * machine and the DTW follower to turn a (expected, played, timing) triple into
 * a `PlayerEventKind`.
 */

import type { PlayerEventKind } from "../types.js";

/** Tunables for {@link classifyError}. */
export interface ClassifyOptions {
  /**
   * Half-width of the "on time" window in seconds. A correct pitch played
   * within +/- this of its expected time is `correct`; earlier is `early`,
   * later is `late`. Defaults to 0.15 s.
   */
  timingToleranceSec?: number;
}

/**
 * Decide how a player action reads relative to the score.
 *
 * - Nothing played (`playedMidi === undefined`) -> `hesitation` (silence).
 * - A note played where none was expected, or a different pitch -> `wrong`.
 * - The right pitch, judged on timing when a `timingErrorSec` is known:
 *   within tolerance -> `correct`, too soon -> `early`, too late -> `late`.
 *   With no timing information a correct pitch is simply `correct`
 *   (learning-mode rhythm tolerance).
 *
 * @param timingErrorSec played - expected, in seconds (negative = ahead).
 */
export function classifyError(
  expectedMidi: number | undefined,
  playedMidi: number | undefined,
  timingErrorSec: number | undefined,
  opts: ClassifyOptions = {},
): PlayerEventKind {
  const tolerance = opts.timingToleranceSec ?? 0.15;

  // No note reached us: the player is hesitating / silent.
  if (playedMidi === undefined) {
    return "hesitation";
  }

  // Something sounded where nothing (or a different pitch) was expected.
  if (expectedMidi === undefined || playedMidi !== expectedMidi) {
    return "wrong";
  }

  // Right pitch — refine on timing only when we actually have a measurement.
  if (timingErrorSec !== undefined) {
    if (timingErrorSec < -tolerance) {
      return "early";
    }
    if (timingErrorSec > tolerance) {
      return "late";
    }
  }
  return "correct";
}
