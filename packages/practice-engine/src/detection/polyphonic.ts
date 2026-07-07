/**
 * MOTOR 2 — polyphonic transcription seam (stub).
 *
 * The REAL MOTOR 2 is Spotify's **Basic Pitch** neural model, run on-device via
 * ONNX Runtime (or Core ML on Apple silicon). It transcribes a *window* of audio
 * into simultaneously-sounding notes — the piece the cheap monophonic YIN engine
 * cannot do, e.g. left-hand chords. That model is heavy (tens of MB of weights,
 * native inference runtime) and therefore lives outside this headless TypeScript
 * package's scope.
 *
 * `StubPolyphonicDetector` is a deterministic, injectable stand-in with the exact
 * `PolyphonicDetector` shape, so the combiner and the whole detection pipeline
 * can be wired up and unit-tested *now* — before the ML runtime is integrated.
 * Feed it a scripted list of notes (or a callback) and it echoes them back from
 * `detect()`. Swap it for the ONNX-backed implementation later with no change to
 * the combiner: same interface, same seam.
 */
import type { AudioFrame, DetectedNote, PolyphonicDetector } from "../types.js";

/** What the stub should return: a fixed list, or a per-call function. */
export type PolyScript =
  | DetectedNote[]
  | ((frames: AudioFrame[]) => DetectedNote[] | Promise<DetectedNote[]>);

/** A deterministic, injectable MOTOR 2 double for tests and pipeline wiring. */
export class StubPolyphonicDetector implements PolyphonicDetector {
  private readonly script: PolyScript;
  private callCount = 0;

  /**
   * @param script Notes to return from every `detect()` call, or a callback
   *   invoked with the frame window. Defaults to an empty transcription.
   */
  constructor(script: PolyScript = []) {
    this.script = script;
  }

  async detect(frames: AudioFrame[]): Promise<DetectedNote[]> {
    this.callCount++;
    if (typeof this.script === "function") {
      return this.script(frames);
    }
    // Return defensive copies tagged as poly-engine output so callers can't
    // mutate the script and every note reports the correct provenance.
    return this.script.map((n) => ({ ...n, engine: "poly" as const }));
  }

  /** How many times `detect()` has been invoked (for asserting on-demand use). */
  get calls(): number {
    return this.callCount;
  }

  /** Reset the invocation counter between test takes. */
  reset(): void {
    this.callCount = 0;
  }
}
