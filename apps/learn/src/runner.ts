/**
 * Runner — one practice attempt, in whichever input mode the learner picked.
 *
 *   keys  on-screen piano   -> taps are judged directly by the follower
 *   mic   real instrument   -> audio frames -> practice-engine (YIN / Basic Pitch)
 *   demo  listen only       -> the app plays the piece; nothing is judged
 *
 * All three drive the SAME follower state (`doneIndex` + `positionBeats`), so
 * the staff and the keyboard are updated from one place and know nothing about
 * where the notes came from.
 */
import type { Score } from "@arpeggio/musicxml-parser";
import {
  FollowYouFollower,
  StudentModel,
  expectedNotesFromScore,
  groupChords,
  type ExpectedNote,
  type PlayerEvent,
} from "@arpeggio/practice-engine";
import { LivePractice, MicSource } from "@arpeggio/practice-web";

import type { Synth } from "./synth.js";

export type PracticeMode = "keys" | "mic" | "demo";

export interface RunSummary {
  correct: number;
  wrong: number;
  total: number;
  /** correct / (correct + wrong), or 1 when nothing was judged. */
  accuracy: number;
  completed: boolean;
}

export interface RunnerHooks {
  /** Called whenever the cursor moves; `expected` are the pitches now due. */
  onProgress(p: {
    doneIndex: number;
    total: number;
    positionBeats: number;
    measure: number;
    expected: number[];
  }): void;
  /** A judged action: `midi` is what the learner actually played, if known. */
  onJudge(event: PlayerEvent): void;
  /** Free-text state for the status pill ("escuchando…", "toca DO", …). */
  onStatus(text: string): void;
  onFinish(summary: RunSummary): void;
}

export interface RunnerOptions {
  mode: PracticeMode;
  synth: Synth;
  /** Playback tempo for demo mode, in quarter-note BPM. */
  bpm: number;
  hooks: RunnerHooks;
}

export class Runner {
  readonly notes: ExpectedNote[];
  private readonly groups: ExpectedNote[][];
  /** Cumulative expected-note count before each chord group. */
  private readonly notesBefore: number[];

  private readonly score: Score;
  private readonly opts: RunnerOptions;

  private follower: FollowYouFollower;
  private student = new StudentModel();
  private live: LivePractice | null = null;
  private mic: MicSource | null = null;
  private demoRaf = 0;
  private stopped = false;
  private finished = false;

  private correct = 0;
  private wrong = 0;

  constructor(score: Score, opts: RunnerOptions) {
    this.score = score;
    this.opts = opts;
    this.notes = expectedNotesFromScore(score);
    this.groups = groupChords(this.notes);
    this.notesBefore = [];
    let running = 0;
    for (const g of this.groups) {
      this.notesBefore.push(running);
      running += g.length;
    }
    this.follower = new FollowYouFollower(score);
  }

  async start(): Promise<void> {
    this.stopped = false;
    switch (this.opts.mode) {
      case "keys":
        this.opts.hooks.onStatus("Toca las teclas marcadas");
        this.emitProgress();
        break;
      case "demo":
        this.startDemo();
        break;
      case "mic":
        await this.startMic();
        break;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.demoRaf) cancelAnimationFrame(this.demoRaf);
    this.demoRaf = 0;
    this.live?.stop();
    this.mic?.stop();
    this.live = null;
    this.mic = null;
    this.opts.synth.allOff();
  }

  // --- on-screen keyboard ---------------------------------------------------

  /** A finger went down on the on-screen piano. */
  press(midi: number): void {
    this.opts.synth.noteOn(midi);
    if (this.opts.mode !== "keys" || this.stopped) return;
    const now = performance.now() / 1000;
    const events = this.follower.onDetection([
      { midi, onsetSec: now, offsetSec: null, confidence: 1, engine: "mono" },
    ]);
    this.handleEvents(events);
  }

  release(midi: number): void {
    this.opts.synth.noteOff(midi);
  }

  // --- demo playback --------------------------------------------------------

  /**
   * Play the piece back. Notes are scheduled up front on the audio clock (sample
   * accurate), while a rAF loop moves the cursor by wall clock — the two share
   * the same origin so the highlight lands on the note you hear.
   */
  private startDemo(): void {
    const { synth, bpm, hooks } = this.opts;
    const secPerBeat = 60 / bpm;
    const startAudio = synth.now + 0.35;
    const startWall = performance.now() / 1000 + 0.35;
    for (const n of this.notes) {
      synth.playAt(n.midi, startAudio + n.onset * secPerBeat, (n.offset - n.onset) * secPerBeat, 0.7);
    }
    const lastBeat = Math.max(...this.notes.map((n) => n.offset));
    hooks.onStatus("Escucha y mira la partitura");

    const tick = (): void => {
      if (this.stopped) return;
      const beat = (performance.now() / 1000 - startWall) / secPerBeat;
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
      this.demoRaf = requestAnimationFrame(tick);
    };
    this.demoRaf = requestAnimationFrame(tick);
  }

  // --- microphone -----------------------------------------------------------

  private async startMic(): Promise<void> {
    const { hooks } = this.opts;
    // MOTOR 2 (Basic Pitch) is only worth its download when the practice line
    // actually contains simultaneous notes; a single melody is YIN's job.
    const poly = this.hasChords() ? await loadPolyDetector() : undefined;
    this.live = new LivePractice(this.score, {
      onEvents: (events) => this.handleEvents(events),
      onProgress: (p) => {
        // LivePractice owns its own PracticeSession; mirror its follower here so
        // `expected` and the summary keep working the same way as in keys mode.
        this.syncFromLive(p.index, p.positionBeats, p.measure, p.done);
      },
    }, poly);
    this.mic = new MicSource();
    hooks.onStatus("Pidiendo permiso del micrófono…");
    await this.live.start(this.mic);
    hooks.onStatus("Escuchando tu piano");
    this.emitProgress();
  }

  private hasChords(): boolean {
    return this.groups.some((g) => g.length > 1);
  }

  private syncFromLive(index: number, positionBeats: number, measure: number, done: boolean): void {
    const group = this.groupAt(index);
    this.opts.hooks.onProgress({
      doneIndex: index,
      total: this.notes.length,
      positionBeats,
      measure,
      expected: group.map((n) => n.midi),
    });
    if (done) this.finish(true);
  }

  // --- shared ---------------------------------------------------------------

  private currentGroup(): ExpectedNote[] {
    return this.groupAt(this.follower.state.index);
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
      if (ev.kind === "correct") this.correct++;
      else if (ev.kind === "wrong") this.wrong++;
      this.student.record(ev, this.follower.state.measure);
      this.opts.hooks.onJudge(ev);
    }
    if (this.opts.mode === "keys") {
      this.emitProgress();
      if (this.follower.state.done) this.finish(true);
    }
  }

  private emitProgress(): void {
    const state = this.follower.state;
    this.opts.hooks.onProgress({
      doneIndex: state.index,
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
    });
  }
}

/**
 * Load MOTOR 2 on demand. The dynamic import is what keeps TensorFlow.js out of
 * the initial bundle — a learner tapping the on-screen keyboard never downloads it.
 */
async function loadPolyDetector(): Promise<import("@arpeggio/practice-engine").PolyphonicDetector> {
  const { BasicPitchDetector } = await import("@arpeggio/motor2-basicpitch");
  // Resolve against the document base so the app also works from a sub-path
  // (GitHub Pages) or behind the OMR backend.
  const modelUrl = new URL("models/basic-pitch/model.json", document.baseURI).href;
  return new BasicPitchDetector({ modelUrl });
}
