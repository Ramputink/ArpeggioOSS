/**
 * Note-detection subsystem (roadmap Phase 4).
 *
 * Public API surface for the three detection pieces:
 *   - yin.ts         MOTOR 1: cheap monophonic YIN pitch detection + segmentation
 *   - polyphonic.ts  MOTOR 2 seam: injectable stub for Basic Pitch (ONNX/Core ML)
 *   - combiner.ts    the fusion logic that picks which engine to trust
 */
export * from "./yin.js";
export * from "./polyphonic.js";
export * from "./combiner.js";
