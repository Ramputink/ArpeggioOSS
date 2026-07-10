/**
 * @arpeggio/motor2-basicpitch — real polyphonic MOTOR 2 for the practice engine.
 *
 * Injected into a PracticeSession as the `poly` detector:
 *   import { BasicPitchDetector } from "@arpeggio/motor2-basicpitch";
 *   const session = new PracticeSession(score, { poly: new BasicPitchDetector() });
 */
export {
  BasicPitchDetector,
  resampleLinear,
  BASIC_PITCH_SAMPLE_RATE,
  type BasicPitchDetectorOptions,
  type Transcribe,
} from "./basicPitch.js";
