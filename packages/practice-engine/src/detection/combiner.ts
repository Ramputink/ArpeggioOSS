/**
 * THE COMBINER — fuses MOTOR 1 (cheap monophonic YIN) and MOTOR 2 (heavy
 * polyphonic Basic Pitch) into a single {@link DetectionResult}.
 *
 * Guiding principle: MOTOR 1 is the default because it is cheap and low-latency.
 * MOTOR 2 is expensive, so it is only invoked **on demand** when the monophonic
 * read is untrustworthy or the score itself expects polyphony. The escalation
 * rules are:
 *
 *   (a) STRUCTURAL — the score expects a chord / polyphony at this position.
 *   (b) LOW CONFIDENCE — mono voiced probability < `thresholds.thetaLow`.
 *   (c) DISAGREEMENT — mono's pitch does not match any expected pitch.
 *   (d) LOUD-BUT-UNSTABLE — high energy yet no stable mono pitch (a chord smears
 *       YIN's autocorrelation, giving strong energy but weak periodicity).
 *
 * Rules (b)–(d) are *soft*: audio is noisy and a single bad frame should not
 * flip the engine, so they are debounced through temporal hysteresis — a soft
 * trigger must persist for `hysteresisFrames` consecutive frames (default 3)
 * before the decision switches, and likewise before it relaxes back to mono.
 * Rule (a) is *structural*: the score is authoritative and deterministic, so it
 * escalates immediately without waiting.
 *
 * Confidences are fused with the mono/poly weights from {@link Thresholds}.
 */
import type {
  AudioFrame,
  DetectedNote,
  DetectionResult,
  EngineId,
  PitchEstimate,
  PolyphonicDetector,
  Thresholds,
} from "../types.js";
import { DEFAULT_THRESHOLDS } from "../types.js";

/** What the score expects at the current position (from the follower). */
export interface ExpectedContext {
  /** True when the score has two or more simultaneous notes here (a chord). */
  polyphony?: boolean;
  /** The integer MIDI pitch(es) the score expects, if known. */
  expectedMidi?: number[];
}

/** Tuning knobs for {@link Combiner}. */
export interface CombinerOptions {
  /** Fusion thresholds (defaults to {@link DEFAULT_THRESHOLDS}). */
  thresholds?: Thresholds;
  /** Consecutive soft-trigger frames required before switching. Default 3. */
  hysteresisFrames?: number;
  /** Semitone tolerance for mono-vs-expected agreement. Default 0.5. */
  pitchTolerance?: number;
  /**
   * Confidence above which a loud mono pitch is trusted as truly monophonic.
   * Used by rule (d): a loud frame whose confidence is only *moderate* (between
   * `thetaLow` and this) is a likely chord smear and escalates to MOTOR 2.
   * Must be > `thetaLow`. Default 0.85.
   */
  thetaHigh?: number;
}

/** Fuses the two engines with temporal hysteresis to avoid decision flicker. */
export class Combiner {
  private readonly poly: PolyphonicDetector;
  private readonly thresholds: Thresholds;
  private readonly hysteresisFrames: number;
  private readonly pitchTolerance: number;
  private readonly thetaHigh: number;

  // Hysteresis state, carried across `combine()` calls.
  private decision: EngineId = "mono";
  private pendingDecision: EngineId | null = null;
  private pendingCount = 0;

  constructor(poly: PolyphonicDetector, opts: CombinerOptions = {}) {
    this.poly = poly;
    this.thresholds = opts.thresholds ?? DEFAULT_THRESHOLDS;
    this.hysteresisFrames = opts.hysteresisFrames ?? 3;
    this.pitchTolerance = opts.pitchTolerance ?? 0.5;
    // Keep thetaHigh strictly above thetaLow so rule (d) has a real window.
    this.thetaHigh = Math.max(opts.thetaHigh ?? 0.85, this.thresholds.thetaLow + 1e-3);
  }

  /** The engine the combiner currently trusts (after hysteresis). */
  get currentEngine(): EngineId {
    return this.decision;
  }

  /**
   * Decide which engine to trust for this frame and return a
   * {@link DetectionResult}. MOTOR 2 is only called when the (post-hysteresis)
   * decision is `"poly"`.
   *
   * @param estimate MOTOR 1's per-frame pitch estimate.
   * @param frames   The audio window handed to MOTOR 2 if it is invoked.
   * @param expected What the score expects here (optional).
   * @param thresholds Per-call threshold override (defaults to construction-time).
   */
  async combine(
    estimate: PitchEstimate,
    frames: AudioFrame[] = [],
    expected: ExpectedContext = {},
    thresholds: Thresholds = this.thresholds,
  ): Promise<DetectionResult> {
    // --- evaluate the escalation rules for this frame ------------------------
    const structural = expected.polyphony === true; // rule (a)
    const lowConfidence = estimate.probability < thresholds.thetaLow; // rule (b)
    const disagreement = this.disagrees(estimate, expected); // rule (c)
    const loudButUnstable = this.loudButUnstable(estimate, thresholds); // rule (d)
    const soft = lowConfidence || disagreement || loudButUnstable;

    // --- apply temporal hysteresis ------------------------------------------
    if (structural) {
      // The score is authoritative: escalate immediately, no debounce.
      this.decision = "poly";
      this.pendingDecision = null;
      this.pendingCount = 0;
    } else {
      const desired: EngineId = soft ? "poly" : "mono";
      if (desired === this.decision) {
        // Already where we want to be; clear any pending switch.
        this.pendingDecision = null;
        this.pendingCount = 0;
      } else {
        if (this.pendingDecision === desired) this.pendingCount++;
        else {
          this.pendingDecision = desired;
          this.pendingCount = 1;
        }
        if (this.pendingCount >= this.hysteresisFrames) {
          this.decision = desired;
          this.pendingDecision = null;
          this.pendingCount = 0;
        }
      }
    }

    // --- produce the result for the settled decision ------------------------
    if (this.decision === "poly") {
      const polyNotes = await this.poly.detect(frames);
      return {
        notes: polyNotes,
        engine: "poly",
        confidence: this.fuseConfidence(estimate, polyNotes, thresholds),
      };
    }
    return this.monoResult(estimate);
  }

  /** Reset hysteresis state between takes. */
  reset(): void {
    this.decision = "mono";
    this.pendingDecision = null;
    this.pendingCount = 0;
  }

  // --- helpers --------------------------------------------------------------

  /** Rule (c): mono has a pitch but it matches none of the expected pitches. */
  private disagrees(estimate: PitchEstimate, expected: ExpectedContext): boolean {
    const expectedMidi = expected.expectedMidi;
    if (!expectedMidi || expectedMidi.length === 0) return false;
    if (estimate.midi === null) return false; // unvoiced is handled by rule (b)
    const m = estimate.midi;
    return !expectedMidi.some((e) => Math.abs(e - m) <= this.pitchTolerance);
  }

  /** Rule (d): loud energy but the mono pitch isn't *high*-confidence.
   *
   * Uses `thetaHigh` (not `thetaLow`) so this is a genuinely independent trigger
   * from rule (b): a loud chord where YIN latches a partial and returns only
   * moderate confidence (thetaLow ≤ prob < thetaHigh) — which rule (b) misses —
   * is exactly the "chord smears the autocorrelation" case MOTOR 2 should catch. */
  private loudButUnstable(estimate: PitchEstimate, thresholds: Thresholds): boolean {
    const loud = estimate.energy >= Math.max(0.05, thresholds.silenceEnergy * 5);
    const unstable = estimate.midi === null || estimate.probability < this.thetaHigh;
    return loud && unstable;
  }

  /** Build a mono DetectionResult straight from the frame estimate. */
  private monoResult(estimate: PitchEstimate): DetectionResult {
    const notes: DetectedNote[] =
      estimate.midi === null
        ? []
        : [
            {
              midi: Math.round(estimate.midi),
              onsetSec: estimate.timeSec,
              offsetSec: null,
              confidence: estimate.probability,
              engine: "mono",
            },
          ];
    return { notes, engine: "mono", confidence: estimate.probability };
  }

  /** Weighted fusion of the mono probability and the mean poly confidence. */
  private fuseConfidence(
    estimate: PitchEstimate,
    polyNotes: DetectedNote[],
    thresholds: Thresholds,
  ): number {
    const polyConf =
      polyNotes.length > 0
        ? polyNotes.reduce((s, n) => s + n.confidence, 0) / polyNotes.length
        : 0;
    const wSum = thresholds.monoWeight + thresholds.polyWeight;
    if (wSum <= 0) return polyConf;
    const fused =
      (thresholds.monoWeight * estimate.probability + thresholds.polyWeight * polyConf) / wSum;
    return Math.min(1, Math.max(0, fused));
  }
}

/**
 * Convenience functional wrapper around {@link Combiner} for one-shot fusion
 * without holding onto an instance. NOTE: this creates a fresh combiner each
 * call, so it carries no hysteresis history — prefer a long-lived `Combiner`
 * for streaming audio.
 */
export async function combine(
  estimate: PitchEstimate,
  poly: PolyphonicDetector,
  frames: AudioFrame[] = [],
  expected: ExpectedContext = {},
  opts: CombinerOptions = {},
): Promise<DetectionResult> {
  return new Combiner(poly, opts).combine(estimate, frames, expected, opts.thresholds);
}
