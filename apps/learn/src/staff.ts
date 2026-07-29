/**
 * StaffView — the scrolling, animated notation that the learner reads.
 *
 * The Simply Piano feel comes from two decisions:
 *
 *  1. The PLAYHEAD IS FIXED and the music moves under it, instead of a cursor
 *     travelling across a static page. On a phone that keeps the note you must
 *     play right now in the same place at all times.
 *  2. The scroll position is driven by the FOLLOWER, not by a clock. The score
 *     glides forward when you play the right note and simply waits when you
 *     don't, which is what makes practice at any speed feel forgiving.
 *
 * Everything is drawn on a canvas from the score model — there is no font or
 * engraving library involved — because we only ever need one system, scrolling
 * horizontally, with the tiny subset of notation a beginner meets: note heads,
 * stems, flags, dots, ledger lines, accidentals, bar lines and a key signature.
 */

import { Particles } from "./effects.js";

/** One drawable note, tied back to its index in the follower's expectation list. */
export interface StaffNote {
  index: number;
  midi: number;
  /** Onset in quarter-note beats. */
  onset: number;
  /** Offset in quarter-note beats. */
  offset: number;
  hand: "left" | "right" | "unknown";
}

export type Clef = "treble" | "bass";

export interface StaffOptions {
  /** Key signature as a sharp count (negative = flats). */
  sharps: number;
  /** Bar length in quarter-note beats. */
  beatsPerBar: number;
  /** Beats in an incomplete opening bar. */
  pickupBeats: number;
  /** Which staves to draw, top to bottom. */
  clefs: Clef[];
  /** Print the Spanish note name (DO, RE, MI…) under every note. */
  showNames: boolean;
}

/** Diatonic index (C-1 = 0) of the bottom line of each clef. */
const BOTTOM_LINE: Record<Clef, number> = { treble: 30 /* E4 */, bass: 18 /* G2 */ };

/** Key-signature accidental slots, in the canonical order, per clef. */
const SHARP_SLOTS: Record<Clef, number[]> = {
  treble: [38, 35, 39, 36, 33, 37, 34],
  bass: [24, 21, 25, 22, 19, 23, 20],
};
const FLAT_SLOTS: Record<Clef, number[]> = {
  treble: [34, 37, 33, 36, 32, 35, 31],
  bass: [20, 23, 19, 22, 18, 21, 17],
};
/** Letters receiving a sharp / flat, in the order they appear in a key. */
const SHARP_ORDER = ["F", "C", "G", "D", "A", "E", "B"];
const FLAT_ORDER = ["B", "E", "A", "D", "G", "C", "F"];

const LETTER_STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };
/** Spanish note names, indexed like {@link LETTER_STEP}. */
const SOLFEGE = ["DO", "RE", "MI", "FA", "SOL", "LA", "SI"];

const SHARP_PCS: Array<[string, -1 | 0 | 1]> = [
  ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
  ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
];
const FLAT_PCS: Array<[string, -1 | 0 | 1]> = [
  ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
  ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
];

interface Spelling {
  letter: string;
  alter: -1 | 0 | 1;
  /** Absolute diatonic index — the vertical position on the staff. */
  d: number;
}

/** Spell a MIDI note for a key signature (sharps in sharp keys, flats in flat keys). */
export function spell(midi: number, sharps: number): Spelling {
  const pc = ((midi % 12) + 12) % 12;
  const [letter, alter] = (sharps < 0 ? FLAT_PCS : SHARP_PCS)[pc];
  const octave = Math.floor(midi / 12) - 1;
  return { letter, alter, d: octave * 7 + LETTER_STEP[letter] };
}

/**
 * Scientific octave number, where middle C (MIDI 60) is octave 4. Shown next to
 * a note name so "DO" is unambiguous once a piece spans more than one octave.
 */
export function octaveOf(midi: number): number {
  return Math.floor(midi / 12) - 1;
}

/** Spanish note name for a MIDI pitch, e.g. 61 -> "DO♯". */
export function noteName(midi: number, sharps: number): string {
  const { letter, alter } = spell(midi, sharps);
  return SOLFEGE[LETTER_STEP[letter]] + (alter === 1 ? "♯" : alter === -1 ? "♭" : "");
}

interface Palette {
  bg: string;
  line: string;
  ink: string;
  dim: string;
  accent: string;
  ok: string;
  bad: string;
}

export class StaffView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;

  private notes: StaffNote[] = [];
  private opts: StaffOptions = {
    sharps: 0, beatsPerBar: 4, pickupBeats: 0, clefs: ["treble"], showNames: true,
  };

  /** Notes with `index < doneIndex` have been played. */
  private doneIndex = 0;
  private beatTarget = 0;
  private beatNow = 0;
  /** performance.now() until which the current note is drawn as a miss. */
  private wrongUntil = 0;
  private raf = 0;
  /** Timestamp of the previous frame, for particle integration. */
  private lastFrameMs = 0;
  private readonly particles = new Particles();
  /**
   * Where the note under the playhead was last drawn. Bursts are spawned from
   * here rather than from the playhead line so the spark lands on the note head
   * the learner is actually looking at.
   */
  private hitPoints: Array<{ x: number; y: number }> = [];
  /** X of the last note name printed on each staff, to stop labels colliding. */
  private lastLabelX: number[] = [];
  private palette: Palette = {
    bg: "#0b0e14", line: "#39445a", ink: "#e8ecf3", dim: "#7f8aa0",
    accent: "#f2b441", ok: "#33d6c0", bad: "#ff6b6b",
  };

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas 2d context unavailable");
    this.ctx = ctx;
    new ResizeObserver(() => this.resize()).observe(canvas);
    this.resize();
  }

  setPiece(notes: StaffNote[], opts: StaffOptions): void {
    this.notes = [...notes].sort((a, b) => a.onset - b.onset || a.midi - b.midi);
    this.opts = opts;
    this.doneIndex = 0;
    // Start with the first note already at the playhead rather than sliding in.
    this.beatTarget = this.beatNow = notes.length ? notes[0].onset : 0;
    this.wrongUntil = 0;
    this.particles.clear();
    this.hitPoints = [];
  }

  /** Number of expected notes already played (from the follower's state). */
  setProgress(doneIndex: number, positionBeats: number): void {
    this.doneIndex = doneIndex;
    this.beatTarget = positionBeats;
  }

  /** Jump the scroll without animating (used when (re)starting a run). */
  snapTo(beat: number): void {
    this.beatTarget = this.beatNow = beat;
  }

  flashWrong(): void {
    this.wrongUntil = performance.now() + 400;
  }

  /** Spark burst on the note(s) just played correctly. */
  celebrate(): void {
    for (const p of this.hitPoints) {
      this.particles.burst(p.x, p.y, this.palette.ok);
    }
  }

  setShowNames(show: boolean): void {
    this.opts = { ...this.opts, showNames: show };
  }

  /** Re-read the CSS palette after a theme change. */
  refreshTheme(): void {
    this.readPalette();
    this.draw();
  }

  start(): void {
    if (this.raf) return;
    const loop = (): void => {
      this.step();
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  // --- internals ------------------------------------------------------------

  /** Ease the scroll toward the follower's position (a glide, never a jump). */
  private step(): void {
    const delta = this.beatTarget - this.beatNow;
    if (Math.abs(delta) < 0.002) this.beatNow = this.beatTarget;
    else this.beatNow += delta * 0.16;
  }

  private resize(): void {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.readPalette();
    this.draw();
  }

  /** Pull colours from CSS custom properties so the theme toggle just works. */
  private readPalette(): void {
    const cs = getComputedStyle(document.documentElement);
    const pick = (name: string, fallback: string): string =>
      cs.getPropertyValue(name).trim() || fallback;
    this.palette = {
      bg: pick("--staff-bg", "#0b0e14"),
      line: pick("--staff-line", "#39445a"),
      ink: pick("--fg", "#e8ecf3"),
      dim: pick("--muted", "#7f8aa0"),
      accent: pick("--accent", "#f2b441"),
      ok: pick("--ok", "#33d6c0"),
      bad: pick("--bad", "#ff6b6b"),
    };
  }

  private draw(): void {
    const { ctx, palette: c } = this;
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, w, h);
    this.hitPoints = [];

    const grand = this.opts.clefs.length > 1;
    const pad = 8;
    // Vertical budget in staff-gap units: the staff bodies (4 gaps each, plus a
    // 5-gap corridor between the two systems of a grand staff), the ledger-line
    // room above, and the ledger + note-name lane below.
    const ABOVE = 3;
    const BELOW = 3.4;
    const bodies = grand ? 13 : 4;
    const s = clamp((h - 2 * pad) / (bodies + ABOVE + BELOW), 5, 22);
    // Centre the whole system rather than pinning it to the top: on a tall
    // phone screen a top-anchored staff leaves a dead half-screen underneath.
    const blockTop = Math.max(pad, (h - (bodies + ABOVE + BELOW) * s) / 2);
    const staffTops = grand
      ? [blockTop + ABOVE * s, blockTop + (ABOVE + 9) * s]
      : [blockTop + ABOVE * s];

    const gutter = Math.round(4.6 * s) + 14;
    // Keep a little of what was just played visible to the left of the
    // playhead; on a narrow phone that collapses to just past the clef.
    const playX = Math.max(gutter + 1.6 * s + 10, Math.min(w * 0.28, 260));
    const pxPerBeat = clamp(w / 7.5, 44, 130);

    const toX = (beat: number): number => playX + (beat - this.beatNow) * pxPerBeat;
    const firstBeat = this.beatNow - (playX - gutter) / pxPerBeat;
    const lastBeat = this.beatNow + (w - playX) / pxPerBeat;

    // --- staff lines ---
    ctx.strokeStyle = c.line;
    ctx.lineWidth = 1;
    for (const top of staffTops) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(top + i * s) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
    }

    // --- bar lines ---
    const { beatsPerBar, pickupBeats } = this.opts;
    const firstBoundary = pickupBeats > 0 ? pickupBeats : 0;
    const kStart = Math.floor((firstBeat - firstBoundary) / beatsPerBar) - 1;
    const kEnd = Math.ceil((lastBeat - firstBoundary) / beatsPerBar) + 1;
    ctx.strokeStyle = c.line;
    for (let k = kStart; k <= kEnd; k++) {
      const beat = firstBoundary + k * beatsPerBar;
      if (beat < 0) continue;
      const x = Math.round(toX(beat)) + 0.5;
      if (x < gutter - 2 || x > w) continue;
      const top = staffTops[0];
      const bottom = staffTops[staffTops.length - 1] + 4 * s;
      ctx.beginPath();
      ctx.moveTo(x, top);
      ctx.lineTo(x, grand ? bottom : top + 4 * s);
      ctx.stroke();
    }

    // --- notes ---
    // Split by staff first: beaming and note-name spacing are both per-staff.
    const lanes: StaffNote[][] = staffTops.map(() => []);
    for (const note of this.notes) {
      if (note.offset < firstBeat - 1 || note.onset > lastBeat + 1) continue;
      lanes[grand && note.hand === "left" ? 1 : 0].push(note);
    }
    this.lastLabelX = staffTops.map(() => -Infinity);

    lanes.forEach((notes, li) => {
      const top = staffTops[li];
      const clef = this.opts.clefs[li];
      const groups = beamGroups(notes);
      const beams = new Map<StaffNote, Beam>();
      for (const group of groups) {
        const ys = group.map((n) => this.noteY(n, top, clef, s));
        // One stem direction for the whole group, from where its heads sit.
        const mean = ys.reduce((sum, y) => sum + y, 0) / ys.length;
        const stemUp = mean > top + 2 * s;
        const beamY = stemUp
          ? Math.min(...ys) - 3.1 * s
          : Math.max(...ys) + 3.1 * s;
        // Two beams for sixteenths and shorter, one for eighths and triplets.
        const lines = group.some((n) => n.offset - n.onset <= 0.3) ? 2 : 1;
        for (const n of group) beams.set(n, { y: beamY, stemUp, lines });
      }

      // Chords get no note names: the label sits in a lane under the staff, so
      // for a stack of heads it would land on top of the lowest one. The status
      // line already spells the whole chord out in words.
      const seen = new Set<number>();
      const chordOnsets = new Set<number>();
      for (const n of notes) {
        const key = Math.round(n.onset * 1e6);
        if (seen.has(key)) chordOnsets.add(key);
        seen.add(key);
      }

      for (const note of notes) {
        const x = toX(note.onset);
        // Names are centred, so one straddling the gutter would show as a stray
        // half-letter after the gutter is repainted over it. Drop it instead.
        const named = x > gutter + 14 && !chordOnsets.has(Math.round(note.onset * 1e6));
        this.drawNote(note, top, clef, s, x, li, named, beams.get(note));
      }

      // Beams last so they sit cleanly over the stems they cap.
      ctx.fillStyle = c.ink;
      for (const group of groups) {
        const beam = beams.get(group[0]);
        if (!beam) continue;
        const dx = beam.stemUp ? s * 0.6 : -s * 0.6;
        const x0 = toX(group[0].onset) + dx;
        const x1 = toX(group[group.length - 1].onset) + dx;
        const thickness = s * 0.42;
        for (let i = 0; i < beam.lines; i++) {
          const y = beam.y + (beam.stemUp ? 1 : -1) * i * thickness * 1.9;
          ctx.fillRect(Math.min(x0, x1), y - thickness / 2, Math.abs(x1 - x0), thickness);
        }
      }
    });

    // --- fixed gutter: repaint over the scrolled music, then clef + key ---
    ctx.fillStyle = c.bg;
    ctx.fillRect(0, 0, gutter, h);
    ctx.strokeStyle = c.line;
    for (const top of staffTops) {
      for (let i = 0; i < 5; i++) {
        const y = Math.round(top + i * s) + 0.5;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(gutter, y);
        ctx.stroke();
      }
    }
    staffTops.forEach((top, i) => {
      this.drawClef(this.opts.clefs[i], top, s);
      this.drawKeySignature(this.opts.clefs[i], top, s, Math.round(3.1 * s) + 6);
    });

    // --- playhead ---
    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, "transparent");
    grad.addColorStop(0.18, c.accent);
    grad.addColorStop(0.82, c.accent);
    grad.addColorStop(1, "transparent");
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(Math.round(playX) + 0.5, 2);
    ctx.lineTo(Math.round(playX) + 0.5, h - 2);
    ctx.stroke();
    ctx.lineWidth = 1;

    // Sparks last, so they sit over both the music and the playhead.
    const now = performance.now();
    const dt = this.lastFrameMs ? Math.min(0.05, (now - this.lastFrameMs) / 1000) : 0;
    this.lastFrameMs = now;
    this.particles.render(ctx, dt);
  }

  /** State of a note: everything before the cursor is done; the rest is ahead. */
  private stateOf(note: StaffNote): "done" | "current" | "upcoming" {
    if (note.index < this.doneIndex) return "done";
    return Math.abs(note.onset - this.beatTarget) < 1e-6 ? "current" : "upcoming";
  }

  /** Vertical centre of a note head on a given staff. */
  private noteY(note: StaffNote, top: number, clef: Clef, s: number): number {
    const sp = spell(note.midi, this.opts.sharps);
    return top + 4 * s - (sp.d - BOTTOM_LINE[clef]) * (s / 2);
  }

  private drawNote(
    note: StaffNote,
    top: number,
    clef: Clef,
    s: number,
    x: number,
    lane: number,
    withName: boolean,
    beam?: Beam,
  ): void {
    const { ctx, palette: c } = this;
    const sp = spell(note.midi, this.opts.sharps);
    const bottomLine = BOTTOM_LINE[clef];
    const yBottom = top + 4 * s;
    const y = yBottom - (sp.d - bottomLine) * (s / 2);
    const beats = note.offset - note.onset;
    const state = this.stateOf(note);

    const missed = state === "current" && performance.now() < this.wrongUntil;
    const color = missed ? c.bad
      : state === "done" ? c.ok
      : state === "current" ? c.accent
      : c.ink;
    ctx.globalAlpha = state === "done" ? 0.5 : 1;
    ctx.fillStyle = color;
    ctx.strokeStyle = color;

    // Halo behind the note you have to play right now.
    if (state === "current") {
      this.hitPoints.push({ x, y });
      ctx.globalAlpha = 0.18;
      ctx.beginPath();
      ctx.arc(x, y, s * 1.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // Ledger lines: every other diatonic step outside the staff.
    ctx.lineWidth = 1.4;
    const topLine = bottomLine + 8;
    const ledger = (d: number): void => {
      const ly = Math.round(yBottom - (d - bottomLine) * (s / 2)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x - s * 1.05, ly);
      ctx.lineTo(x + s * 1.05, ly);
      ctx.stroke();
    };
    for (let d = topLine + 2; d <= sp.d; d += 2) ledger(d);
    for (let d = bottomLine - 2; d >= sp.d; d -= 2) ledger(d);

    // Head: hollow from a half note upward, filled below.
    const filled = beats < 2;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(-0.33);
    ctx.beginPath();
    ctx.ellipse(0, 0, s * 0.66, s * 0.47, 0, 0, Math.PI * 2);
    ctx.restore();
    if (filled) ctx.fill();
    else { ctx.lineWidth = 1.8; ctx.stroke(); }

    // Stem (whole notes have none) — up below the middle line, down above it,
    // unless a beam group has already picked a direction for the whole run.
    if (beats < 4) {
      const stemUp = beam ? beam.stemUp : sp.d < bottomLine + 4;
      const sx = Math.round(x + (stemUp ? s * 0.6 : -s * 0.6)) + 0.5;
      const sy = beam ? beam.y : y + (stemUp ? -3.3 * s : 3.3 * s);
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(sx, y);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      // A flag only for an unbeamed short note; beamed runs get their beam drawn
      // across the whole group instead.
      if (!beam && beats <= 0.75) {
        ctx.beginPath();
        ctx.moveTo(sx, sy);
        ctx.quadraticCurveTo(sx + s * 1.3, sy + (stemUp ? s * 0.9 : -s * 0.9), sx + s * 0.8, sy + (stemUp ? s * 1.9 : -s * 1.9));
        ctx.lineWidth = 2.1;
        ctx.stroke();
      }
    }

    // Augmentation dot for dotted durations (1.5, 3, …).
    const base = beats / 1.5;
    if (Math.abs(Math.log2(base) - Math.round(Math.log2(base))) < 1e-6) {
      ctx.beginPath();
      ctx.arc(x + s * 1.25, y - (Math.round(sp.d - bottomLine) % 2 === 0 ? s * 0.5 : 0), s * 0.17, 0, Math.PI * 2);
      ctx.fill();
    }

    // Accidental, only when it differs from the key signature.
    const acc = this.accidentalFor(sp);
    if (acc) {
      ctx.font = `${(s * 2.4).toFixed(1)}px "Apple Symbols", "Segoe UI Symbol", serif`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(acc, x - s * 0.95, y);
    }

    // Note name in a dedicated lane below the system. Two guards keep it
    // legible in dense music: skip a label whose note head hangs down into the
    // lane, and skip one that would overprint the previous label. Fast passages
    // therefore lose their labels rather than turning into a smear — which is
    // also the right teaching order, since by then you are reading the staff.
    const laneY = top + 4 * s + s * 1.8;
    if (
      this.opts.showNames &&
      withName &&
      y < laneY - s * 0.8 &&
      x - this.lastLabelX[lane] > s * 3.1
    ) {
      this.lastLabelX[lane] = x;
      ctx.globalAlpha = state === "done" ? 0.35 : 0.85;
      ctx.fillStyle = state === "current" ? c.accent : c.dim;
      ctx.font = `600 ${(s * 0.95).toFixed(1)}px -apple-system, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillText(noteName(note.midi, this.opts.sharps), x, laneY);
    }

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1;
  }

  /** The accidental to print, or "" when the key signature already covers it. */
  private accidentalFor(sp: Spelling): string {
    const { sharps } = this.opts;
    const inKey = sharps > 0
      ? SHARP_ORDER.slice(0, sharps).includes(sp.letter)
      : sharps < 0
        ? FLAT_ORDER.slice(0, -sharps).includes(sp.letter)
        : false;
    const keyAlter = inKey ? (sharps > 0 ? 1 : -1) : 0;
    if (sp.alter === keyAlter) return "";
    if (sp.alter === 0) return "♮";
    return sp.alter === 1 ? "♯" : "♭";
  }

  private drawKeySignature(clef: Clef, top: number, s: number, x0: number): void {
    const { ctx, palette: c } = this;
    const { sharps } = this.opts;
    if (sharps === 0) return;
    const slots = sharps > 0 ? SHARP_SLOTS[clef] : FLAT_SLOTS[clef];
    const glyph = sharps > 0 ? "♯" : "♭";
    const count = Math.min(Math.abs(sharps), 7);
    ctx.fillStyle = c.ink;
    ctx.font = `${(s * 2.3).toFixed(1)}px "Apple Symbols", "Segoe UI Symbol", serif`;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    for (let i = 0; i < count; i++) {
      const y = top + 4 * s - (slots[i] - BOTTOM_LINE[clef]) * (s / 2);
      ctx.fillText(glyph, x0 + i * s * 0.85, y);
    }
  }

  /**
   * Clefs use the Unicode musical symbols when the platform has them (Apple
   * platforms do), and fall back to a drawn letter otherwise, so the staff is
   * never left with a tofu box.
   */
  private drawClef(clef: Clef, top: number, s: number): void {
    const { ctx, palette: c } = this;
    const glyph = clef === "treble" ? "\u{1D11E}" : "\u{1D122}";
    ctx.fillStyle = c.ink;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.font = `${(s * 4.2).toFixed(1)}px "Apple Symbols", "Segoe UI Symbol", "Noto Music", serif`;
    if (hasGlyph(ctx, glyph)) {
      // Anchor the glyph on its reference line: G4 for treble, F3 for bass.
      const refLine = clef === "treble" ? 32 : 24;
      const y = top + 4 * s - (refLine - BOTTOM_LINE[clef]) * (s / 2);
      ctx.fillText(glyph, 8, y + s * 0.9);
    } else {
      ctx.font = `700 ${(s * 2.6).toFixed(1)}px Georgia, serif`;
      ctx.textBaseline = "middle";
      ctx.fillText(clef === "treble" ? "G" : "F", 8, top + 2 * s);
    }
  }
}

/** A beam capping a run of short notes: shared stem end and direction. */
interface Beam {
  y: number;
  stemUp: boolean;
  /** 1 for eighths and triplets, 2 for sixteenths. */
  lines: number;
}

/**
 * Group consecutive short notes into beams, one beam per beat.
 *
 * Beaming per beat is what makes a bar of sixteenths or triplets readable: a
 * page of individual flags at phone size is a hedge, not notation. A group ends
 * at a beat boundary, at a rest (a gap between offset and the next onset), at a
 * long note, or at a chord — chords keep their flags, which sidesteps having to
 * pick one stem for several heads.
 */
export function beamGroups(notes: StaffNote[]): StaffNote[][] {
  const groups: StaffNote[][] = [];
  let current: StaffNote[] = [];
  const flush = (): void => {
    if (current.length > 1) groups.push(current);
    current = [];
  };
  for (const note of notes) {
    if (note.offset - note.onset > 0.75) {
      flush();
      continue;
    }
    const prev = current[current.length - 1];
    if (prev) {
      const contiguous = Math.abs(prev.offset - note.onset) < 1e-6;
      const sameBeat = Math.floor(prev.onset + 1e-6) === Math.floor(note.onset + 1e-6);
      if (!contiguous || !sameBeat) flush();
    }
    current.push(note);
  }
  flush();
  return groups;
}

/** Cache of glyph-availability probes (the probe rasterises, so run it once). */
const glyphCache = new Map<string, boolean>();

/**
 * Does this font stack actually have the character?
 *
 * Comparing `measureText` widths against an unassigned code point is the usual
 * trick, but it is wrong here: a symbol font renders the "missing glyph" box at
 * roughly the width of a real clef, so a present clef reads as absent and the
 * staff loses its clef for no reason. Rasterising both and comparing pixels is
 * unambiguous, and it runs once per (font, char).
 */
function hasGlyph(ctx: CanvasRenderingContext2D, ch: string): boolean {
  const key = ctx.font + ch;
  const cached = glyphCache.get(key);
  if (cached !== undefined) return cached;

  const probe = document.createElement("canvas");
  probe.width = 64;
  probe.height = 64;
  const pc = probe.getContext("2d", { willReadFrequently: true });
  let ok = true;
  if (pc) {
    const render = (text: string): Uint8ClampedArray => {
      pc.clearRect(0, 0, 64, 64);
      pc.font = "40px " + ctx.font.replace(/^[^ ]+ /, "");
      pc.fillStyle = "#000";
      pc.textBaseline = "middle";
      pc.fillText(text, 4, 32);
      return pc.getImageData(0, 0, 64, 64).data;
    };
    const glyph = render(ch);
    const tofu = render("\u{10FFFF}");
    let ink = 0;
    let diff = 0;
    for (let i = 3; i < glyph.length; i += 4) {
      if (glyph[i] > 8) ink++;
      if (Math.abs(glyph[i] - tofu[i]) > 8) diff++;
    }
    ok = ink > 0 && diff > 0;
  }
  glyphCache.set(key, ok);
  return ok;
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}
