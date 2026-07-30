/**
 * Feedback loop 1 — per-user / per-room threshold calibration.
 *
 * The combiner (detection/) and follower/ read a small set of `Thresholds`. Those
 * defaults are reasonable in the lab, but a real living-room + a specific piano +
 * a specific microphone shift the operating point: how noisy silence is, how often
 * the cheap monophonic engine (MOTOR 1) is trustworthy, and therefore how eagerly
 * we should escalate to the expensive polyphonic engine (MOTOR 2).
 *
 * `ThresholdCalibrator` watches how the detectors are actually doing and nudges the
 * thresholds with SMALL, bounded steps so the system slowly adapts without ever
 * lurching. All outputs stay clamped to sane ranges.
 *
 * High-certainty moments as pseudo-labels
 * ---------------------------------------
 * We never have ground truth on-device, so we manufacture it: when both engines and
 * the score-follower's timing all agree on the same note, that agreement is treated
 * as a high-weight pseudo-label — a moment we are confident enough about to learn
 * from. Set `highCertainty: true` on those observations. Everything else is low
 * weight.
 *
 * Safety caveat
 * -------------
 * Only high-confidence agreements should be allowed to move thresholds much. A noisy
 * or ambiguous frame must barely budge the operating point, otherwise the loop would
 * chase its own detection noise and drift. That is why low-certainty observations are
 * heavily down-weighted and every step is tiny and clamped.
 */
import type { Thresholds } from "../types.js";
import { DEFAULT_THRESHOLDS } from "../types.js";

/** One piece of evidence about how the detectors performed on a frame/note. */
export interface CalibrationObservation {
  /**
   * Whether MOTOR 1's decision agreed with the eventually-confirmed note.
   * Omit when there was no decision to grade (e.g. a pure silence frame).
   */
  motor1Correct?: boolean;
  /** MOTOR 1's monophonic confidence for this decision, in [0, 1]. */
  monoConfidence?: number;
  /** Short-time frame energy (RMS-ish), used to learn the noise floor. */
  frameEnergy?: number;
  /**
   * True if this frame was during playing, false if during silence. Silence frames
   * feed the noise-floor estimate that drives `silenceEnergy`.
   */
  playing?: boolean;
  /**
   * True when both engines + follower timing agreed: a high-weight pseudo-label.
   * Such observations are trusted to move thresholds; others barely do.
   */
  highCertainty?: boolean;
}

/** Clamp a value into [lo, hi]. */
function clamp(value: number, lo: number, hi: number): number {
  return value < lo ? lo : value > hi ? hi : value;
}

// Tuning constants. All deliberately small so adaptation is gradual and safe.
const BASE_STEP = 0.02; // max threshold nudge per fully-trusted observation
const LOW_CERTAINTY_WEIGHT = 0.25; // down-weight for ambiguous observations (safety)
const NOISE_EMA = 0.1; // smoothing for the silence noise-floor tracker
const SILENCE_MIN = 1e-4; // sane lower bound for silenceEnergy
const SILENCE_MAX = 0.1; // sane upper bound for silenceEnergy

export class ThresholdCalibrator {
  private thresholds: Thresholds;
  /** Running EMA of MOTOR 1 correctness, purely for diagnostics/inspection. */
  private motor1CorrectEma = 1;
  private motor1Samples = 0;
  /** Running EMA of the noise floor observed during silence. */
  private noiseFloor: number;

  constructor(initial: Thresholds = DEFAULT_THRESHOLDS) {
    // Copy so callers can't mutate our state through the reference they passed in.
    this.thresholds = { ...initial };
    this.noiseFloor = initial.silenceEnergy;
  }

  /**
   * Ingest one observation and nudge the thresholds accordingly.
   *
   * Update rule (all steps clamped):
   *  - Effective weight = highCertainty ? 1 : LOW_CERTAINTY_WEIGHT, further scaled
   *    by monoConfidence when supplied (a low-confidence call is weak evidence).
   *  - If MOTOR 1 was WRONG here, it is under-performing in this room: raise
   *    `thetaLow` (escalate to MOTOR 2 sooner), lower `monoWeight`, raise
   *    `polyWeight`.
   *  - If MOTOR 1 was RIGHT, do the reverse by the same small step.
   *  - During silence, blend `frameEnergy` into the noise-floor EMA and track
   *    `silenceEnergy` toward it.
   */
  observe(obs: CalibrationObservation): void {
    if (typeof obs.motor1Correct === "boolean") {
      this.motor1Samples += 1;
      const hit = obs.motor1Correct ? 1 : 0;
      // Simple running mean is enough here; used only for getStats()/inspection.
      this.motor1CorrectEma += (hit - this.motor1CorrectEma) / this.motor1Samples;

      // Confidence-scaled trust. High-certainty pseudo-labels move thresholds; a
      // low-confidence or ambiguous frame barely does (the safety caveat).
      const certainty = obs.highCertainty ? 1 : LOW_CERTAINTY_WEIGHT;
      const confScale =
        typeof obs.monoConfidence === "number" ? clamp(obs.monoConfidence, 0, 1) : 1;
      const step = BASE_STEP * certainty * confScale;

      // direction: +1 when MOTOR 1 is wrong (escalate), -1 when right (trust mono).
      const dir = obs.motor1Correct ? -1 : 1;
      this.thresholds.thetaLow = clamp(this.thresholds.thetaLow + dir * step, 0, 1);
      this.shiftFusion(dir * step);
    }

    if (obs.playing === false && typeof obs.frameEnergy === "number") {
      // Learn the room's noise floor from silence and track silenceEnergy toward it.
      this.noiseFloor += NOISE_EMA * (obs.frameEnergy - this.noiseFloor);
      const next =
        this.thresholds.silenceEnergy +
        NOISE_EMA * (this.noiseFloor - this.thresholds.silenceEnergy);
      this.thresholds.silenceEnergy = clamp(next, SILENCE_MIN, SILENCE_MAX);
    }
  }

  /**
   * Move fusion weight from mono toward poly by `delta` (or the reverse when
   * `delta` is negative), then clamp both to [0, 1] and renormalize to sum 1.
   */
  private shiftFusion(delta: number): void {
    let mono = clamp(this.thresholds.monoWeight - delta, 0, 1);
    let poly = clamp(this.thresholds.polyWeight + delta, 0, 1);
    const sum = mono + poly;
    if (sum <= 0) {
      // Degenerate guard: fall back to an even split.
      mono = 0.5;
      poly = 0.5;
    } else {
      mono /= sum;
      poly /= sum;
    }
    this.thresholds.monoWeight = mono;
    this.thresholds.polyWeight = poly;
  }

  /** Current calibrated thresholds (a copy — callers cannot mutate our state). */
  getThresholds(): Thresholds {
    return { ...this.thresholds };
  }

  /** Diagnostics: running MOTOR 1 correctness rate and learned noise floor. */
  getStats(): { motor1CorrectRate: number; noiseFloor: number; samples: number } {
    return {
      motor1CorrectRate: this.motor1CorrectEma,
      noiseFloor: this.noiseFloor,
      samples: this.motor1Samples,
    };
  }
}
