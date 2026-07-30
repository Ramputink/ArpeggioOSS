/**
 * @arpeggio/song-library — the built-in starter repertoire and warm-ups.
 *
 * Songs are authored in the compact text notation (see `notation.ts`) and
 * compiled to the canonical `Score` on demand, so nothing here depends on a
 * network fetch or on the OMR backend: the learner app works fully offline.
 *
 * Two catalogues, deliberately separate: `SONGS` is the curriculum, in order,
 * and `EXERCISES` is generated technique work that sits outside it.
 */
export type { Song, Level, HandChoice, StartPosition } from "./types.js";
export { SONGS, songById, LEVEL_NAMES, LEVEL_GOALS } from "./songs.js";
export {
  EXERCISES,
  EXERCISE_SPECS,
  buildExercise,
  exerciseById,
  type ExerciseKind,
  type ExerciseSpec,
} from "./exercises.js";
export {
  songToScore,
  songToMusicXML,
  parseVoice,
  pitchToMidi,
  midiToSpelling,
  diatonicIndex,
  beatsPerBar,
  type VoiceOptions,
  type ParsedVoice,
} from "./notation.js";
