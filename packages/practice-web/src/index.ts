/**
 * @arpeggio/practice-web — the browser-side half of the practice loop.
 *
 * Everything here needs a DOM/Web Audio runtime, which is exactly why it lives
 * outside @arpeggio/practice-engine (pure, headless, and the code reused
 * verbatim on iOS). Both web apps — the desktop lab (`apps/web`) and the mobile
 * learner (`apps/learn`) — capture audio and pump windows the same way, so that
 * code lives here once.
 */
export type {
  FrameSource,
  PracticeCallbacks,
  ScoreRenderer,
  AudioFrame,
  PlayerEvent,
  Score,
} from "./contracts.js";
export {
  MicSource,
  SimSource,
  ChordSource,
  type SimOptions,
  type ChordOptions,
} from "./audio.js";
export { LivePractice, type LivePracticeOptions } from "./practice.js";
