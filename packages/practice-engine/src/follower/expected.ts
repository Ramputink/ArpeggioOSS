/**
 * Deriving the follower's expectation timeline from the canonical `Score`.
 *
 * The parser already hands us `Score.events` as a linear, repeat-expanded
 * timeline in quarter-note beats. Here we project those `NoteEvent`s onto the
 * follower's leaner `ExpectedNote` shape and offer a chord-grouping helper so
 * the state machine can require simultaneous tones before advancing.
 */

import type { NoteEvent, Score } from "@arpeggio/musicxml-parser";

import type { ExpectedNote } from "../types.js";

/** Notes whose onsets differ by less than this (in beats) are one chord. */
const DEFAULT_CHORD_EPSILON = 1e-3;

/**
 * Flatten a parsed `Score` into a time-ordered `ExpectedNote[]`.
 *
 * The result is sorted by onset then MIDI so chords come out in a stable,
 * low-to-high order. Repeats/voltas are assumed already expanded upstream
 * (`Score.repeatsFlattened`), so this is a pure field projection plus a sort.
 */
export function expectedNotesFromScore(score: Score): ExpectedNote[] {
  const notes: ExpectedNote[] = score.events.map((e: NoteEvent) => ({
    midi: e.pitchMidi,
    onset: e.onset,
    offset: e.offset,
    measure: e.measure,
    voice: e.voice,
    staff: e.staff,
  }));
  notes.sort((a, b) => a.onset - b.onset || a.midi - b.midi);
  return notes;
}

/**
 * Group notes that share (approximately) the same onset into chord groups,
 * preserving the incoming order. Input is expected to be onset-sorted (as
 * produced by `expectedNotesFromScore`); each group is one "position" the
 * follower waits on.
 */
export function groupChords(
  notes: ExpectedNote[],
  epsilon: number = DEFAULT_CHORD_EPSILON,
): ExpectedNote[][] {
  const groups: ExpectedNote[][] = [];
  let current: ExpectedNote[] = [];
  for (const note of notes) {
    if (current.length === 0 || Math.abs(note.onset - current[0].onset) <= epsilon) {
      current.push(note);
    } else {
      groups.push(current);
      current = [note];
    }
  }
  if (current.length > 0) {
    groups.push(current);
  }
  return groups;
}
