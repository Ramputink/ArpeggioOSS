/**
 * MOTOR 1 — cheap, per-frame, monophonic pitch detection (the YIN algorithm).
 *
 * YIN (de Cheveigné & Kawahara, 2002) is a time-domain autocorrelation-style
 * pitch tracker that is fast, allocation-light and robust for a single voice —
 * exactly what a real-time piano tutor needs for the melody line. The steps are:
 *
 *   1. Difference function     d(τ)   = Σ_j (x[j] − x[j+τ])²
 *   2. Cumulative mean norm.   d'(τ)  = d(τ) · τ / Σ_{k≤τ} d(k)   (d'(0)=1)
 *   3. Absolute threshold      pick the first τ where d'(τ) dips below a small
 *                              threshold (default 0.15), then walk to its local
 *                              minimum.
 *   4. Parabolic interpolation refine the integer τ to sub-sample precision.
 *   5. f0 = sampleRate / τ,   MIDI = 69 + 12·log2(f0 / 440).
 *
 * When no lag qualifies (unvoiced) or the frame is below the energy floor we
 * report `{ midi: null, hz: null, probability: 0 }` — silence and noise must not
 * be forced into a pitch. This class holds no state that survives a frame; the
 * `reset()` seam exists for symmetry with the interface and future pYIN-style
 * temporal smoothing.
 */
import type { AudioFrame, PitchEstimate, MonophonicDetector } from "../types.js";

/** Tuning knobs for {@link YinDetector}. */
export interface YinOptions {
  /** Absolute CMND threshold; smaller = stricter periodicity. Default 0.15. */
  threshold?: number;
  /** Lowest fundamental to search for, in Hz (default 55 = A1). */
  fmin?: number;
  /** Highest fundamental to search for, in Hz (default 1500 ≈ F#6). */
  fmax?: number;
  /** RMS below this is treated as silence and reported unvoiced. Default 1e-3. */
  energyFloor?: number;
}

/** Root-mean-square amplitude of a frame, a cheap short-time energy proxy. */
function rms(samples: Float32Array): number {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return samples.length > 0 ? Math.sqrt(sum / samples.length) : 0;
}

/**
 * Refine an integer lag to sub-sample precision by fitting a parabola through
 * the CMND value at `tau` and its two neighbours. `tau` is assumed to sit at a
 * local minimum, so the vertex lies between `tau-1` and `tau+1`.
 */
function parabolicInterpolation(cmnd: Float32Array, tau: number, tauMax: number): number {
  const x0 = tau > 1 ? tau - 1 : tau;
  const x2 = tau + 1 <= tauMax ? tau + 1 : tau;
  if (x0 === tau) return cmnd[tau] <= cmnd[x2] ? tau : x2;
  if (x2 === tau) return cmnd[tau] <= cmnd[x0] ? tau : x0;
  const s0 = cmnd[x0];
  const s1 = cmnd[tau];
  const s2 = cmnd[x2];
  const denom = s0 - 2 * s1 + s2;
  if (denom === 0) return tau;
  // Vertex offset of the parabola through (-1,s0),(0,s1),(1,s2).
  return tau + (0.5 * (s0 - s2)) / denom;
}

/** MOTOR 1: a stateless YIN monophonic pitch detector. */
export class YinDetector implements MonophonicDetector {
  private readonly threshold: number;
  private readonly fmin: number;
  private readonly fmax: number;
  private readonly energyFloor: number;

  constructor(opts: YinOptions = {}) {
    this.threshold = opts.threshold ?? 0.15;
    this.fmin = opts.fmin ?? 55;
    this.fmax = opts.fmax ?? 1500;
    this.energyFloor = opts.energyFloor ?? 1e-3;
  }

  process(frame: AudioFrame): PitchEstimate {
    const { samples, sampleRate, timeSec } = frame;
    const energy = rms(samples);
    const n = samples.length;
    // Use the first half of the frame as the analysis window so that j+τ stays
    // in bounds for every τ we test (τ ≤ W ≤ N/2).
    const w = Math.floor(n / 2);

    // Silence / too-short frames: report unvoiced without inventing a pitch.
    if (energy < this.energyFloor || w < 2) {
      return { midi: null, hz: null, probability: 0, energy, timeSec };
    }

    const tauMin = Math.max(1, Math.floor(sampleRate / this.fmax));
    const tauMax = Math.min(w - 1, Math.ceil(sampleRate / this.fmin));
    if (tauMax <= tauMin) {
      return { midi: null, hz: null, probability: 0, energy, timeSec };
    }

    // (1) Difference function d(τ).
    const d = new Float32Array(tauMax + 1);
    for (let tau = 1; tau <= tauMax; tau++) {
      let sum = 0;
      for (let j = 0; j < w; j++) {
        const diff = samples[j] - samples[j + tau];
        sum += diff * diff;
      }
      d[tau] = sum;
    }

    // (2) Cumulative mean normalized difference d'(τ).
    const cmnd = new Float32Array(tauMax + 1);
    cmnd[0] = 1;
    let runningSum = 0;
    for (let tau = 1; tau <= tauMax; tau++) {
      runningSum += d[tau];
      cmnd[tau] = runningSum > 0 ? (d[tau] * tau) / runningSum : 1;
    }

    // (3) Absolute threshold: first dip below `threshold`, then its local min.
    let tauEstimate = -1;
    for (let tau = tauMin; tau <= tauMax; tau++) {
      if (cmnd[tau] < this.threshold) {
        while (tau + 1 <= tauMax && cmnd[tau + 1] < cmnd[tau]) tau++;
        tauEstimate = tau;
        break;
      }
    }

    // Nothing periodic enough → unvoiced (noise, breath, key click, ...).
    if (tauEstimate === -1) {
      return { midi: null, hz: null, probability: 0, energy, timeSec };
    }

    // (4) Sub-sample refinement, then (5) Hz → MIDI.
    const betterTau = parabolicInterpolation(cmnd, tauEstimate, tauMax);
    const hz = sampleRate / betterTau;
    if (hz < this.fmin || hz > this.fmax) {
      return { midi: null, hz: null, probability: 0, energy, timeSec };
    }
    const midi = 69 + 12 * Math.log2(hz / 440);
    // Voiced probability from aperiodicity: a deep CMND minimum → high pitch
    // confidence. Clamp into [0, 1].
    const probability = Math.min(1, Math.max(0, 1 - cmnd[tauEstimate]));

    return { midi, hz, probability, energy, timeSec };
  }

  /** No cross-frame state to clear yet; kept for the interface contract. */
  reset(): void {
    // Intentionally empty — YIN here is stateless per frame.
  }
}

// ---------------------------------------------------------------------------
// Note segmentation
// ---------------------------------------------------------------------------

/** Tuning knobs for {@link segmentNotes}. */
export interface SegmentOptions {
  /** Frames below this voiced probability are treated as rests. Default 0.5. */
  minProbability?: number;
  /** Frames below this RMS energy are treated as rests. Default 0.01. */
  minEnergy?: number;
  /** Minimum consecutive frames for a note; shorter runs are dropped as blips.
   *  Default 3. */
  minFrames?: number;
}

/** Internal accumulator for a note currently being built. */
interface OpenNote {
  midi: number;
  onsetSec: number;
  probSum: number;
  frames: number;
}

/**
 * Group a stream of per-frame {@link PitchEstimate}s into discrete
 * {@link DetectedNote}s.
 *
 * A note *onsets* when energy and voiced-probability rise above the thresholds
 * and the rounded MIDI pitch stabilizes; it *offsets* when energy/probability
 * drop (a rest) or the rounded pitch changes. Pitches are rounded to the nearest
 * integer semitone, and runs shorter than `minFrames` are discarded as octave
 * jumps / glitch blips so a single bad frame never becomes a note.
 */
export function segmentNotes(
  estimates: PitchEstimate[],
  opts: SegmentOptions = {},
): import("../types.js").DetectedNote[] {
  const minProbability = opts.minProbability ?? 0.5;
  const minEnergy = opts.minEnergy ?? 0.01;
  const minFrames = opts.minFrames ?? 3;

  const notes: import("../types.js").DetectedNote[] = [];
  let open: OpenNote | null = null;

  /** Close the open note, emitting it only if it survived long enough. */
  const close = (offsetSec: number | null): void => {
    if (open && open.frames >= minFrames) {
      notes.push({
        midi: open.midi,
        onsetSec: open.onsetSec,
        offsetSec,
        confidence: open.probSum / open.frames,
        engine: "mono",
      });
    }
    open = null;
  };

  for (const est of estimates) {
    const voiced =
      est.midi !== null && est.probability >= minProbability && est.energy >= minEnergy;

    if (!voiced) {
      close(est.timeSec);
      continue;
    }

    const midi = Math.round(est.midi as number);
    if (open && open.midi === midi) {
      open.frames++;
      open.probSum += est.probability;
    } else {
      // Pitch changed (or first voiced frame): the previous note ends here.
      close(est.timeSec);
      open = { midi, onsetSec: est.timeSec, probSum: est.probability, frames: 1 };
    }
  }

  // A note still sounding at the end of the buffer has no observed offset.
  close(null);
  return notes;
}
