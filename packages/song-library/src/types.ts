/**
 * Shapes for the built-in song library.
 *
 * A `Song` is authored by hand in the compact text notation implemented in
 * `notation.ts` (one line of tokens per hand) and compiled on demand to the
 * canonical `Score` used by the rest of Arpeggio. Keeping the source textual
 * makes a song a ~10-line diff, which is what we want from outside contributors.
 *
 * NOTE ON LANGUAGE: code and comments are English (project rule), but the
 * user-facing strings below (`title`, `tip`, …) are Spanish, because the
 * learner app ships Spanish copy. They are grouped here so a future i18n pass
 * only has to touch this one field group.
 */

/**
 * Difficulty tier used to group the library on the home screen.
 *
 * The tiers are a curriculum, not a rating: each one exists to teach the skill
 * the next one assumes. Levels 1–3 build a working right hand and a supporting
 * left; 4–5 are real classical repertoire as written; 6 is the neoclassical
 * idiom (wide left-hand arpeggios under a sung melody) the learner is aiming at.
 */
export type Level = 1 | 2 | 3 | 4 | 5 | 6;

export interface Song {
  /** Stable slug; also the localStorage key for progress. */
  id: string;
  /** Display title (Spanish). */
  title: string;
  /** Composer / tradition, shown under the title. */
  composer: string;
  level: Level;
  /** Suggested practice tempo in quarter-note BPM. */
  bpm: number;
  /** Time-signature numerator (beats per bar, in `beatType` units). */
  beats: number;
  /** Time-signature denominator (4 = quarter, 8 = eighth). */
  beatType: number;
  /**
   * Key signature as a count of sharps (positive) or flats (negative).
   * Drives note spelling and the key signature drawn on the staff.
   */
  sharps: number;
  /** Beats (quarter notes) in an incomplete opening bar; 0 when none. */
  pickupBeats?: number;
  /** One-line coaching note shown before playing (Spanish). */
  tip: string;
  /** Right-hand voice in the compact notation. */
  right: string;
  /** Optional left-hand voice; when absent the song is right hand only. */
  left?: string;
}

/** Which hand(s) the learner is practising. */
export type HandChoice = "right" | "left" | "both";
