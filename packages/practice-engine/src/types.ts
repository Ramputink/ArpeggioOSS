/**
 * Shared contracts for the practice engine.
 *
 * These types are the seams between the three subsystems so they can be built
 * and tested independently:
 *   detection/  audio -> DetectedNote[]        (MOTOR 1, MOTOR 2, combiner)
 *   follower/   DetectedNote[] + Score -> where-are-we + PlayerEvent[]
 *   feedback/   PlayerEvent[] -> updated thresholds + student model
 *
 * Timing convention: audio-domain values are in **seconds**; score-domain
 * values are in **quarter-note beats** (matching @arpeggio/musicxml-parser's
 * `NoteEvent.onset`). The follower is what bridges the two clocks.
 */

// ---------------------------------------------------------------------------
// Audio + detection
// ---------------------------------------------------------------------------

/** A block of mono PCM samples with its start time on the audio clock. */
export interface AudioFrame {
  /** Mono samples in [-1, 1]. */
  samples: Float32Array;
  /** Samples per second (e.g. 44100). */
  sampleRate: number;
  /** Start time of this frame on the audio clock, in seconds. */
  timeSec: number;
}

/** Which detection engine produced a result. */
export type EngineId = "mono" | "poly";

/** A per-frame pitch estimate from the monophonic engine (MOTOR 1). */
export interface PitchEstimate {
  /** Fundamental as a (possibly fractional) MIDI number, or null if unvoiced. */
  midi: number | null;
  /** Fundamental frequency in Hz, or null if unvoiced. */
  hz: number | null;
  /** Confidence in [0, 1] (pYIN-style voiced probability). */
  probability: number;
  /** Short-time energy (RMS) of the frame, in [0, 1]-ish. */
  energy: number;
  /** Frame time on the audio clock, in seconds. */
  timeSec: number;
}

/** A detected note event on the audio clock. */
export interface DetectedNote {
  /** Integer MIDI pitch. */
  midi: number;
  /** Onset time in seconds. */
  onsetSec: number;
  /** Offset time in seconds, or null while still sounding. */
  offsetSec: number | null;
  /** Detection confidence in [0, 1]. */
  confidence: number;
  /** Which engine detected it. */
  engine: EngineId;
}

/** The combiner's output for a slice of audio. */
export interface DetectionResult {
  /** Notes believed to be sounding (1 for melody, >1 for chords). */
  notes: DetectedNote[];
  /** Engine whose decision was used. */
  engine: EngineId;
  /** Overall confidence in [0, 1]. */
  confidence: number;
}

/** MOTOR 1 — cheap, per-frame, monophonic (YIN/pYIN). */
export interface MonophonicDetector {
  /** Estimate pitch for one frame. */
  process(frame: AudioFrame): PitchEstimate;
  /** Clear any internal state between takes. */
  reset(): void;
}

/** MOTOR 2 — heavy, polyphonic (e.g. Basic Pitch). Called on demand. */
export interface PolyphonicDetector {
  /** Transcribe a window of audio into note events. May be async (ML model). */
  detect(frames: AudioFrame[]): Promise<DetectedNote[]>;
}

// ---------------------------------------------------------------------------
// Score following
// ---------------------------------------------------------------------------

/**
 * The note(s) the score expects at a position, derived from the canonical
 * `Score.events` (see @arpeggio/musicxml-parser). Onsets are in quarter beats.
 */
export interface ExpectedNote {
  midi: number;
  /** Onset in quarter-note beats from the start of the piece. */
  onset: number;
  /** Offset in quarter-note beats. */
  offset: number;
  measure: number;
  voice: number;
  staff: number;
}

/** Where the follower currently believes the player is. */
export interface FollowState {
  /** Index into the expected-note sequence (next note to be played). */
  index: number;
  /** Current measure number. */
  measure: number;
  /** Onset (in beats) of the current expected position. */
  positionBeats: number;
  /** True when the follower is waiting for the player to hit the note. */
  waiting: boolean;
  /** True once the end of the piece has been reached. */
  done: boolean;
}

/** How a player action was judged relative to what the score expected. */
export type PlayerEventKind = "correct" | "wrong" | "hesitation" | "early" | "late";

/** A judged player action emitted by the follower. */
export interface PlayerEvent {
  kind: PlayerEventKind;
  /** The pitch the score expected here, if any. */
  expectedMidi?: number;
  /** The pitch the player actually produced, if any. */
  playedMidi?: number;
  /** Score position (beats) this event pertains to. */
  atBeat: number;
  /** Audio-clock time of the player's action, in seconds. */
  timeSec: number;
  /** Timing error in seconds (played - expected); present for correct/early/late. */
  timingErrorSec?: number;
  /**
   * Octave displacement on a `wrong` event whose pitch class was right, in
   * octaves (-1 = an octave too low, +2 = two octaves too high).
   *
   * The most common mistake at a real keyboard is the right note in the wrong
   * octave — a misplaced hand, not a misread note. Reporting it as an
   * undifferentiated `wrong` tells the learner nothing about what to fix, so the
   * follower measures it and the UI can say which way to move.
   */
  octaveOff?: number;
}

// ---------------------------------------------------------------------------
// Feedback / adaptation
// ---------------------------------------------------------------------------

/** Tunable thresholds for the combiner + follower (adapted by feedback loop 1). */
export interface Thresholds {
  /** Below this MOTOR 1 confidence, escalate to MOTOR 2. */
  thetaLow: number;
  /** Fusion weight for MOTOR 1 in [0, 1]. */
  monoWeight: number;
  /** Fusion weight for MOTOR 2 in [0, 1]. */
  polyWeight: number;
  /** Energy below this is treated as silence. */
  silenceEnergy: number;
}

/** Per-target practice statistics (feedback loop 2 — the student model). */
export interface NoteStat {
  /** Times this target was attempted. */
  attempts: number;
  /** Times it was played correctly. */
  correct: number;
  /** Mean absolute timing error in seconds. */
  avgTimingError: number;
}

/** Sensible starting thresholds before any calibration. */
export const DEFAULT_THRESHOLDS: Thresholds = {
  thetaLow: 0.5,
  monoWeight: 0.6,
  polyWeight: 0.4,
  silenceEnergy: 0.01,
};
