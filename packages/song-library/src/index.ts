/**
 * @arpeggio/song-library — the built-in starter repertoire.
 *
 * Songs are authored in the compact text notation (see `notation.ts`) and
 * compiled to the canonical `Score` on demand, so nothing here depends on a
 * network fetch or on the OMR backend: the learner app works fully offline.
 */
export type { Song, Level, HandChoice } from "./types.js";
export { SONGS, songById, LEVEL_NAMES, LEVEL_GOALS } from "./songs.js";
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
