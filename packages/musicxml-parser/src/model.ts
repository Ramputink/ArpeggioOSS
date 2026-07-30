/**
 * Arpeggio's canonical internal model.
 *
 * Every source of note data (OMR/MusicXML now; MIDI or generated later) is
 * normalized to this shape. The rest of the app is meant to work on `Score`,
 * never on raw MusicXML.
 *
 * Timing convention: `onset`/`offset`/`position` are expressed in
 * quarter-note beats ("quarter lengths"), independent of the MusicXML
 * `<divisions>` value. This makes events directly comparable across parts and
 * pieces regardless of the encoder's tick resolution.
 */

/** Which hand plays the note, inferred from the staff. */
export type Hand = "left" | "right" | "unknown";

/**
 * A single sounding note on the flattened, linear timeline.
 * Rests are not events — they are simply gaps between events.
 */
export interface NoteEvent {
  /** Start time in quarter-note beats from the beginning of the piece. */
  onset: number;
  /** End time in quarter-note beats (onset + duration, ties already merged). */
  offset: number;
  /** MIDI pitch number, 0–127 (middle C = 60). */
  pitchMidi: number;
  /** MusicXML voice number within the part (1-based). */
  voice: number;
  /** MusicXML staff number within the part (1 = upper, 2 = lower, …). */
  staff: number;
  /** Hand inferred from the staff (piano convention: staff 1 = right). */
  hand: Hand;
  /** 1-based measure number this note starts in (source numbering). */
  measure: number;
  /** Onset offset within its measure, in quarter-note beats. */
  position: number;
  /** True when this event absorbed one or more tied continuation notes. */
  tied?: boolean;
  /**
   * Suggested finger, 1 (thumb) to 5 (little finger), when the source provides
   * one.
   *
   * Not decoration: without a finger number "play a G" is ambiguous, and a
   * beginner who picks the wrong one has to unlearn the fingering before the
   * passage can ever be played up to speed.
   */
  finger?: number;
}

/** A tempo marking placed on the timeline. */
export interface TempoMark {
  /** Onset in quarter-note beats where this tempo takes effect. */
  onset: number;
  /** Beats (quarter notes) per minute. */
  bpm: number;
}

/**
 * A key signature, tied to the measure where it appears.
 *
 * Kept in the model rather than inferred downstream because a renderer that does
 * not know the key has to print an accidental on every altered note. That is
 * musically correct and visually unreadable: the Canon in D would carry a sharp
 * on every F and C in the piece instead of two symbols at the start of the line.
 */
export interface KeySignature {
  /** 1-based measure number where this signature starts applying. */
  measure: number;
  /** Position on the circle of fifths: positive = sharps, negative = flats. */
  fifths: number;
}

/** A time signature, tied to the measure where it appears. */
export interface TimeSignature {
  /** 1-based measure number where this signature starts applying. */
  measure: number;
  /** Numerator, e.g. 3 in 3/4. */
  beats: number;
  /** Denominator note value, e.g. 4 in 3/4. */
  beatType: number;
}

/** The fully parsed, timeline-flattened score. */
export interface Score {
  /** All note events, sorted by onset then pitch. */
  events: NoteEvent[];
  /** The `<divisions>` value observed (ticks per quarter note); informational. */
  divisions: number;
  /** Time signatures in order of appearance. */
  timeSignatures: TimeSignature[];
  /** Key signatures in order of appearance; empty means C major / A minor. */
  keySignatures: KeySignature[];
  /** Tempo marks in order of appearance. */
  tempos: TempoMark[];
  /** Part identifiers/names, in score order. */
  parts: string[];
  /** True when repeats/voltas were expanded into the linear timeline. */
  repeatsFlattened: boolean;
}
