/**
 * PianoRoll — canvas renderer for the canonical Score, with a live cursor and an
 * "active note" highlight driven by the score follower during practice.
 */
import type { Score, NoteEvent } from "@arpeggio/musicxml-parser";
import type { ScoreRenderer } from "@arpeggio/practice-web";

type Hand = "both" | "right" | "left";

export class PianoRoll implements ScoreRenderer {
  private ctx: CanvasRenderingContext2D;
  private events: NoteEvent[] = [];
  private beats = 1;
  private minMidi = 48;
  private maxMidi = 72;
  private beatsPerBar = 4;
  private cursorBeat = 0;
  private activeIndex = -1;
  private hand: Hand = "both";
  private W = 0;
  private H = 0;
  private padL = 34;
  private pxPerBeat = 12;
  private rowH = 9;

  constructor(private canvas: HTMLCanvasElement) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    window.addEventListener("resize", () => {
      this.layout();
      this.draw();
    });
  }

  setScore(score: Score): void {
    this.events = [...score.events].sort((a, b) => a.onset - b.onset || a.pitchMidi - b.pitchMidi);
    this.beats = Math.max(
      1,
      this.events.reduce((m, e) => Math.max(m, e.offset), 0),
    );
    const midis = this.events.map((e) => e.pitchMidi);
    // Guard the empty-score case: Math.min/max of [] are ±Infinity, which would
    // make the canvas geometry NaN. Fall back to a sensible middle octave range.
    this.minMidi = (midis.length ? Math.min(...midis) : 60) - 2;
    this.maxMidi = (midis.length ? Math.max(...midis) : 72) + 2;
    const ts = score.timeSignatures[0];
    this.beatsPerBar = ts ? (ts.beats * 4) / ts.beatType : 4;
    this.cursorBeat = 0;
    this.activeIndex = -1;
    this.layout();
  }

  setHands(hand: Hand): void {
    this.hand = hand;
    this.draw();
  }
  setCursorBeat(beat: number): void {
    this.cursorBeat = beat;
  }
  setActiveIndex(index: number): void {
    this.activeIndex = index;
  }

  /** Beat position of the Nth expected note (for cursor sync). */
  onsetOfIndex(index: number): number {
    return this.events[index]?.onset ?? this.beats;
  }
  get noteCount(): number {
    return this.events.length;
  }
  get totalBeats(): number {
    return this.beats;
  }

  private visible(e: NoteEvent): boolean {
    return this.hand === "both" || e.hand === this.hand;
  }

  private layout(): void {
    const dpr = window.devicePixelRatio || 1;
    const cssW = this.canvas.parentElement?.clientWidth ?? 900;
    const rows = this.maxMidi - this.minMidi + 1;
    this.rowH = 9;
    this.pxPerBeat = Math.max(9, (cssW - this.padL) / this.beats);
    this.W = cssW;
    this.H = rows * this.rowH + 16;
    this.canvas.style.height = this.H + "px";
    this.canvas.width = Math.floor(cssW * dpr);
    this.canvas.height = Math.floor(this.H * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  private col(name: string): string {
    return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  }
  private xOf(beat: number): number {
    return this.padL + beat * this.pxPerBeat;
  }
  private yOf(midi: number): number {
    return 8 + (this.maxMidi - midi) * this.rowH;
  }

  draw(): void {
    const c = this.ctx;
    c.clearRect(0, 0, this.W, this.H);
    // C-row bands + labels
    for (let m = this.minMidi; m <= this.maxMidi; m++) {
      if (m % 12 !== 0) continue;
      const y = this.yOf(m);
      c.fillStyle = this.col("--grid");
      c.fillRect(this.padL, y - this.rowH + 2, this.W - this.padL, this.rowH);
      c.fillStyle = this.col("--muted");
      c.font = "9px sans-serif";
      c.fillText("C" + (m / 12 - 1), 4, y);
    }
    // bar lines
    c.strokeStyle = this.col("--grid");
    c.lineWidth = 1;
    for (let b = 0; b <= this.beats + 1e-3; b += this.beatsPerBar) {
      c.beginPath();
      c.moveTo(this.xOf(b), 4);
      c.lineTo(this.xOf(b), this.H - 4);
      c.stroke();
    }
    // notes
    for (let i = 0; i < this.events.length; i++) {
      const e = this.events[i];
      if (!this.visible(e)) continue;
      const x = this.xOf(e.onset);
      const w = Math.max(2, (e.offset - e.onset) * this.pxPerBeat - 1);
      const y = this.yOf(e.pitchMidi);
      const sounding = e.onset <= this.cursorBeat && this.cursorBeat < e.offset;
      const active = i === this.activeIndex;
      c.fillStyle = e.hand === "left" ? this.col("--lh") : this.col("--rh");
      c.globalAlpha = active ? 1 : sounding ? 0.95 : 0.68;
      this.roundRect(x, y - this.rowH + 2.5, w, this.rowH - 2, 2.5);
      c.fill();
      if (active) {
        c.globalAlpha = 1;
        c.strokeStyle = this.col("--accent");
        c.lineWidth = 2;
        this.roundRect(x, y - this.rowH + 2.5, w, this.rowH - 2, 2.5);
        c.stroke();
      }
    }
    c.globalAlpha = 1;
    // cursor
    const px = this.xOf(this.cursorBeat);
    c.strokeStyle = this.col("--accent");
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(px, 2);
    c.lineTo(px, this.H - 2);
    c.stroke();
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const c = this.ctx;
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
}
