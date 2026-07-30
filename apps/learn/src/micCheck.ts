/**
 * Microphone check — the step that has to exist before a learner sits at a real
 * piano and presses "empezar".
 *
 * Without it, a session that fails is indistinguishable from "this app does not
 * work": maybe the mic is muted, maybe the phone is too far from the strings,
 * maybe the room is too noisy, maybe the piano is a semitone flat. This runs the
 * cheap monophonic engine (MOTOR 1 / YIN) straight off the microphone and reports
 * three things the learner can act on: how loud the input is, what pitch we think
 * we hear, and how quiet the room is when nobody plays.
 *
 * It deliberately does NOT go through `PracticeSession`: there is no score to
 * follow here, and the point is to observe the raw signal.
 */
import { YinDetector, type AudioFrame } from "@arpeggio/practice-engine";
import { MicSource } from "@arpeggio/practice-web";

export interface MicReading {
  /** Short-time RMS of the most recent frame, roughly 0–1. */
  rms: number;
  /** Rounded MIDI pitch, or null when the frame is unvoiced. */
  midi: number | null;
  /** YIN's voiced probability, 0–1. */
  confidence: number;
}

/** How the input level reads to a human. */
export type LevelVerdict = "silence" | "quiet" | "good" | "loud" | "clipping";

/**
 * Thresholds for the verdict, in RMS.
 *
 * A piano recorded a metre away on a phone mic sits around 0.03–0.2 RMS; below
 * 0.01 the pitch tracker has nothing to work with, and past 0.6 the input is
 * almost certainly clipping, which destroys onsets.
 */
export function levelVerdict(rms: number): LevelVerdict {
  if (rms < 0.004) return "silence";
  if (rms < 0.02) return "quiet";
  if (rms > 0.6) return "clipping";
  if (rms > 0.35) return "loud";
  return "good";
}

export class MicCheck {
  private source: MicSource | null = null;
  private readonly yin = new YinDetector();
  private frames = 0;
  /** Highest RMS seen since the last `resetPeak()` — used for the noise floor. */
  private peakRms = 0;
  /** Rolling sum for a mean, which is what a noise floor actually is. */
  private rmsSum = 0;
  private rmsCount = 0;

  /** Human-readable state of the underlying capture ("listening", "denied", …). */
  get label(): string {
    return this.source?.label ?? "idle";
  }

  get peak(): number {
    return this.peakRms;
  }

  /** Mean RMS since the last reset. With the room silent, this is the floor. */
  get meanRms(): number {
    return this.rmsCount > 0 ? this.rmsSum / this.rmsCount : 0;
  }

  resetPeak(): void {
    this.peakRms = 0;
    this.rmsSum = 0;
    this.rmsCount = 0;
  }

  /**
   * Open the microphone and start reporting. Readings are throttled to every
   * other frame (~11 per second at 2048 samples / 44.1 kHz) — fast enough for a
   * live meter, slow enough not to thrash the DOM.
   */
  async start(onReading: (reading: MicReading) => void): Promise<void> {
    this.stop();
    this.resetPeak();
    const source = new MicSource();
    this.source = source;
    await source.start((frame: AudioFrame) => {
      const estimate = this.yin.process(frame);
      const rms = estimate.energy;
      this.peakRms = Math.max(this.peakRms, rms);
      this.rmsSum += rms;
      this.rmsCount++;
      if (this.frames++ % 2 !== 0) return;
      onReading({
        rms,
        midi: estimate.midi === null ? null : Math.round(estimate.midi),
        confidence: estimate.probability,
      });
    });
  }

  stop(): void {
    this.source?.stop();
    this.source = null;
    this.frames = 0;
  }
}
