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
  }

  /** Measured software latency from capture callback to judged event. */
  get latency(): LatencyStats {
    return this.latencyMeter.stats;
  }

  /** True while MOTOR 2 inference is running off the main thread. */
  get polyOffThread(): boolean {
    return this.poly?.offThread ?? false;
  }

  /** Measures the student model rates as hardest so far. */
  weakestMeasures(limit = 3): number[] {
    return this.student.recommendPractice(limit);
  }

  async start(): Promise<void> {
    this.stopped = false;
    this.startedAtSec = performance.now() / 1000;
    if (this.opts.aTempo && this.opts.mode !== "demo") {
      this.judge = new ATempoJudge(this.notes, { secPerBeat: this.secPerBeat });
    }
    if (this.opts.metronome) {
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
        this.startDemo();
        break;
      case "mic":
        await this.startMic();
        if (this.judge) this.startClock();
        break;
    }
  }

  stop(): void {
    this.stopped = true;
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

  // --- on-screen keyboard ---------------------------------------------------

  press(midi: number): void {
    // Only the on-screen keyboard may sound. In microphone mode the app's own
    // output is an input: anything the speaker plays goes back into the mic.
    if (this.opts.mode !== "keys" || this.stopped) return;
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

  private startDemo(): void {
    const { synth, hooks } = this.opts;
    const startAudio = synth.now + 0.35;
    const startWall = performance.now() / 1000 + 0.35;
    for (const n of this.notes) {
      synth.playAt(n.midi, startAudio + n.onset * this.secPerBeat, (n.offset - n.onset) * this.secPerBeat, 0.7);
    }
    if (this.opts.metronome) {
      this.metronome.start(this.opts.bpm, this.opts.beatsPerBar ?? 4, startAudio);
    }
    const lastBeat = Math.max(...this.notes.map((n) => n.offset));
    hooks.onStatus("Escucha y mira la partitura");

    const tick = (): void => {
      if (this.stopped) return;
      const beat = (performance.now() / 1000 - startWall) / this.secPerBeat;
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
      if (this.stopped || !this.judge) return;
      const elapsed = performance.now() / 1000 - this.startedAtSec;
      const missed = this.judge.collectMissed(elapsed);
      if (missed.length > 0) this.handleEvents(missed);
      this.measure = this.judge.measureAt(elapsed);
      this.opts.hooks.onProgress({
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
    }

    this.live = new LivePractice(
      this.score,
      {
        onEvents: (events) => {
          for (const event of events) this.latencyMeter.eventJudged(event.timeSec);
          // In a-tempo mode the engine's own follower is ignored: its events are
          // re-judged against the clock so timing is graded rather than excused.
          if (this.judge) return;
          this.handleEvents(events);
        },
        onProgress: (p) => {
          if (this.judge) return;
          this.syncFromLive(p.index, p.positionBeats, p.measure, p.done);
        },
      },
      this.poly ?? undefined,
      // A monophonic line halves its windowing latency at 2 frames; a chord needs
      // the wider window for Basic Pitch to have something to work with.
      { windowFrames: chords ? 4 : 2 },
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
    this.opts.hooks.onProgress({
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
    this.opts.hooks.onProgress({
      doneIndex: this.baseIndex + state.index,
      total: this.notes.length,
      positionBeats: state.positionBeats,
      measure: state.measure,
      expected: this.currentGroup().map((n) => n.midi),
    });
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
