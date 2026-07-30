/**
 * PracticeSession — the capstone that wires the three subsystems into one loop:
 *
 *     audio frames
 *        │  MOTOR 1 (YIN) per frame ─┐
 *        ▼                           ├─► Combiner picks engine ─► DetectedNote[]
 *     detection ── MOTOR 2 (poly) ───┘                                │
 *        ▼                                                            ▼
 *     follower  (follow-you: is this the expected note? advance / wait) ─► PlayerEvent[]
 *        ▼
 *     feedback  (student model logs it; calibrator adapts thresholds)
 *
 * This is the on-device practice loop of the roadmap (Phases 4→5→6 joined). It
 * consumes the canonical `Score` from @arpeggio/musicxml-parser and is driven by
 * feeding it windows of audio (a note or a short phrase at a time).
 */
import type { Score } from "@arpeggio/musicxml-parser";

import {
  Combiner,
  StubPolyphonicDetector,
  YinDetector,
  segmentNotes,
  type ExpectedContext,
  type YinOptions,
} from "./detection/index.js";
import { FollowYouFollower, expectedNotesFromScore, groupChords } from "./follower/index.js";
import { StudentModel, ThresholdCalibrator, type MeasureDifficulty } from "./feedback/index.js";
import type {
  AudioFrame,
  DetectedNote,
  DetectionResult,
  ExpectedNote,
  FollowState,
  PlayerEvent,
  PolyphonicDetector,
  Thresholds,
} from "./types.js";

export interface SessionOptions {
  /** MOTOR 2 implementation. Defaults to a stub (real one = Basic Pitch). */
  poly?: PolyphonicDetector;
  /** Starting fusion thresholds. */
  thresholds?: Thresholds;
  /** MOTOR 1 (YIN) tuning. */
  yin?: YinOptions;
  /**
   * The discrete notes heard in each window, before the follower judges them.
   *
   * The session's own follower is the waiting kind: it decides what a note means
   * relative to where it thinks the player is. A caller that grades differently —
   * against a clock, say — needs the notes themselves, not that follower's
   * verdict on them, and has no other way to obtain them.
   */
  onDetections?: (notes: DetectedNote[]) => void;
}

/** A snapshot of the session's state for the UI. */
export interface SessionProgress {
  /** Where the follower believes the player is. */
  state: FollowState;
  /** Current (possibly calibrated) fusion thresholds. */
  thresholds: Thresholds;
  /** Per-measure difficulty, hardest first. */
  difficulty: MeasureDifficulty[];
  /** Measures the student model suggests drilling next. */
  recommend: number[];
}

export class PracticeSession {
  readonly follower: FollowYouFollower;
  readonly student: StudentModel;
  readonly calibrator: ThresholdCalibrator;

  private readonly yin: YinDetector;
  private readonly combiner: Combiner;
  private readonly groups: ExpectedNote[][];
  /** Cumulative expected-note count before each chord group. */
  private readonly notesBefore: number[];

  private readonly opts: SessionOptions;

  constructor(score: Score, opts: SessionOptions = {}) {
    this.opts = opts;
    const poly = opts.poly ?? new StubPolyphonicDetector();
    this.yin = new YinDetector(opts.yin);
    this.combiner = new Combiner(poly, { thresholds: opts.thresholds });
    this.follower = new FollowYouFollower(score);
    this.student = new StudentModel();
    this.calibrator = new ThresholdCalibrator(opts.thresholds);

    const expected = expectedNotesFromScore(score);
    this.groups = groupChords(expected);
    this.notesBefore = [];
    let running = 0;
    for (const g of this.groups) {
      this.notesBefore.push(running);
      running += g.length;
    }
  }

  /** The chord group the follower is currently waiting on. */
  private currentGroup(): ExpectedNote[] {
    const idx = this.follower.state.index;
    let gi = 0;
    for (let i = 0; i < this.groups.length; i++) {
      if (this.notesBefore[i] <= idx) gi = i;
    }
    return this.groups[gi] ?? [];
  }

  /**
   * Feed one window of audio (a single note or a short phrase). Returns the
   * judged player events, and updates the follower + feedback loops in place.
   */
  async listen(frames: AudioFrame[]): Promise<PlayerEvent[]> {
    if (frames.length === 0) return [];

    // MOTOR 1 per frame.
    const estimates = frames.map((f) => this.yin.process(f));

    // Tell the combiner what the score expects here, so it can escalate to
    // MOTOR 2 for chords / low-confidence / disagreement.
    const group = this.currentGroup();
    const expected: ExpectedContext = {
      polyphony: group.length > 1,
      expectedMidi: group.map((n) => n.midi),
    };
    // Capture the measure BEFORE onDetection advances the cursor, so events are
    // filed under the measure actually being played (not the next one).
    const measure = group[0]?.measure ?? this.follower.state.measure;

    // Run the combiner across the window; its settled decision picks the engine.
    let decision: DetectionResult = { notes: [], engine: "mono", confidence: 0 };
    for (const est of estimates) {
      decision = await this.combiner.combine(est, frames, expected);
    }

    // Discrete notes for the follower: MOTOR 2's own notes when polyphonic,
    // otherwise segment the monophonic pitch track into notes.
    const notes = decision.engine === "poly" ? decision.notes : segmentNotes(estimates);
    if (notes.length > 0) this.opts.onDetections?.(notes);

    const lastTime = frames[frames.length - 1].timeSec;
    const events = [...this.follower.onDetection(notes), ...this.follower.onTick(lastTime)];

    // Student model: one record per judged event, under the measure being played.
    for (const ev of events) {
      this.student.record(ev, measure);
    }

    // Calibrator: ONE observation per window (not per event, which would
    // over-count). Only grade MOTOR 1 when the player actually hit a correct
    // note — a `wrong`/`hesitation` means the *player* deviated, not that the
    // detector failed, so we must not treat it as a MOTOR 1 miss (that would
    // wrongly escalate to MOTOR 2 over a session). Silence still feeds the
    // noise-floor estimate.
    const hadCorrect = events.some((e) => e.kind === "correct");
    const meanConf = mean(estimates.map((e) => e.probability));
    const meanEnergy = mean(estimates.map((e) => e.energy));
    const silence = this.calibrator.getThresholds().silenceEnergy;
    this.calibrator.observe({
      motor1Correct: hadCorrect ? decision.engine === "mono" : undefined,
      monoConfidence: meanConf,
      frameEnergy: meanEnergy,
      playing: meanEnergy > silence,
      highCertainty: hadCorrect,
    });

    return events;
  }

  /** A UI-friendly snapshot of where things stand. */
  get progress(): SessionProgress {
    return {
      state: this.follower.state,
      thresholds: this.calibrator.getThresholds(),
      difficulty: this.student.difficultyHeatmap(),
      recommend: this.student.recommendPractice(),
    };
  }
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0;
}
