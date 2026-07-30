/**
 * @arpeggio/musicxml-parser
 *
 * Parse MusicXML into Arpeggio's canonical internal note-event model and report
 * on parse quality. This is Phase 1 of the piano-tutor pipeline: everything
 * downstream (render, playback, score following) is meant to consume `Score`.
 */
export type { Hand, KeySignature, NoteEvent, Score, TempoMark, TimeSignature } from "./model.js";
export { parseMusicXML } from "./parser.js";
export {
  formatReport,
  qualityReport,
  type QualityReport,
  type QualityWarning,
  type WarningLevel,
} from "./quality.js";
