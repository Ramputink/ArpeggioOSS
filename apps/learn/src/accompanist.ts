/**
 * The app plays the other hand.
 *
 * Practising the left hand alone is practising in silence: the part that makes
 * it sound like music is the one you are not playing. Every teacher plays the
 * missing hand for a student, and it is the single cheapest thing that makes
 * one-hand practice feel worth doing.
 *
 * The interesting decision is **what drives it**. Not a clock: in wait mode
 * there isn't one, because the cursor waits for the learner. It is driven by the
 * cursor's own position in beats, which means:
 *
 *  - in wait mode the other hand arrives exactly as you reach it, so a learner
 *    who stops to find a note does not get left behind by an accompaniment that
 *    carried on without them;
 *  - in a-tempo and demo the position advances with the clock, so the same code
 *    plays strictly in time with no special case.
 *
 * Not available over the microphone, and that is not an oversight: the app's own
 * output goes out of the speaker and straight back into the microphone, where
 * the detector cannot tell it from the piano. Judging would score the app's
 * notes as the learner's. `Runner` refuses to build one in that mode.
 */
import type { Synth } from "./synth.js";

export interface AccompanyNote {
  midi: number;
  /** Onset in quarter-note beats. */
  onset: number;
  /** Offset in quarter-note beats. */
  offset: number;
}

/**
 * Notes whose onset falls in `(from, to]`.
 *
 * A half-open interval on purpose: the cursor is polled repeatedly with the
 * same position while the learner thinks, and a closed interval would re-fire
 * every note sitting exactly on it, once per animation frame.
 */
export function notesDue(
  notes: readonly AccompanyNote[],
  from: number,
  to: number,
): AccompanyNote[] {
  return notes.filter((n) => n.onset > from && n.onset <= to);
}

/** Cursor positions this far apart are a jump, not playing. */
const JUMP_BEATS = 2;

export class Accompanist {
  private readonly notes: AccompanyNote[];
  private cursor = -Infinity;

  constructor(
    notes: readonly AccompanyNote[],
    private readonly synth: Synth,
    private readonly secPerBeat: number,
    /** Quieter than the learner's own notes: this is accompaniment. */
    private readonly velocity = 0.5,
  ) {
    this.notes = [...notes].sort((a, b) => a.onset - b.onset);
  }

  /**
   * Sound everything the cursor has just passed.
   *
   * A large forward jump (a loop restarting, a DTW resync) is not played
   * through: the learner has moved somewhere else in the piece and does not want
   * to hear the bar they skipped compressed into one chord.
   */
  update(positionBeats: number): void {
    if (positionBeats < this.cursor) {
      // Backwards: the piece restarted. Pick up from here without a flourish.
      this.cursor = positionBeats;
      return;
    }
    const from =
      positionBeats - this.cursor > JUMP_BEATS ? positionBeats - JUMP_BEATS : this.cursor;
    for (const note of notesDue(this.notes, from, positionBeats)) {
      this.synth.playAt(
        note.midi,
        this.synth.now,
        Math.max(0.12, (note.offset - note.onset) * this.secPerBeat),
        this.velocity,
      );
    }
    this.cursor = positionBeats;
  }

  /** Rewind to the top without sounding anything. */
  reset(): void {
    this.cursor = -Infinity;
  }
}
