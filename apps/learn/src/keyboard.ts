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

/**
 * Narrowest a white key may get before the keyboard scrolls instead of shrinking.
 *
 * 32, not the 44 px Apple recommends for discrete controls: a piano key is 150 px
 * tall and immediately adjacent to its neighbours, so it is aimed at with a
 * fingertip much like a letter on the iOS keyboard (whose keys are about 36 px
 * wide on this screen). The number is a trade: at 32 px an iPhone 15 Pro shows
 * twelve white keys at once instead of nine, which is the difference between
 * seeing both hands' next keys and not. Two full octaves still need 448 px, so
 * wide pieces scroll — `reveal()` centres the notes that are actually due, and
 * the setup sheet warns when even that cannot fit.
 */
export const MIN_KEY_WIDTH = 32;

/** White keys spanned by a pitch range, padded out to whole octaves. */
export function whiteKeysNeeded(lowest: number, highest: number): number {
  const lo = Math.floor(lowest / 12) * 12;
  const hi = Math.ceil((highest + 1) / 12) * 12 - 1;
  let count = 0;
  for (let m = lo; m <= hi; m++) if (WHITE_PCS.includes(m % 12)) count++;
  return count;
}

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
    if (midis.length === 0) return;
    const lo = this.keys.get(Math.min(...midis));
    const hi = this.keys.get(Math.max(...midis));
    if (lo && hi) this.reveal(lo, hi);
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
    const keyW = Math.max(MIN_KEY_WIDTH, available / whiteCount);
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

  /**
   * Bring the whole expected span into view.
   *
   * When both hands are due at once the two keys can be two octaves apart, so
   * the span is CENTRED whenever it fits — aligning the lowest key to the left
   * margin would leave the right hand's key off screen on a phone. When the span
   * is wider than the keyboard window, the lowest key wins: the left hand is
   * what needs finding, and the melody is the hand a learner can feel out.
   */
  private reveal(lo: HTMLElement, hi: HTMLElement): void {
    const view = this.scroller.clientWidth;
    const start = lo.offsetLeft;
    const end = hi.offsetLeft + hi.offsetWidth;
    const margin = Math.min(72, view * 0.22);

    let target = this.scroller.scrollLeft;
    // Centre whenever the span fits at all — a two-hand span is often only a few
    // pixels narrower than the window, and requiring a comfort margin on both
    // sides would reject it and push one hand's key off screen.
    if (end - start <= view - 4) {
      target = start - (view - (end - start)) / 2;
    } else if (start < target + margin) {
      target = start - margin;
    } else if (start > target + view - margin) {
      target = start - margin;
    }

    target = Math.max(0, Math.min(target, this.inner.offsetWidth - view));
    if (Math.abs(target - this.scroller.scrollLeft) > 2) {
      this.scroller.scrollTo({ left: target, behavior: "smooth" });
    }
  }
}
