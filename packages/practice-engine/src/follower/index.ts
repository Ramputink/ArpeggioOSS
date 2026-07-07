/**
 * Score-following subsystem (roadmap Phase 5).
 *
 * Two followers over a shared expectation model:
 *   - {@link FollowYouFollower} — v1 waiting cursor (tolerant, learning mode).
 *   - {@link DtwFollower} / {@link dtwAlign} — v2 online alignment (a tempo).
 */

export { expectedNotesFromScore, groupChords } from "./expected.js";
export { classifyError, type ClassifyOptions } from "./errors.js";
export {
  FollowYouFollower,
  type FollowYouOptions,
  type FollowInput,
} from "./followYou.js";
export { dtwAlign, DtwFollower, type DtwOptions, type DtwInput } from "./dtw.js";
