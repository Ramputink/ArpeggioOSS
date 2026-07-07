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
import {
  FollowYouFollower,
  expectedNotesFromScore,
  groupChords,
} from "./follower/index.js";
import {
  StudentModel,
  ThresholdCalibrator,
  type MeasureDifficulty,
} from "./feedback/index.js";
import type {
  AudioFrame,
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

  constructor(score: Score, opts: SessionOptions = {}) {
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

    // Run the combiner across the window; its settled decision picks the engine.
    let decision: DetectionResult = { notes: [], engine: "mono", confidence: 0 };
    for (const est of estimates) {
      decision = await this.combiner.combine(est, frames, expected);
    }

    // Discrete notes for the follower: MOTOR 2's own notes when polyphonic,
    // otherwise segment the monophonic pitch track into notes.
    const notes = decision.engine === "poly" ? decision.notes : segmentNotes(estimates);

    const lastTime = frames[frames.length - 1].timeSec;
    const events = [
      ...this.follower.onDetection(notes),
      ...this.follower.onTick(lastTime),
    ];

    // Feed the feedback loops.
    const meanConf = mean(estimates.map((e) => e.probability));
    const meanEnergy = mean(estimates.map((e) => e.energy));
    const silence = this.calibrator.getThresholds().silenceEnergy;
    for (const ev of events) {
      this.student.record(ev, this.follower.state.measure);
      this.calibrator.observe({
        motor1Correct: ev.kind === "correct" && decision.engine === "mono",
        monoConfidence: meanConf,
        frameEnergy: meanEnergy,
        playing: meanEnergy > silence,
        highCertainty: ev.kind === "correct",
      });
    }

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
