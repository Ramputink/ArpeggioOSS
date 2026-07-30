/**
 * Measuring how long a note takes to travel from the key to the cursor.
 *
 * This matters more than any visual detail once a real piano is involved: if the
 * cursor moves 300 ms after you play, you stop trusting it and start watching
 * your hands instead. Nobody had measured it, so this makes it measurable.
 *
 * What is measured here is the SOFTWARE path — capture callback to judged event:
 * frame queueing, windowing, YIN, and (in chord mode) Basic Pitch inference. The
 * hardware path in front of it (the microphone, the OS input buffer) is reported
 * separately from `AudioContext.baseLatency`, because it cannot be observed from
 * script and adding an unmeasured guess to a measured number would be worse than
 * showing both.
 *
 *     key ──[hardware: baseLatency]──► capture callback ──[measured]──► cursor
 */
import type { AudioFrame, FrameSource } from "@arpeggio/practice-web";

/** A latency distribution, in milliseconds. */
export interface LatencyStats {
  samples: number;
  p50: number;
  p95: number;
  worst: number;
}

/**
 * Records, for each captured frame, the wall clock at which it arrived, so that
 * a judged event carrying that frame's audio-clock time can be dated.
 *
 * Bounded: only the most recent frames are retained, because a note is judged
 * within a window or two of arriving and an unbounded map would leak for the
 * length of the session.
 */
export class LatencyMeter {
  private readonly arrival = new Map<number, number>();
  private readonly samplesMs: number[] = [];
  private static readonly MAX_TRACKED_FRAMES = 256;
  private static readonly MAX_SAMPLES = 512;

  /** Note that a frame stamped `timeSec` on the audio clock has just arrived. */
  frameArrived(timeSec: number): void {
    this.arrival.set(timeSec, performance.now());
    if (this.arrival.size > LatencyMeter.MAX_TRACKED_FRAMES) {
      // Maps iterate in insertion order, so the first key is the oldest frame.
      const oldest = this.arrival.keys().next();
      if (!oldest.done) this.arrival.delete(oldest.value);
    }
  }

  /**
   * Record the delay for an event whose detection was stamped `timeSec`.
   * Unknown stamps are ignored rather than guessed at.
   */
  eventJudged(timeSec: number): void {
    const arrived = this.arrival.get(timeSec);
    if (arrived === undefined) return;
    this.samplesMs.push(performance.now() - arrived);
    if (this.samplesMs.length > LatencyMeter.MAX_SAMPLES) this.samplesMs.shift();
  }

  get stats(): LatencyStats {
    if (this.samplesMs.length === 0) return { samples: 0, p50: 0, p95: 0, worst: 0 };
    const sorted = [...this.samplesMs].sort((a, b) => a - b);
    const at = (q: number): number =>
      sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
    return {
      samples: sorted.length,
      p50: Math.round(at(0.5)),
      p95: Math.round(at(0.95)),
      worst: Math.round(sorted[sorted.length - 1]),
    };
  }

  reset(): void {
    this.arrival.clear();
    this.samplesMs.length = 0;
  }
}

/**
 * Wraps a frame source so every frame is dated on arrival. Transparent
 * otherwise — the practice loop cannot tell the difference.
 */
export class MeteredSource implements FrameSource {
  constructor(
    private readonly inner: FrameSource,
    private readonly meter: LatencyMeter,
  ) {}

  get label(): string {
    return this.inner.label;
  }

  async start(onFrame: (frame: AudioFrame) => void): Promise<void> {
    await this.inner.start((frame) => {
      this.meter.frameArrived(frame.timeSec);
      onFrame(frame);
    });
  }

  stop(): void {
    this.inner.stop();
  }
}

/**
 * Theoretical floor of the software path, in milliseconds, from the frame size
 * and how many frames are batched into a window.
 *
 * Worth stating explicitly: a window cannot be judged before its last frame has
 * been captured, so batching N frames costs N × frame duration before any
 * processing begins. This is the number to attack first — it dwarfs YIN.
 */
export function windowLatencyMs(
  frameSamples: number,
  framesPerWindow: number,
  sampleRate: number,
): number {
  return (frameSamples * framesPerWindow * 1000) / sampleRate;
}

/** How the measured figure reads to a musician. */
export type LatencyVerdict = "imperceptible" | "good" | "noticeable" | "bad";

/**
 * Thresholds chosen from what a player can feel rather than from round numbers:
 * under ~30 ms a delay is inaudible, up to ~80 ms it feels responsive, past
 * ~150 ms the cursor is visibly behind the hands and stops being trustworthy.
 */
export function latencyVerdict(ms: number): LatencyVerdict {
  if (ms < 30) return "imperceptible";
  if (ms < 80) return "good";
  if (ms < 150) return "noticeable";
  return "bad";
}
