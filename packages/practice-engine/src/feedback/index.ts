/**
 * feedback/ — adaptation subsystem (roadmap Phase 6).
 *
 *  - loop 1: `ThresholdCalibrator` — per-user/room threshold calibration.
 *  - loop 2: `StudentModel` — pedagogical student model driving practice picks.
 *
 * Loop 3 (model re-training) is intentionally out of scope for this on-device core.
 */
export { ThresholdCalibrator } from "./calibration.js";
export type { CalibrationObservation } from "./calibration.js";
export { StudentModel } from "./studentModel.js";
export type { ObservedEvent, MeasureDifficulty } from "./studentModel.js";
