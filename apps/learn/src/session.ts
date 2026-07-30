/**
 * A ten-minute practice session, planned rather than improvised.
 *
 * Left to themselves, a beginner plays their favourite piece from the top five
 * times and never touches the bar that is actually failing. The order below is
 * the one every method book uses, and every step is derived from data the app
 * already has: what has been completed, and which bars the student model rates as
 * weak.
 *
 *   1. Calentamiento — something already learnt, to get the hands moving.
 *   2. Repaso        — the weak bars of the last piece played, looped.
 *   3. Pieza nueva   — the next unplayed piece in the curriculum.
 *
 * Pure: progress and stats in, a plan out. No DOM, no storage, no clock.
 */
import { SONGS, type Song } from "@arpeggio/song-library";

export type StepKind = "warmup" | "review" | "new";

export interface SessionStep {
  kind: StepKind;
  song: Song;
  /** Heading shown while this step runs. */
  title: string;
  /** One line explaining why this step exists. */
  detail: string;
  /** Inclusive bar range to loop, when the step is a drill. */
  loop?: { from: number; to: number };
}

export interface SessionInput {
  /** Song id -> stars earned (0 when never completed). */
  stars: Record<string, number>;
  /** Song id -> epoch millis of the last attempt. */
  lastPlayed: Record<string, number>;
  /** Bars the student model rates weakest for the most recent piece. */
  weakBars: number[];
}

/**
 * Build the plan. Steps that cannot be filled are simply omitted — a first-ever
 * session has nothing to warm up with and nothing to review, and should open with
 * the first piece rather than with an apology.
 */
export function planSession(input: SessionInput): SessionStep[] {
  const steps: SessionStep[] = [];
  const started = SONGS.filter((s) => (input.stars[s.id] ?? 0) > 0);
  const recent = [...started].sort(
    (a, b) => (input.lastPlayed[b.id] ?? 0) - (input.lastPlayed[a.id] ?? 0),
  )[0];

  // 1. Warm up on the easiest thing already learnt — confidence, not challenge.
  const warmup = [...started].sort((a, b) => a.level - b.level)[0];
  if (warmup) {
    steps.push({
      kind: "warmup",
      song: warmup,
      title: "Calentamiento",
      detail: "Algo que ya te sale, para soltar las manos.",
    });
  }

  // 2. Drill the bars that are actually failing, not the whole piece.
  if (recent && input.weakBars.length > 0) {
    const from = Math.min(...input.weakBars);
    const to = Math.max(...input.weakBars);
    steps.push({
      kind: "review",
      song: recent,
      title: "Repaso",
      detail:
        from === to
          ? `El compás ${from} de «${recent.title}», en bucle.`
          : `Los compases ${from} a ${to} de «${recent.title}», en bucle.`,
      loop: { from, to },
    });
  }

  // 3. Then, and only then, something new.
  const next = SONGS.find((s) => (input.stars[s.id] ?? 0) === 0);
  if (next) {
    steps.push({
      kind: "new",
      song: next,
      title: "Pieza nueva",
      detail: `«${next.title}» — ${next.composer}.`,
    });
  } else {
    // Nothing left unplayed. A plan that ends on the warm-up would send a learner
    // who has finished the library back to their easiest piece, so aim at the
    // hardest one instead — that is where there is still something to gain.
    const hardest = [...SONGS].sort((a, b) => b.level - a.level)[0];
    steps.push({
      kind: "review",
      song: hardest,
      title: "Sigue puliendo",
      detail: `Ya has tocado toda la biblioteca: vuelve a «${hardest.title}» y súbele el tempo.`,
    });
  }
  return steps;
}
