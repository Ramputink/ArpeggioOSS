/**
 * A ten-minute practice session, planned rather than improvised.
 *
 * Left to themselves, a beginner plays their favourite piece from the top five
 * times and never touches the bar that is actually failing. The order below is
 * the one every method book uses, and every step is derived from data the app
 * already has: what has been completed, and which bars the student model rates as
 * weak.
 *
 *   1. Calentamiento — a technique exercise, or something already learnt.
 *   2. Repaso        — the weak bars of the last piece played, looped.
 *   3. Pieza nueva   — the next unplayed piece in the curriculum.
 *
 * Pure: progress and stats in, a plan out. No DOM, no storage, no clock.
 */
import { EXERCISES, SONGS, exerciseById, type Song } from "@arpeggio/song-library";

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

/** The exercise a session opens with when nothing has been learnt yet. */
const FIRST_WARMUP = "ex-five-c";

/**
 * Build the plan. Steps that cannot be filled are simply omitted — a first-ever
 * session has nothing to review, and should open with a warm-up and the first
 * piece rather than with an apology.
 */
export function planSession(input: SessionInput): SessionStep[] {
  const steps: SessionStep[] = [];
  const started = SONGS.filter((s) => (input.stars[s.id] ?? 0) > 0);
  const recent = [...started].sort(
    (a, b) => (input.lastPlayed[b.id] ?? 0) - (input.lastPlayed[a.id] ?? 0),
  )[0];

  // 1. Warm up. A technique exercise beats a piece for this — it is short, it
  //    asks nothing of the memory, and it is the one thing the library never
  //    offered before. Rotate through the exercises so it is not the same five
  //    notes every day, preferring one that has not been played recently.
  const warmup = leastRecentExercise(input.lastPlayed);
  steps.push({
    kind: "warmup",
    song: warmup,
    title: "Calentamiento",
    detail: `${warmup.title} — para soltar las manos antes de tocar nada.`,
  });

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
  } else if (recent) {
    // No weak-bar data yet (the model is per-run): revisit the last piece whole.
    steps.push({
      kind: "review",
      song: recent,
      title: "Repaso",
      detail: `«${recent.title}» otra vez, ahora buscando tocarla sin fallos.`,
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

/** The exercise played longest ago (or never), so warm-ups rotate by themselves. */
function leastRecentExercise(lastPlayed: Record<string, number>): Song {
  return (
    [...EXERCISES].sort((a, b) => (lastPlayed[a.id] ?? 0) - (lastPlayed[b.id] ?? 0))[0] ??
    exerciseById(FIRST_WARMUP)!
  );
}

// ---------------------------------------------------------------------------
// Following the plan through
// ---------------------------------------------------------------------------

/** What one finished step of a session was worth. */
export interface StepResult {
  title: string;
  songTitle: string;
  /** Stars earned on this attempt, 0–3. */
  stars: number;
  correct: number;
  /** True when the piece was played to the end. */
  completed: boolean;
}

export interface SessionReport {
  headline: string;
  /** One line per step, in the order they were played. */
  lines: string[];
  /** Total correct notes across the session. */
  notes: number;
}

/**
 * Summarise a finished session.
 *
 * A plan that is announced and then silently forgotten is worse than no plan:
 * the learner has no idea whether they did the thing they agreed to. This is the
 * other half of the promise.
 *
 * @param planned How many steps the plan had, which is not the same as how many
 *   were attempted — walking away after the warm-up is not a complete session.
 */
export function summariseSession(
  results: readonly StepResult[],
  seconds: number,
  planned: number = results.length,
): SessionReport {
  const notes = results.reduce((sum, r) => sum + r.correct, 0);
  const finished = results.filter((r) => r.completed).length;
  const minutes = Math.max(1, Math.round(seconds / 60));

  // "Complete" means the whole plan, not "everything I bothered to attempt".
  // Counting only attempted steps congratulated a learner who walked away after
  // the warm-up, which is exactly the moment the app should not be flattering.
  const headline =
    results.length === 0
      ? "Sesión sin terminar"
      : finished === planned
        ? `Sesión completa · ${minutes} min`
        : `${finished} de ${planned} pasos terminados · ${minutes} min`;

  return {
    headline,
    lines: results.map(
      (r) =>
        `${r.title}: ${r.songTitle} — ` +
        (r.completed ? `${r.stars} de 3 estrellas` : "sin terminar") +
        `, ${r.correct} ${r.correct === 1 ? "nota" : "notas"}.`,
    ),
    notes,
  };
}
