/**
 * @arpeggio/practice-engine
 *
 * The on-device practice core for the piano tutor (roadmap Phases 4–6):
 *  - detection/  MOTOR 1 (monophonic YIN) + MOTOR 2 (polyphonic) + combiner
 *  - follower/   follow-you state machine (v1) + DTW alignment (v2)
 *  - feedback/   threshold calibration (loop 1) + student model (loop 2)
 *
 * Everything consumes the canonical `Score` from @arpeggio/musicxml-parser and
 * is engineered to run on-device for low latency. Each subsystem re-exports its
 * public API from its own `index.ts`.
 */
export * from "./types.js";
export * from "./detection/index.js";
export * from "./follower/index.js";
export * from "./feedback/index.js";
export * from "./session.js";
