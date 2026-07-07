/**
 * v2 online alignment — dynamic time warping of the played stream against the
 * expected sequence.
 *
 * Where the follow-you cursor only ever waits and steps forward, DTW aligns the
 * whole (windowed) detected sequence to the expected one at once. That lets it
 * absorb small tempo deviations, dropped/spurious notes, and short jumps — the
 * behaviour wanted for "a tempo" practice.
 */

import type { Score } from "@arpeggio/musicxml-parser";

import type { DetectedNote, ExpectedNote } from "../types.js";
import { expectedNotesFromScore } from "./expected.js";

/** Tunables for the DTW cost and the online window. */
export interface DtwOptions {
  /**
   * Weight on the onset-distance term (|detected.onsetSec - expected.onset|).
   * Defaults to 0 — pitch-only, since the two clocks (seconds vs beats) are not
   * directly comparable without a tempo. Set > 0 when detections and
   * expectations share a clock.
   */
  onsetWeight?: number;
  /**
   * How many trailing detections the online {@link DtwFollower} re-aligns each
   * step. Keeps cost bounded on long pieces. Default 32.
   */
  window?: number;
  /**
   * Free-endpoint alignment: let the path end at the best-matching expected
   * index for the last detection instead of forcing it onto the final expected
   * note. Required for the online follower — with the classic fixed endpoint,
   * every latest detection would snap to `expected.length - 1`. Default false.
   */
  freeEnd?: boolean;
}

function localCost(
  detected: DetectedNote,
  expected: ExpectedNote,
  onsetWeight: number,
): number {
  const pitchCost = Math.abs(detected.midi - expected.midi);
  const onsetCost =
    onsetWeight > 0 ? onsetWeight * Math.abs(detected.onsetSec - expected.onset) : 0;
  return pitchCost + onsetCost;
}

/**
 * Classic DTW. Returns, for each detected note, the index of the expected note
 * it aligns to (or -1 when there are no expectations to align against).
 *
 * The alignment is the minimum-cost monotonic path through the pitch- (and
 * optionally onset-) distance matrix; spurious notes get folded onto their
 * nearest neighbour rather than derailing the surrounding matches.
 */
export function dtwAlign(
  detected: DetectedNote[],
  expected: ExpectedNote[],
  opts: DtwOptions = {},
): number[] {
  const n = detected.length;
  const m = expected.length;
  if (n === 0) {
    return [];
  }
  if (m === 0) {
    return new Array<number>(n).fill(-1);
  }

  const onsetWeight = opts.onsetWeight ?? 0;

  // Accumulated-cost matrix, (n+1) x (m+1), with an infinity border.
  const cost: number[][] = Array.from({ length: n + 1 }, () =>
    new Array<number>(m + 1).fill(Number.POSITIVE_INFINITY),
  );
  cost[0][0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const local = localCost(detected[i - 1], expected[j - 1], onsetWeight);
      const best = Math.min(cost[i - 1][j - 1], cost[i - 1][j], cost[i][j - 1]);
      cost[i][j] = local + best;
    }
  }

  // Backtrack the optimal path, recording an expected index for each detection.
  const mapping = new Array<number>(n).fill(-1);
  let i = n;
  // Fixed endpoint (j=m) forces the last detection onto the last expected note.
  // With freeEnd, end at the expected index that best matches the last detection
  // so the online follower can report an intermediate position.
  let j = m;
  if (opts.freeEnd) {
    let bestJ = 1;
    for (let jj = 2; jj <= m; jj++) {
      if (cost[n][jj] < cost[n][bestJ]) bestJ = jj;
    }
    j = bestJ;
  }
  while (i > 0 && j > 0) {
    mapping[i - 1] = j - 1;
    const diag = cost[i - 1][j - 1];
    const up = cost[i - 1][j];
    const left = cost[i][j - 1];
    if (diag <= up && diag <= left) {
      i -= 1;
      j -= 1;
    } else if (up <= left) {
      i -= 1;
    } else {
      j -= 1;
    }
  }
  return mapping;
}

/** A `Score` or an already-flattened expectation list. */
export type DtwInput = Score | ExpectedNote[];

function toExpected(input: DtwInput): ExpectedNote[] {
  return Array.isArray(input) ? input : expectedNotesFromScore(input);
}

/**
 * Online DTW follower. Detections are streamed in one at a time; after each,
 * `currentIndex` is the aligned expected index of the latest note, clamped to
 * be non-decreasing so the reported position never jumps backwards on noise.
 *
 * Alignment is recomputed over a trailing window, which keeps per-step cost
 * bounded while still letting recent context correct earlier ambiguity.
 */
export class DtwFollower {
  /** Best current estimate of the player's position in the expected sequence. */
  currentIndex = 0;

  private readonly expected: ExpectedNote[];
  private readonly window: number;
  private readonly opts: DtwOptions;
  private readonly detected: DetectedNote[] = [];

  constructor(input: DtwInput, opts: DtwOptions = {}) {
    this.expected = toExpected(input);
    this.window = opts.window ?? 32;
    this.opts = opts;
  }

  /** Feed one detection; returns the updated `currentIndex`. */
  onDetected(note: DetectedNote): number {
    this.detected.push(note);
    const slice = this.detected.slice(-this.window);
    // Free-endpoint so the latest detection maps to its best expected index,
    // not always the final note.
    const mapping = dtwAlign(slice, this.expected, { ...this.opts, freeEnd: true });
    const last = mapping[mapping.length - 1];
    if (last >= 0) {
      this.currentIndex = Math.max(this.currentIndex, last);
    }
    return this.currentIndex;
  }

  /** Clear the streamed history and reset the position to the start. */
  reset(): void {
    this.detected.length = 0;
    this.currentIndex = 0;
  }
}
