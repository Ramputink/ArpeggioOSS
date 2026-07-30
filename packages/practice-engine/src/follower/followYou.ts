/**
 * v1 "follow-you" score follower — the PianoBooster-style waiting cursor.
 *
 * The cursor sits on the current expected position (a single note or a whole
 * chord) and simply *waits* for the player. It advances only when the expected
 * tone(s) arrive with enough confidence; wrong pitches are reported but never
 * move the cursor, and prolonged silence surfaces as a `hesitation`. Rhythm is
 * deliberately tolerant here: the right pitch advances regardless of exact
 * timing, which is what makes practice at any tempo feel forgiving.
 */

import type { Score } from "@arpeggio/musicxml-parser";

import type { DetectedNote, ExpectedNote, FollowState, PlayerEvent } from "../types.js";
import { classifyError } from "./errors.js";
import { expectedNotesFromScore, groupChords } from "./expected.js";

/** Construction/behaviour knobs for {@link FollowYouFollower}. */
export interface FollowYouOptions {
  /** Detections below this confidence are ignored as too uncertain. Default 0.5. */
  minConfidence?: number;
  /**
   * Fraction of a chord's tones that must be matched before the cursor
   * advances, in (0, 1]. 1 = every tone (default); lower tolerates a missed
   * inner voice.
   */
  chordFraction?: number;
  /** Onset spread (in beats) under which notes are treated as one chord. */
  chordEpsilon?: number;
  /**
   * Seconds of silence on the current position before a single `hesitation`
   * is emitted (via {@link FollowYouFollower.onTick}). Default 2 s.
   */
  hesitationWaitSec?: number;
  /** Timing tolerance forwarded to {@link classifyError}. Default 0.15 s. */
  timingToleranceSec?: number;
  /**
   * Octaves either side of an expected pitch that still count as that pitch.
   * 0 (default) means exact.
   *
   * This exists for the microphone, not for the learner. YIN estimates a
   * fundamental by autocorrelation, and a struck piano string with a strong
   * second partial is the textbook case where it answers an octave high — so
   * insisting on the exact MIDI number makes the app reject a note that was
   * played perfectly, which the learner has no way to interpret or fix.
   *
   * Deliberately left at 0 for the on-screen keyboard: a tapped key reports its
   * own pitch, so an octave error there is genuinely the learner's, and telling
   * them is the whole point.
   */
  octaveTolerance?: number;
}

/** A `Score` or an already-flattened expectation list. */
export type FollowInput = Score | ExpectedNote[];

function toExpected(input: FollowInput): ExpectedNote[] {
  return Array.isArray(input) ? input : expectedNotesFromScore(input);
}

export class FollowYouFollower {
  /** Publicly readable belief about where the player is. */
  readonly state: FollowState;

  private readonly expected: ExpectedNote[];
  private readonly groups: ExpectedNote[][];
  /** For each group, the count of expected notes preceding it (for `state.index`). */
  private readonly notesBefore: number[];

  private readonly minConfidence: number;
  private readonly chordFraction: number;
  private readonly hesitationWaitSec: number;
  private readonly timingToleranceSec: number;
  private readonly octaveTolerance: number;

  /** Index of the chord group the cursor is currently waiting on. */
  private groupIndex = 0;
  /** MIDI pitches of the current group already satisfied this pass. */
  private matched = new Set<number>();
  /** Whether a hesitation has already been surfaced for the current group. */
  private hesitationEmitted = false;
  /** Audio-clock time of the last accepted activity, for hesitation timing. */
  private lastActivitySec = 0;

  constructor(input: FollowInput, opts: FollowYouOptions = {}) {
    this.expected = toExpected(input);
    this.groups = groupChords(this.expected, opts.chordEpsilon);

    // Precompute the cumulative note count before each group.
    this.notesBefore = [];
    let running = 0;
    for (const g of this.groups) {
      this.notesBefore.push(running);
      running += g.length;
    }

    this.minConfidence = opts.minConfidence ?? 0.5;
    this.chordFraction = opts.chordFraction ?? 1;
    this.hesitationWaitSec = opts.hesitationWaitSec ?? 2;
    this.timingToleranceSec = opts.timingToleranceSec ?? 0.15;
    this.octaveTolerance = Math.max(0, opts.octaveTolerance ?? 0);

    const first = this.groups[0];
    this.state = {
      index: 0,
      measure: first ? first[0].measure : 0,
      positionBeats: first ? first[0].onset : 0,
      waiting: this.groups.length > 0,
      done: this.groups.length === 0,
    };
  }

  /**
   * Feed one detected note. Returns the judged events it produced: `correct`
   * for an expected tone (advancing when the chord is satisfied), `wrong` for a
   * clearly off pitch (cursor unchanged). Low-confidence detections are ignored.
   */
  onDetected(note: DetectedNote): PlayerEvent[] {
    if (this.state.done) {
      return [];
    }
    if (note.confidence < this.minConfidence) {
      // Too uncertain to act on — neither advance nor penalise.
      return [];
    }

    const group = this.groups[this.groupIndex];
    const atBeat = group[0].onset;
    const events: PlayerEvent[] = [];

    // Which expected tone this detection satisfies, if any. Exactly the played
    // pitch normally; within `octaveTolerance` octaves of it when the input is a
    // microphone and the octave cannot be trusted.
    const tone = this.matchTone(group, note.midi);

    if (tone !== undefined) {
      if (this.matched.has(tone)) {
        // Already counted this tone for the current chord — ignore the repeat.
        return events;
      }
      this.matched.add(tone);
      this.lastActivitySec = note.onsetSec;

      // Rhythm-tolerant: no timing error is asserted, so this reads `correct`.
      const kind = classifyError(tone, tone, undefined, {
        timingToleranceSec: this.timingToleranceSec,
      });
      const octaveOff = tone === note.midi ? undefined : (note.midi - tone) / 12;
      events.push({
        kind,
        expectedMidi: tone,
        playedMidi: note.midi,
        atBeat,
        timeSec: note.onsetSec,
        // Carried even on a correct note so the UI can mention the octave
        // without treating the note as wrong.
        ...(octaveOff !== undefined ? { octaveOff } : {}),
      });

      const required = Math.max(1, Math.ceil(group.length * this.chordFraction));
      if (this.matched.size >= required) {
        this.advance();
      }
    } else {
      // A confident, unexpected pitch: report it but hold the cursor. When the
      // pitch class was right, say how far off the octave was — that is a
      // misplaced hand, which is a different fix from a misread note.
      const octaveOff = octaveDisplacement(group, note.midi);
      events.push({
        kind: "wrong",
        expectedMidi: group[0].midi,
        playedMidi: note.midi,
        atBeat,
        timeSec: note.onsetSec,
        ...(octaveOff !== undefined ? { octaveOff } : {}),
      });
    }

    return events;
  }

  /**
   * Feed several simultaneous detections (a played chord). Convenience wrapper
   * that folds each note through {@link onDetected} in ascending-pitch order.
   */
  onDetection(notes: DetectedNote[]): PlayerEvent[] {
    const events: PlayerEvent[] = [];
    const ordered = [...notes].sort((a, b) => a.midi - b.midi);
    for (const note of ordered) {
      events.push(...this.onDetected(note));
      if (this.state.done) {
        break;
      }
    }
    return events;
  }

  /**
   * Advance the audio clock without new input. Emits a single `hesitation` for
   * the current position once the player has been silent past the configured
   * wait. Idempotent per position — it fires at most once until the cursor
   * moves on.
   */
  onTick(nowSec: number): PlayerEvent[] {
    if (this.state.done || this.hesitationEmitted) {
      return [];
    }
    if (nowSec - this.lastActivitySec < this.hesitationWaitSec) {
      return [];
    }
    this.hesitationEmitted = true;
    const group = this.groups[this.groupIndex];
    return [
      {
        kind: "hesitation",
        expectedMidi: group[0].midi,
        atBeat: group[0].onset,
        timeSec: nowSec,
      },
    ];
  }

  /**
   * The expected tone a detection satisfies, or undefined.
   *
   * Exact match first, always: when the played pitch is literally one of the
   * expected ones, that is the tone, even if another expected tone is an octave
   * away and would also qualify.
   */
  private matchTone(group: ExpectedNote[], playedMidi: number): number | undefined {
    if (group.some((g) => g.midi === playedMidi)) return playedMidi;
    if (this.octaveTolerance === 0) return undefined;
    let best: ExpectedNote | undefined;
    for (const expected of group) {
      const octaves = (playedMidi - expected.midi) / 12;
      if (!Number.isInteger(octaves) || Math.abs(octaves) > this.octaveTolerance) continue;
      if (this.matched.has(expected.midi)) continue;
      if (best === undefined || Math.abs(octaves) < Math.abs((playedMidi - best.midi) / 12)) {
        best = expected;
      }
    }
    return best?.midi;
  }

  /** Reset the cursor to the start of the piece. */
  reset(): void {
    this.groupIndex = 0;
    this.matched.clear();
    this.hesitationEmitted = false;
    this.lastActivitySec = 0;
    const first = this.groups[0];
    this.state.index = 0;
    this.state.measure = first ? first[0].measure : 0;
    this.state.positionBeats = first ? first[0].onset : 0;
    this.state.waiting = this.groups.length > 0;
    this.state.done = this.groups.length === 0;
  }

  /** Move the cursor to the next chord group, or finish the piece. */
  private advance(): void {
    this.groupIndex += 1;
    this.matched.clear();
    this.hesitationEmitted = false;

    if (this.groupIndex >= this.groups.length) {
      this.state.index = this.expected.length;
      this.state.waiting = false;
      this.state.done = true;
      return;
    }

    const group = this.groups[this.groupIndex];
    this.state.index = this.notesBefore[this.groupIndex];
    this.state.measure = group[0].measure;
    this.state.positionBeats = group[0].onset;
    this.state.waiting = true;
  }
}

/**
 * How many octaves off a played pitch is from an expected one of the same pitch
 * class, or `undefined` when no expected tone shares its pitch class.
 *
 * The nearest candidate wins: against a chord containing both C3 and C5, a
 * played C4 reads as one octave off, not three.
 */
export function octaveDisplacement(group: ExpectedNote[], playedMidi: number): number | undefined {
  let best: number | undefined;
  for (const expected of group) {
    if ((((expected.midi - playedMidi) % 12) + 12) % 12 !== 0) continue;
    const octaves = (playedMidi - expected.midi) / 12;
    if (best === undefined || Math.abs(octaves) < Math.abs(best)) best = octaves;
  }
  return best;
}
