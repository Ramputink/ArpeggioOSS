/**
 * Module contracts for the web app — the seams between the files each agent owns
 * so they integrate without stepping on each other:
 *
 *   api.ts       -> omrToMusicXML(file, backendUrl)      (lead)
 *   render.ts    -> PianoRoll (canvas)                    (lead)
 *   audio.ts     -> MicSource, SimSource : FrameSource    (agent A)
 *   practice.ts  -> LivePractice                          (agent C)
 *   main.ts      -> app shell, wires all of the above     (lead)
 *
 * All audio types (AudioFrame) and engine types come from @arpeggio/practice-engine.
 */
import type { AudioFrame, PlayerEvent } from "@arpeggio/practice-engine";
import type { Score } from "@arpeggio/musicxml-parser";

/** Anything that emits audio frames: the real mic, or a simulator. */
export interface FrameSource {
  /** Begin emitting frames to `onFrame`. Resolves once started (mic permission granted). */
  start(onFrame: (frame: AudioFrame) => void): Promise<void>;
  /** Stop emitting and release resources. */
  stop(): void;
  /** Human-readable state for the UI (e.g. "listening", "denied"). */
  readonly label: string;
}

/** Callbacks the practice loop uses to drive the UI. */
export interface PracticeCallbacks {
  /** Called with judged events (correct/wrong/hesitation/…) as they happen. */
  onEvents(events: PlayerEvent[]): void;
  /** Called after each processed window with the current follower/feedback state. */
  onProgress(p: {
    index: number;
    total: number;
    measure: number;
    done: boolean;
    /** Onset (beats) of the current expected position, for the cursor. */
    positionBeats: number;
  }): void;
}

/** What render.ts exposes. */
export interface ScoreRenderer {
  setScore(score: Score): void;
  /** Move the playback/practice cursor to a beat position. */
  setCursorBeat(beat: number): void;
  /** Highlight the expected note index the follower is waiting on. */
  setActiveIndex(index: number): void;
  draw(): void;
}

export type { AudioFrame, PlayerEvent, Score };
