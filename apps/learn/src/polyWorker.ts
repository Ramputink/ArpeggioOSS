/**
 * Worker entry for MOTOR 2 (polyphonic transcription).
 *
 * Basic Pitch runs a neural network over two seconds of audio. On the main thread
 * that inference competes with the very things it is supposed to serve — the
 * scrolling notation, the keyboard highlight, the animation frame — so on a phone
 * it shows up as dropped frames exactly when a chord is played. Here it gets its
 * own thread, and the page only ever pays for a structured clone.
 *
 * The protocol is deliberately tiny: one request, one response, correlated by id.
 * Frames are COPIED rather than transferred, because the caller's arrays belong to
 * the practice loop and are reused across windows.
 */
import { BasicPitchDetector } from "@arpeggio/motor2-basicpitch";
import type { AudioFrame, DetectedNote } from "@arpeggio/practice-engine";

export interface PolyInitMessage {
  type: "init";
  modelUrl: string;
}
export interface PolyDetectMessage {
  type: "detect";
  id: number;
  frames: AudioFrame[];
}
export interface PolyResetMessage {
  type: "reset";
}
export type PolyRequest = PolyInitMessage | PolyDetectMessage | PolyResetMessage;

export interface PolyResultMessage {
  type: "result";
  id: number;
  notes: DetectedNote[];
}
export interface PolyErrorMessage {
  type: "error";
  id: number;
  message: string;
}
export interface PolyReadyMessage {
  type: "ready";
}
export type PolyResponse = PolyResultMessage | PolyErrorMessage | PolyReadyMessage;

let detector: BasicPitchDetector | null = null;

self.addEventListener("message", (event: MessageEvent<PolyRequest>) => {
  const message = event.data;

  if (message.type === "init") {
    detector = new BasicPitchDetector({ modelUrl: message.modelUrl });
    (self as unknown as Worker).postMessage({ type: "ready" } satisfies PolyReadyMessage);
    return;
  }

  if (message.type === "reset") {
    detector?.reset();
    return;
  }

  if (message.type === "detect") {
    const { id, frames } = message;
    if (!detector) {
      (self as unknown as Worker).postMessage({
        type: "error",
        id,
        message: "detector not initialised",
      } satisfies PolyErrorMessage);
      return;
    }
    detector
      .detect(frames)
      .then((notes) => {
        (self as unknown as Worker).postMessage({ type: "result", id, notes } satisfies PolyResultMessage);
      })
      .catch((err: unknown) => {
        (self as unknown as Worker).postMessage({
          type: "error",
          id,
          message: err instanceof Error ? err.message : String(err),
        } satisfies PolyErrorMessage);
      });
  }
});
