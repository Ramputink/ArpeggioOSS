/**
 * Small visual rewards.
 *
 * Two different mechanisms on purpose:
 *
 *  - `Particles` lives inside the staff canvas, because a burst at the playhead
 *    has to be composited with the notes and share their animation frame.
 *  - `confetti` is DOM, because the result sheet has no canvas and a few dozen
 *    CSS-animated elements cost less than standing up a second render loop.
 *
 * Both are decorative and must never gate practice: if a frame is dropped or an
 * element is missing, nothing breaks.
 */

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Remaining life in seconds. */
  life: number;
  maxLife: number;
  size: number;
  color: string;
}

/** A tiny gravity-free particle pool for hit bursts on the staff. */
export class Particles {
  private items: Particle[] = [];
  /** Deterministic jitter: the burst must not depend on Math.random per frame. */
  private seed = 1;

  /** Spawn a ring of sparks at a point. */
  burst(x: number, y: number, color: string, count = 12): void {
    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2 + this.jitter() * 0.4;
      const speed = 60 + this.jitter() * 55;
      this.items.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.45 + this.jitter() * 0.2,
        maxLife: 0.65,
        size: 1.6 + this.jitter() * 1.8,
        color,
      });
    }
    // Hard cap: a fast player could otherwise queue hundreds of sparks.
    if (this.items.length > 240) this.items.splice(0, this.items.length - 240);
  }

  get active(): boolean {
    return this.items.length > 0;
  }

  /** Advance and draw. `dt` is seconds since the previous frame. */
  render(ctx: CanvasRenderingContext2D, dt: number): void {
    if (this.items.length === 0) return;
    const alive: Particle[] = [];
    for (const p of this.items) {
      p.life -= dt;
      if (p.life <= 0) continue;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      // Ease outward motion to a stop so the burst blooms instead of scattering.
      p.vx *= 0.9;
      p.vy *= 0.9;
      alive.push(p);

      ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.items = alive;
  }

  clear(): void {
    this.items = [];
  }

  /** Cheap deterministic pseudo-random in [0, 1). */
  private jitter(): number {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    return this.seed / 0x7fffffff;
  }
}

const CONFETTI_COLORS = ["#f2b441", "#33d6c0", "#a78bfa", "#ff6b6b", "#7ec8ff"];

/**
 * Drop confetti into a container for a couple of seconds.
 *
 * The pieces are absolutely positioned children that remove themselves when
 * their animation ends, so the container is left exactly as it was found.
 */
export function confetti(container: HTMLElement, count = 44): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  for (let i = 0; i < count; i++) {
    const piece = document.createElement("i");
    piece.className = "confetti";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.random() * 0.5}s`;
    piece.style.animationDuration = `${1.5 + Math.random() * 1.1}s`;
    piece.style.setProperty("--drift", `${(Math.random() - 0.5) * 120}px`);
    piece.style.setProperty("--spin", `${(Math.random() - 0.5) * 900}deg`);
    piece.addEventListener("animationend", () => piece.remove());
    container.append(piece);
  }
}
