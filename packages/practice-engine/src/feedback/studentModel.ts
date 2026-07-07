/**
 * Feedback loop 2 — the pedagogical student model.
 *
 * The follower emits a stream of judged `PlayerEvent`s ("you hit this note late",
 * "wrong pitch here", ...). This model aggregates that stream into a picture of the
 * learner's strengths and weaknesses so the app can decide what to drill next.
 *
 * `PlayerEvent` carries a score position in beats (`atBeat`) but not a measure
 * number, so the caller supplies the measure when recording (the follower knows it
 * from `FollowState`). We aggregate two ways: by measure and by pitch.
 *
 * The model is pure and deterministic: no wall-clock is read. Recency is captured by
 * an internal monotonically-increasing sequence counter, so replaying the same event
 * list always yields identical recommendations.
 */
import type { NoteStat, PlayerEvent } from "../types.js";

/** A player event paired with the measure it occurred in. */
export interface ObservedEvent {
  event: PlayerEvent;
  /** Measure number this event belongs to. */
  measure: number;
}

/** One entry of the difficulty heatmap. */
export interface MeasureDifficulty {
  measure: number;
  /** Difficulty in [0, 1]; higher is harder. */
  difficulty: number;
}

/** Internal running aggregate; a superset of `NoteStat` plus bookkeeping. */
interface Aggregate {
  attempts: number;
  correct: number;
  timingErrorSum: number; // sum of |timingErrorSec| over events that had it
  timingCount: number; // how many events contributed a timing error
  failCount: number; // attempts that were not correct
  lastSeq: number; // sequence index of the most recent attempt (recency)
}

// How difficulty blends the two signals, and how timing error maps into [0, 1].
const ERROR_RATE_WEIGHT = 0.7;
const TIMING_WEIGHT = 0.3;
const TIMING_SCALE_SEC = 0.2; // |error| >= 200ms saturates the timing component
// How strongly repeated failures escalate a measure in the practice queue.
const FAIL_ESCALATION = 0.5;

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

function newAggregate(): Aggregate {
  return {
    attempts: 0,
    correct: 0,
    timingErrorSum: 0,
    timingCount: 0,
    failCount: 0,
    lastSeq: 0,
  };
}

export class StudentModel {
  private byMeasure = new Map<number, Aggregate>();
  private byPitch = new Map<number, Aggregate>();
  private seq = 0; // monotonic counter => deterministic recency ordering

  /** Record a single judged event, keyed by its measure (and by pitch when known). */
  record(event: PlayerEvent, measure: number): void {
    this.seq += 1;
    const seq = this.seq;

    this.update(this.byMeasure, measure, event, seq);

    // Key by pitch too: prefer what the score expected, fall back to what was played.
    const pitch = event.expectedMidi ?? event.playedMidi;
    if (typeof pitch === "number") {
      this.update(this.byPitch, pitch, event, seq);
    }
  }

  /** Record many events in order. Accepts `{ event, measure }` pairs. */
  recordMany(items: ObservedEvent[]): void {
    for (const item of items) {
      this.record(item.event, item.measure);
    }
  }

  private update(
    map: Map<number, Aggregate>,
    key: number,
    event: PlayerEvent,
    seq: number,
  ): void {
    let agg = map.get(key);
    if (!agg) {
      agg = newAggregate();
      map.set(key, agg);
    }
    agg.attempts += 1;
    agg.lastSeq = seq;
    if (event.kind === "correct") {
      agg.correct += 1;
    } else {
      agg.failCount += 1;
    }
    if (typeof event.timingErrorSec === "number") {
      agg.timingErrorSum += Math.abs(event.timingErrorSec);
      agg.timingCount += 1;
    }
  }

  private toStat(agg: Aggregate): NoteStat {
    return {
      attempts: agg.attempts,
      correct: agg.correct,
      avgTimingError: agg.timingCount > 0 ? agg.timingErrorSum / agg.timingCount : 0,
    };
  }

  // --- Aggregation by measure --------------------------------------------------

  /** Per-measure statistics. */
  statsByMeasure(): Map<number, NoteStat> {
    const out = new Map<number, NoteStat>();
    for (const [measure, agg] of this.byMeasure) {
      out.set(measure, this.toStat(agg));
    }
    return out;
  }

  /** Fraction correct per measure, in [0, 1]. Measures with no attempts are 0. */
  accuracyByMeasure(): Map<number, number> {
    const out = new Map<number, number>();
    for (const [measure, agg] of this.byMeasure) {
      out.set(measure, agg.attempts > 0 ? agg.correct / agg.attempts : 0);
    }
    return out;
  }

  // --- Aggregation by pitch ----------------------------------------------------

  /** Per-pitch (MIDI) statistics. */
  statsByPitch(): Map<number, NoteStat> {
    const out = new Map<number, NoteStat>();
    for (const [pitch, agg] of this.byPitch) {
      out.set(pitch, this.toStat(agg));
    }
    return out;
  }

  /** Fraction correct per pitch, in [0, 1]. */
  accuracyByPitch(): Map<number, number> {
    const out = new Map<number, number>();
    for (const [pitch, agg] of this.byPitch) {
      out.set(pitch, agg.attempts > 0 ? agg.correct / agg.attempts : 0);
    }
    return out;
  }

  // --- Derived views -----------------------------------------------------------

  /** Difficulty of a single aggregate, in [0, 1]. */
  private difficultyOf(agg: Aggregate): number {
    if (agg.attempts === 0) return 0;
    const errorRate = 1 - agg.correct / agg.attempts;
    const avgTiming = agg.timingCount > 0 ? agg.timingErrorSum / agg.timingCount : 0;
    const timingComponent = clamp01(avgTiming / TIMING_SCALE_SEC);
    return clamp01(ERROR_RATE_WEIGHT * errorRate + TIMING_WEIGHT * timingComponent);
  }

  /**
   * Difficulty per measure, combining error rate and timing error, sorted hardest
   * first. Ties broken by measure number so the output is stable/deterministic.
   */
  difficultyHeatmap(): MeasureDifficulty[] {
    const rows: MeasureDifficulty[] = [];
    for (const [measure, agg] of this.byMeasure) {
      rows.push({ measure, difficulty: this.difficultyOf(agg) });
    }
    rows.sort((a, b) =>
      b.difficulty - a.difficulty || a.measure - b.measure,
    );
    return rows;
  }

  /**
   * The `n` weakest measures to drill next, spaced-repetition flavored.
   *
   * Priority = difficulty * (1 + FAIL_ESCALATION * failCount) * recencyFactor,
   * where recencyFactor in [0.5, 1] rewards recently-attempted (and thus fresh in
   * the session) measures. A measure failed repeatedly therefore ranks above an
   * equally-hard measure failed once, and stale measures decay in priority.
   */
  recommendPractice(n = 5): number[] {
    const maxSeq = this.seq || 1;
    const scored: { measure: number; score: number }[] = [];
    for (const [measure, agg] of this.byMeasure) {
      const difficulty = this.difficultyOf(agg);
      if (difficulty <= 0) continue; // nothing to drill on a clean measure
      const recencyFactor = 0.5 + 0.5 * (agg.lastSeq / maxSeq);
      const score = difficulty * (1 + FAIL_ESCALATION * agg.failCount) * recencyFactor;
      scored.push({ measure, score });
    }
    scored.sort((a, b) => b.score - a.score || a.measure - b.measure);
    return scored.slice(0, Math.max(0, n)).map((s) => s.measure);
  }

  /** Forget everything (new take / new user). */
  reset(): void {
    this.byMeasure.clear();
    this.byPitch.clear();
    this.seq = 0;
  }
}
