/**
 * KeyboardView — the on-screen piano.
 *
 * This is what makes the app usable with nothing but a phone: the learner taps
 * keys, hears pitch and is judged exactly like a microphone session. It is DOM
 * rather than canvas on purpose — real elements give us native multi-touch via
 * pointer events, hit testing for free, and accessible focus targets.
 *
 * The keyboard also teaches: the key(s) the score is waiting for glow, and the
 * note name can be printed on every key while a beginner is still learning
 * where DO is.
 */
import { noteName, octaveOf } from "./staff.js";

/** Pitch classes that are white keys. */
const WHITE_PCS = [0, 2, 4, 5, 7, 9, 11];

export interface KeyboardOptions {
  onPress(midi: number): void;
  onRelease(midi: number): void;
}

export class KeyboardView {
  private readonly scroller: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly opts: KeyboardOptions;
  private readonly keys = new Map<number, HTMLElement>();
  /** Pointer id -> the key it is currently holding, for multi-touch chords. */
  private readonly held = new Map<number, number>();

  private lo = 60;
  private hi = 72;
  private sharps = 0;
  private showNames = true;

  constructor(root: HTMLElement, opts: KeyboardOptions) {
    this.opts = opts;
    root.classList.add("kb");
    this.scroller = document.createElement("div");
    this.scroller.className = "kb-scroll";
    this.inner = document.createElement("div");
    this.inner.className = "kb-inner";
    this.scroller.append(this.inner);
    root.append(this.scroller);

    // Pointer events on the container: one listener handles every finger, and
    // capture keeps the note held even if the finger slides off the key.
    this.inner.addEventListener("pointerdown", (e) => this.onDown(e));
    this.inner.addEventListener("pointerup", (e) => this.onUp(e));
    this.inner.addEventListener("pointercancel", (e) => this.onUp(e));
    new ResizeObserver(() => this.layout()).observe(this.scroller);
  }

  /**
   * Show at least the range the piece needs, padded out to whole octaves so the
   * keyboard always starts on a DO — the visual anchor a beginner counts from.
   */
  setRange(lowest: number, highest: number, sharps: number): void {
    this.sharps = sharps;
    this.lo = Math.floor(lowest / 12) * 12;
    this.hi = Math.ceil((highest + 1) / 12) * 12 - 1;
    this.build();
  }

  setNames(show: boolean): void {
    this.showNames = show;
    this.inner.classList.toggle("named", show);
  }

  /** Glow the key(s) the score is waiting for and keep them on screen. */
  setHighlight(midis: number[]): void {
    for (const [midi, el] of this.keys) el.classList.toggle("next", midis.includes(midi));
    const first = midis.length ? this.keys.get(Math.min(...midis)) : undefined;
    if (first) this.scrollIntoView(first, midis.length);
  }

  /** Brief feedback on a played key: teal for a match, rose for a wrong note. */
  flash(midi: number, ok: boolean): void {
    const el = this.keys.get(midi);
    if (!el) return;
    const cls = ok ? "hit" : "miss";
    el.classList.remove(cls);
    // Force a reflow so the animation restarts on rapid repeats of one key.
    void el.offsetWidth;
    el.classList.add(cls);
    window.setTimeout(() => el.classList.remove(cls), 420);
  }

  /** Paint a key as pressed (used by demo playback, which has no finger). */
  setPressed(midi: number, down: boolean): void {
    this.keys.get(midi)?.classList.toggle("down", down);
  }

  releaseAll(): void {
    for (const el of this.keys.values()) el.classList.remove("down");
    this.held.clear();
  }

  // --- internals ------------------------------------------------------------

  private onDown(e: PointerEvent): void {
    const midi = this.midiFromTarget(e.target);
    if (midi === null) return;
    e.preventDefault();
    try {
      // Capture keeps the note held if the finger slides off the key. It throws
      // for a pointer id that is not active (synthetic events), which must not
      // stop the note from sounding.
      this.inner.setPointerCapture(e.pointerId);
    } catch {
      /* not capturable: the key still plays */
    }
    this.held.set(e.pointerId, midi);
    this.keys.get(midi)?.classList.add("down");
    this.opts.onPress(midi);
  }

  private onUp(e: PointerEvent): void {
    const midi = this.held.get(e.pointerId);
    if (midi === undefined) return;
    this.held.delete(e.pointerId);
    this.keys.get(midi)?.classList.remove("down");
    this.opts.onRelease(midi);
  }

  private midiFromTarget(target: EventTarget | null): number | null {
    const el = (target as HTMLElement | null)?.closest<HTMLElement>("[data-midi]");
    return el ? Number(el.dataset.midi) : null;
  }

  private build(): void {
    this.inner.replaceChildren();
    this.keys.clear();
    const whites: number[] = [];
    for (let m = this.lo; m <= this.hi; m++) if (WHITE_PCS.includes(m % 12)) whites.push(m);

    whites.forEach((midi, i) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "key white";
      el.dataset.midi = String(midi);
      el.dataset.index = String(i);
      el.setAttribute("aria-label", `${noteName(midi, this.sharps)}${octaveOf(midi)}`);
      // Name plus octave: over two octaves there are several DOs on screen, and
      // "which DO" is exactly the question a beginner is asking.
      const label = document.createElement("span");
      label.className = "kb-name";
      label.append(document.createTextNode(noteName(midi, this.sharps)));
      const octave = document.createElement("sub");
      octave.textContent = String(octaveOf(midi));
      label.append(octave);
      el.append(label);
      this.inner.append(el);
      this.keys.set(midi, el);
    });

    for (let m = this.lo; m <= this.hi; m++) {
      if (WHITE_PCS.includes(m % 12)) continue;
      // A black key sits between the white key below it and the next one.
      const leftWhite = whites.filter((w) => w < m).length - 1;
      if (leftWhite < 0 || leftWhite >= whites.length - 1) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.className = "key black";
      el.dataset.midi = String(m);
      el.dataset.index = String(leftWhite);
      el.setAttribute("aria-label", noteName(m, this.sharps));
      this.inner.append(el);
      this.keys.set(m, el);
    }

    this.inner.classList.toggle("named", this.showNames);
    this.layout();
  }

  /**
   * Size the keys to fill the width when the range is small, and fall back to a
   * comfortable fixed width (with horizontal scrolling) when it is not — a
   * two-octave piece would otherwise produce keys too narrow to hit.
   */
  /** Re-measure and re-size the keys (after the screen becomes visible). */
  relayout(): void {
    this.layout();
  }

  private layout(): void {
    const whiteCount = [...this.keys.values()].filter((el) => el.classList.contains("white")).length;
    if (whiteCount === 0) return;
    const available = this.scroller.clientWidth;
    // A hidden play screen measures 0 wide, which would freeze every key at the
    // minimum width even on a desktop. Wait to be measured for real instead.
    if (available === 0) return;
    const MIN_KEY = 44;
    const keyW = Math.max(MIN_KEY, available / whiteCount);
    const blackW = keyW * 0.62;
    this.inner.style.width = `${keyW * whiteCount}px`;
    for (const el of this.keys.values()) {
      const i = Number(el.dataset.index);
      if (el.classList.contains("white")) {
        el.style.left = `${i * keyW}px`;
        el.style.width = `${keyW}px`;
      } else {
        el.style.left = `${(i + 1) * keyW - blackW / 2}px`;
        el.style.width = `${blackW}px`;
      }
    }
  }

  /** Keep the highlighted key comfortably inside the scroll window. */
  private scrollIntoView(el: HTMLElement, span: number): void {
    const left = el.offsetLeft;
    const width = el.offsetWidth * Math.max(1, span);
    const view = this.scroller.clientWidth;
    const margin = Math.min(80, view * 0.25);
    let target = this.scroller.scrollLeft;
    if (left < target + margin) target = left - margin;
    else if (left + width > target + view - margin) target = left + width - view + margin;
    target = Math.max(0, Math.min(target, this.inner.offsetWidth - view));
    if (Math.abs(target - this.scroller.scrollLeft) > 2) {
      this.scroller.scrollTo({ left: target, behavior: "smooth" });
    }
  }
}
