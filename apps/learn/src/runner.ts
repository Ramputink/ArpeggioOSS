/**
 * Runner — one practice attempt.
 *
 * Two orthogonal choices, deliberately separated:
 *
 *   INPUT    keys  on-screen piano   -> taps judged directly
 *            mic   real instrument   -> audio -> practice-engine (YIN / Basic Pitch)
 *            demo  listen only       -> the app plays; nothing is judged
 *
 *   JUDGING  wait    the cursor waits for you (FollowYouFollower) — forgiving,
 *                    right for a first pass, and says nothing about rhythm
 *           a tempo  the cursor keeps going and grades timing (ATempoJudge) —
 *                    the honest mode, and the one to graduate to
 *
 * Every combination drives the same `onProgress` shape, so the staff and the
 * keyboard know nothing about where the notes came from or how they were graded.
 */
import type { Score } from "@arpeggio/musicxml-parser";
import {
  DtwFollower,
  FollowYouFollower,
  StudentModel,
  expectedNotesFromScore,
  groupChords,
  type DetectedNote,
  type ExpectedNote,
  type PlayerEvent,
} from "@arpeggio/practice-engine";
import { LivePractice, MicSource } from "@arpeggio/practice-web";

import { Accompanist, type AccompanyNote } from "./accompanist.js";
import { ATempoJudge } from "./aTempo.js";
import { LatencyMeter, MeteredSource, type LatencyStats } from "./latency.js";
import { Metronome } from "./metronome.js";
import type { Synth } from "./synth.js";
import { WorkerPolyDetector } from "./workerDetector.js";

export type PracticeMode = "keys" | "mic" | "demo";

export interface RunSummary {
  correct: number;
  wrong: number;
  total: number;
  /** correct / (correct + wrong), or 1 when nothing was judged. */
  accuracy: number;
  completed: boolean;
  /** Mean absolute timing error in seconds; only meaningful in a-tempo mode. */
  meanTimingErrorSec: number | null;
}

export interface RunnerHooks {
  onProgress(p: {
    doneIndex: number;
    total: number;
    positionBeats: number;
    measure: number;
    expected: number[];
  }): void;
  onJudge(event: PlayerEvent): void;
  onStatus(text: string): void;
  onFinish(summary: RunSummary): void;
  /**
   * Every pitch the microphone heard in a window, judged or not.
   *
   * The single most useful thing the app can show at a real piano. Without it,
   * "it isn't recognising my DO4" and "it is hearing DO5" and "it is hearing
   * nothing at all" look identical to the learner — and they need completely
   * different fixes.
   */
  onHeard?(midis: number[]): void;
}

export interface RunnerOptions {
  mode: PracticeMode;
  synth: Synth;
  /** Tempo for demo playback, the metronome and a-tempo grading. */
  bpm: number;
  /** Grade against the clock instead of waiting for the learner. */
  aTempo?: boolean;
  metronome?: boolean;
  beatsPerBar?: number;
  /**
   * The hand the learner is *not* playing, for the app to sound.
   *
   * Ignored in microphone mode, where the speaker feeds back into the
   * microphone and the detector cannot tell the app's notes from the piano's.
   */
  accompany?: AccompanyNote[];
  /** Absolute URLs for the MOTOR 2 model and its worker. */
  modelUrl?: string;
  workerUrl?: string;
  hooks: RunnerHooks;
}

/**
 * Consecutive detections that DTW must place well ahead of the waiting cursor
 * before we accept that the learner has jumped. One stray transcription must not
 * teleport the cursor; three in a row is a restart from the middle.
 */
const RESYNC_VOTES = 3;
/** How far ahead (in expected notes) counts as "somewhere else in the piece". */
const RESYNC_MIN_JUMP = 3;

/** Lead-in before scheduled playback, long enough to survive a slow first frame. */
const SCHEDULE_LEAD_SEC = 0.35;

/**
 * Octaves either side of an expected pitch that a *microphone* detection may be
 * off by and still count.
 *
 * YIN estimates a fundamental by autocorrelation, and a struck piano string with
 * a strong second partial is the textbook case where it answers an octave high.
 * Rejecting that note tells the learner they played the wrong thing when they
 * did not, which they have no way to interpret and no way to fix. Zero for the
 * on-screen keyboard, where a key reports its own pitch and an octave error is
 * genuinely the learner's.
 */
const MIC_OCTAVE_TOLERANCE = 1;

/**
 * Fraction of a chord's tones a *microphone* run must hear before advancing.
 *
 * Half, not all. Requiring every tone requires the transcription to be perfect,
 * and the transcription is precisely the part of this pipeline that is not
 * trusted yet; the cost of being wrong is a cursor that never moves and a
 * learner who cannot tell why. A tapped chord keeps the strict rule, because
 * there the app knows exactly which keys went down.
 */
const MIC_CHORD_FRACTION = 0.5;

export class Runner {
  readonly notes: ExpectedNote[];
  private readonly groups: ExpectedNote[][];
  private readonly notesBefore: number[];

  private readonly score: Score;
  private readonly opts: RunnerOptions;
  private readonly secPerBeat: number;

  /** Wait-mode follower, built over `notes.slice(baseIndex)` after a resync. */
  private follower: FollowYouFollower;
  /** Expected-note offset the current follower was built at. */
  private baseIndex = 0;
  /** A-tempo judge; null in wait mode. */
  private judge: ATempoJudge | null = null;
  /** Elapsed-clock origin for a-tempo and the demo, on `performance.now()/1000`. */
  private startedAtSec = 0;

  private readonly student = new StudentModel();
  private readonly dtw: DtwFollower;
  private resyncVotes = 0;
  private readonly latencyMeter = new LatencyMeter();
  private readonly metronome: Metronome;

  /** The app playing the hand the learner is not; null when not offered. */
  private accompanist: Accompanist | null = null;
  /** In demo mode the other hand is scheduled on the audio clock instead. */
  private readonly demoAccompany: AccompanyNote[];

  private paused = false;
  /** Wall-clock instant the pause began, to shift the a-tempo origin on resume. */
  private pausedAtSec = 0;
  /** Beat the demo has reached, so a paused demo resumes where it stopped. */
  private demoBeat = 0;
  /** Wall-clock origin of the demo currently scheduled. */
  private demoStartWall = 0;

  private live: LivePractice | null = null;
  private mic: MicSource | null = null;
  private poly: WorkerPolyDetector | null = null;
  private raf = 0;
  private stopped = false;
  private finished = false;

  private correct = 0;
  private wrong = 0;
  private timingErrors: number[] = [];
  private measure = 1;

  constructor(score: Score, opts: RunnerOptions) {
    this.score = score;
    this.opts = opts;
    this.secPerBeat = 60 / Math.max(20, opts.bpm);
    this.notes = expectedNotesFromScore(score);
    this.groups = groupChords(this.notes);
    this.notesBefore = [];
    let running = 0;
    for (const g of this.groups) {
      this.notesBefore.push(running);
      running += g.length;
    }
    this.follower = new FollowYouFollower(this.notes);
    this.dtw = new DtwFollower(this.notes);
    this.metronome = new Metronome(opts.synth);

    // The other hand. Never over the microphone: the speaker feeds straight back
    // into it and the detector would score the app's own notes as the learner's.
    const other = opts.mode === "mic" ? [] : (opts.accompany ?? []);
    this.demoAccompany = opts.mode === "demo" ? other : [];
    if (opts.mode === "keys" && other.length > 0) {
      this.accompanist = new Accompanist(other, opts.synth, this.secPerBeat);
    }
  }

  /** Measured software latency from capture callback to judged event. */
  get latency(): LatencyStats {
    return this.latencyMeter.stats;
  }

  /** True while MOTOR 2 inference is running off the main thread. */
  get polyOffThread(): boolean {
    return this.poly?.offThread ?? false;
  }

  /** True when the app is sounding the hand the learner is not playing. */
  get accompanying(): boolean {
    return this.accompanist !== null || this.demoAccompany.length > 0;
  }

  /** True while the attempt is suspended. */
  get isPaused(): boolean {
    return this.paused;
  }

  /** Measures the student model rates as hardest so far. */
  weakestMeasures(limit = 3): number[] {
    return this.student.recommendPractice(limit);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.paused = false;
    this.startedAtSec = performance.now() / 1000;
    if (this.opts.aTempo && this.opts.mode !== "demo") {
      this.judge = new ATempoJudge(this.notes, { secPerBeat: this.secPerBeat });
    }
    // The demo starts its own metronome aligned with the scheduled playback.
    if (this.opts.metronome && this.opts.mode !== "demo") {
      this.metronome.start(this.opts.bpm, this.opts.beatsPerBar ?? 4);
    }

    switch (this.opts.mode) {
      case "keys":
        this.opts.hooks.onStatus(
          this.judge ? "A tempo: sigue el clic" : "Toca las teclas marcadas",
        );
        this.emitProgress();
        if (this.judge) this.startClock();
        break;
      case "demo":
        this.startDemo(0);
        break;
      case "mic":
        await this.startMic();
        if (this.judge) this.startClock();
        break;
    }
  }

  stop(): void {
    this.stopped = true;
    this.paused = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.metronome.stop();
    this.live?.stop();
    this.mic?.stop();
    this.poly?.dispose();
    this.live = null;
    this.mic = null;
    this.poly = null;
    this.opts.synth.allOff();
  }

  // --- pause ----------------------------------------------------------------

  /**
   * Suspend the attempt without losing it.
   *
   * At a real piano you stop constantly — to read a fingering, to work out what
   * a bar says, to answer the door. Before this the only way out was to stop,
   * which threw the run away, so the app quietly punished the exact behaviour
   * that practice is made of.
   *
   * The microphone is deliberately left open: reopening it costs a permission
   * round-trip on iOS and a second of silence. Its detections are ignored.
   */
  pause(): void {
    if (this.paused || this.stopped || this.finished) return;
    this.paused = true;
    this.pausedAtSec = performance.now() / 1000;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.metronome.stop();
    this.opts.synth.allOff();
    this.opts.hooks.onStatus("En pausa");
  }

  resume(): void {
    if (!this.paused || this.stopped || this.finished) return;
    this.paused = false;
    // Everything on the elapsed clock moves forward by however long we waited,
    // so a-tempo grading does not read the pause as a bar of notes played late.
    this.startedAtSec += performance.now() / 1000 - this.pausedAtSec;

    if (this.opts.mode === "demo") {
      // Web Audio cannot un-schedule a note already in the graph, so a paused
      // demo is re-scheduled from the beat it had reached.
      this.startDemo(this.demoBeat);
      return;
    }
    if (this.opts.metronome) {
      const beat = this.judge
        ? this.judge.positionBeats(performance.now() / 1000 - this.startedAtSec)
        : this.follower.state.positionBeats;
      this.metronome.start(this.opts.bpm, this.opts.beatsPerBar ?? 4, undefined, beat);
    }
    this.opts.hooks.onStatus(this.judge ? "A tempo: sigue el clic" : "Seguimos");
    if (this.judge) this.startClock();
    else this.emitProgress();
  }

  // --- on-screen keyboard ---------------------------------------------------

  press(midi: number): void {
    // Only the on-screen keyboard may sound. In microphone mode the app's own
    // output is an input: anything the speaker plays goes back into the mic.
    if (this.opts.mode !== "keys" || this.stopped || this.paused) return;
    this.opts.synth.noteOn(midi);
    const detection: DetectedNote = {
      midi,
      onsetSec: performance.now() / 1000,
      offsetSec: null,
      confidence: 1,
      engine: "mono",
    };
    this.handleEvents(this.judgeDetections([detection]));
  }

  release(midi: number): void {
    if (this.opts.mode !== "keys") return;
    this.opts.synth.noteOff(midi);
  }

  // --- demo playback --------------------------------------------------------

  /**
   * Schedule and follow the piece from `fromBeat`.
   *
   * Taking a starting beat (rather than always starting at zero) is what makes
   * the demo pausable: Web Audio offers no way to cancel a note that is already
   * scheduled, so resuming means scheduling the remainder afresh.
   */
  private startDemo(fromBeat: number): void {
    const { synth, hooks } = this.opts;
    const startAudio = synth.now + SCHEDULE_LEAD_SEC;
    this.demoStartWall = performance.now() / 1000 + SCHEDULE_LEAD_SEC;
    this.demoBeat = fromBeat;

    const schedule = (n: AccompanyNote, velocity: number): void => {
      if (n.offset <= fromBeat) return;
      const at = startAudio + Math.max(0, n.onset - fromBeat) * this.secPerBeat;
      synth.playAt(n.midi, at, (n.offset - n.onset) * this.secPerBeat, velocity);
    };
    for (const n of this.notes) schedule(n, 0.7);
    // The other hand, quieter, so the line being learnt still stands out.
    for (const n of this.demoAccompany) schedule(n, 0.45);

    if (this.opts.metronome) {
      this.metronome.start(this.opts.bpm, this.opts.beatsPerBar ?? 4, startAudio, fromBeat);
    }
    const lastBeat = Math.max(...this.notes.map((n) => n.offset));
    hooks.onStatus("Escucha y mira la partitura");

    const tick = (): void => {
      if (this.stopped || this.paused) return;
      const beat = fromBeat + (performance.now() / 1000 - this.demoStartWall) / this.secPerBeat;
      this.demoBeat = Math.max(fromBeat, beat);
      const doneIndex = this.notes.filter((n) => n.onset < beat - 1e-6).length;
      const sounding = this.notes.filter((n) => n.onset <= beat && n.offset > beat);
      hooks.onProgress({
        doneIndex,
        total: this.notes.length,
        positionBeats: Math.max(0, beat),
        measure: sounding[0]?.measure ?? 1,
        expected: sounding.map((n) => n.midi),
      });
      if (beat >= lastBeat + 0.5) {
        this.finish(true);
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // --- a-tempo clock --------------------------------------------------------

  /**
   * Drives the cursor from the clock in a-tempo mode, and settles notes whose
   * deadline has passed. Runs on animation frames rather than a timer so it stops
   * naturally when the tab is hidden.
   */
  private startClock(): void {
    const tick = (): void => {
      if (this.stopped || this.paused || !this.judge) return;
      const elapsed = performance.now() / 1000 - this.startedAtSec;
      const missed = this.judge.collectMissed(elapsed);
      if (missed.length > 0) this.handleEvents(missed);
      this.measure = this.judge.measureAt(elapsed);
      this.emit({
        doneIndex: this.judge.judged,
        total: this.judge.total,
        positionBeats: this.judge.positionBeats(elapsed),
        measure: this.measure,
        expected: this.judge.dueNotes(elapsed),
      });
      if (this.judge.isDone(elapsed)) {
        this.finish(true);
        return;
      }
      this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  // --- microphone -----------------------------------------------------------

  private async startMic(): Promise<void> {
    const { hooks } = this.opts;
    const chords = this.hasChords();
    // MOTOR 2 is only worth its download when the line actually has simultaneous
    // notes; a single melody is YIN's job.
    if (chords && this.opts.modelUrl && this.opts.workerUrl) {
      this.poly = new WorkerPolyDetector({
        modelUrl: this.opts.modelUrl,
        workerUrl: this.opts.workerUrl,
      });
      // Load it now, not under the learner's first chord. Deliberately not
      // awaited: the session starts on MOTOR 1 either way, and the combiner
      // will not escalate until the detector reports itself ready.
      void this.poly.warmUp();
    }

    this.live = new LivePractice(
      this.score,
      {
        onEvents: (events) => {
          for (const event of events) this.latencyMeter.eventJudged(event.timeSec);
          if (this.paused) return;
          // In a-tempo mode the engine's own follower is ignored: its events are
          // re-judged against the clock so timing is graded rather than excused.
          if (this.judge) return;
          this.handleEvents(events);
        },
        onProgress: (p) => {
          if (this.judge || this.paused) return;
          this.syncFromLive(p.index, p.positionBeats, p.measure, p.done);
        },
      },
      this.poly ?? undefined,
      {
        // A monophonic line halves its windowing latency at 2 frames; a chord
        // needs the wider window for Basic Pitch to have something to work with.
        windowFrames: chords ? 4 : 2,
        // The microphone is forgiven what the keyboard is not: see the two
        // constants at the top of this file for why each one is a trade rather
        // than a slackening of standards.
        follow: {
          octaveTolerance: MIC_OCTAVE_TOLERANCE,
          ...(chords ? { chordFraction: MIC_CHORD_FRACTION } : {}),
        },
        onDetections: (notes: DetectedNote[]) => {
          if (this.paused) return;
          this.opts.hooks.onHeard?.(notes.map((n) => n.midi));
          // A-tempo grading needs the notes themselves, not the waiting
          // follower's verdict on them — without this the clock would run while
          // every note played into the microphone was discarded, and the whole
          // piece would be scored as missed.
          if (this.judge) this.handleEvents(this.judgeDetections(notes));
        },
      },
    );

    this.mic = new MicSource();
    hooks.onStatus("Pidiendo permiso del micrófono…");
    await this.live.start(new MeteredSource(this.mic, this.latencyMeter));
    hooks.onStatus(this.judge ? "A tempo: sigue el clic" : "Escuchando tu piano");
    if (!this.judge) this.emitProgress();
  }

  private hasChords(): boolean {
    return this.groups.some((g) => g.length > 1);
  }

  private syncFromLive(index: number, positionBeats: number, measure: number, done: boolean): void {
    this.measure = measure;
    this.emit({
      doneIndex: index,
      total: this.notes.length,
      positionBeats,
      measure,
      expected: this.groupAt(index).map((n) => n.midi),
    });
    if (done) this.finish(true);
  }

  // --- judging --------------------------------------------------------------

  /**
   * Route detections to whichever judge is active, and in wait mode keep a DTW
   * alignment running alongside so a learner who restarts from the middle can be
   * found again instead of leaving the cursor stuck for ever.
   */
  private judgeDetections(notes: DetectedNote[]): PlayerEvent[] {
    if (this.judge) {
      const elapsed = performance.now() / 1000 - this.startedAtSec;
      return notes.map((n) => this.judge!.judge(n.midi, elapsed));
    }
    const events = this.follower.onDetection(notes);
    for (const note of notes) this.considerResync(note, events);
    return events;
  }

  /**
   * DTW re-sync. The waiting cursor cannot move except forward one step at a
   * time, so a learner who jumps to bar 9 leaves it parked at bar 3 for ever.
   * DTW aligns the whole recent stream instead; when it insists — for several
   * consecutive detections — that the player is somewhere well ahead, the waiting
   * follower is rebuilt from there.
   */
  private considerResync(note: DetectedNote, events: PlayerEvent[]): void {
    const absolute = this.dtw.onDetected(note);
    const matched = events.some((e) => e.kind === "correct");
    if (matched) {
      this.resyncVotes = 0;
      return;
    }
    const here = this.baseIndex + this.follower.state.index;
    if (absolute < here + RESYNC_MIN_JUMP) {
      this.resyncVotes = 0;
      return;
    }
    if (++this.resyncVotes < RESYNC_VOTES) return;
    this.resyncVotes = 0;
    this.resyncTo(absolute);
  }

  /** Rebuild the waiting follower so it expects `index` next. */
  private resyncTo(index: number): void {
    this.baseIndex = Math.min(index, Math.max(0, this.notes.length - 1));
    this.follower = new FollowYouFollower(this.notes.slice(this.baseIndex));
    this.opts.hooks.onStatus("Te he encontrado: seguimos desde aquí");
    this.emitProgress();
  }

  private currentGroup(): ExpectedNote[] {
    return this.groupAt(this.baseIndex + this.follower.state.index);
  }

  private groupAt(index: number): ExpectedNote[] {
    let gi = 0;
    for (let i = 0; i < this.groups.length; i++) {
      if (this.notesBefore[i] <= index) gi = i;
    }
    return this.groups[gi] ?? [];
  }

  private handleEvents(events: PlayerEvent[]): void {
    for (const ev of events) {
      if (ev.kind === "correct" || ev.kind === "early" || ev.kind === "late") this.correct++;
      else if (ev.kind === "wrong") this.wrong++;
      if (ev.timingErrorSec !== undefined) this.timingErrors.push(Math.abs(ev.timingErrorSec));
      this.student.record(ev, this.measure);
      this.opts.hooks.onJudge(ev);
    }
    if (this.opts.mode === "keys" && !this.judge) {
      this.emitProgress();
      if (this.follower.state.done) this.finish(true);
    }
  }

  private emitProgress(): void {
    const state = this.follower.state;
    this.measure = state.measure;
    this.emit({
      doneIndex: this.baseIndex + state.index,
      total: this.notes.length,
      positionBeats: state.positionBeats,
      measure: state.measure,
      expected: this.currentGroup().map((n) => n.midi),
    });
  }

  /**
   * Publish a cursor position — and let the accompaniment hear it first.
   *
   * The other hand is driven by the cursor rather than by a clock so that in
   * wait mode it arrives exactly as the learner reaches it. Every position the
   * app produces goes through here, so the two cannot drift apart in some mode
   * nobody remembered to wire up.
   */
  private emit(p: Parameters<RunnerHooks["onProgress"]>[0]): void {
    this.accompanist?.update(p.positionBeats);
    this.opts.hooks.onProgress(p);
  }

  private finish(completed: boolean): void {
    if (this.finished) return;
    this.finished = true;
    this.stop();
    const judged = this.correct + this.wrong;
    this.opts.hooks.onFinish({
      correct: this.correct,
      wrong: this.wrong,
      total: this.notes.length,
      accuracy: judged > 0 ? this.correct / judged : 1,
      completed,
      meanTimingErrorSec:
        this.timingErrors.length > 0
          ? this.timingErrors.reduce((s, x) => s + x, 0) / this.timingErrors.length
          : null,
    });
  }
}
