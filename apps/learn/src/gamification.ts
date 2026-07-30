/**
 * Levels, experience and achievements.
 *
 * All of it is pure: `Stats` in, numbers and unlocked ids out. Nothing here
 * touches the DOM, storage or the clock, which is why it is the one part of the
 * app the test suite can pin down completely — and why the reward numbers can be
 * retuned without any risk to the practice loop.
 *
 * Design intent: XP rewards *playing*, not winning. A beginner who stumbles
 * through a piece still earns most of the experience, because the thing worth
 * reinforcing at the start is showing up and finishing. Stars and clean runs are
 * the bonus on top.
 */
import { SONGS } from "@arpeggio/song-library";

/** Everything the game layer counts, accumulated across every session. */
export interface Stats {
  /** Correctly played notes, all time. */
  notes: number;
  /** Ids of songs completed at least once. */
  songs: string[];
  /** Runs finished without a single wrong note. */
  perfect: number;
  /** Longest run of consecutive correct notes. */
  bestStreak: number;
  xp: number;
  /** Distinct local dates (YYYY-MM-DD) on which something was practised. */
  days: string[];
  /** Practice modes ever used ("keys" | "mic" | "demo"). */
  modes: string[];
  /** Hand choices ever used ("right" | "left" | "both"). */
  hands: string[];
  /**
   * Seconds spent actually practising, all time.
   *
   * The number that correlates with getting better, and the one a learner
   * recognises as effort — "I practised twenty minutes" means something that
   * "I played 340 notes" does not. Counted only while the practice screen is in
   * front of them (see `practiceTime.ts`), so leaving the app open on the
   * kitchen table earns nothing.
   */
  seconds: number;
}

export const EMPTY_STATS: Stats = {
  notes: 0,
  songs: [],
  perfect: 0,
  bestStreak: 0,
  xp: 0,
  days: [],
  modes: [],
  hands: [],
  seconds: 0,
};

// ---------------------------------------------------------------------------
// Experience and levels
// ---------------------------------------------------------------------------

/**
 * XP needed to go from `level` to the next one.
 *
 * Linear growth, not exponential: the curve has to stay reachable for someone
 * practising ten minutes a day, and a wall at level 4 would just make the number
 * meaningless.
 */
export function xpToAdvance(level: number): number {
  return 100 + (level - 1) * 60;
}

export interface LevelState {
  level: number;
  /** XP earned inside the current level. */
  into: number;
  /** XP the current level requires in total. */
  need: number;
  /** Honorific for the level band, shown next to the number. */
  title: string;
}

const TITLES: Array<[number, string]> = [
  [1, "Principiante"],
  [3, "Aprendiz"],
  [5, "Intérprete"],
  [8, "Músico"],
  [12, "Maestro"],
];

/** Resolve total XP into a level, the progress inside it, and its title. */
export function levelFor(xp: number): LevelState {
  let level = 1;
  let remaining = Math.max(0, Math.floor(xp));
  while (remaining >= xpToAdvance(level)) {
    remaining -= xpToAdvance(level);
    level++;
  }
  let title = TITLES[0][1];
  for (const [from, name] of TITLES) if (level >= from) title = name;
  return { level, into: remaining, need: xpToAdvance(level), title };
}

/** What one finished run is worth. */
export interface RunOutcome {
  /** Correct notes in the run. */
  correct: number;
  /** Wrong notes in the run. */
  wrong: number;
  /** Stars awarded (0 for a listen-through). */
  stars: number;
  /** True when the piece was played to the end. */
  completed: boolean;
  /** Demo playback earns nothing: the app played it, not the learner. */
  judged: boolean;
}

/**
 * XP for a run: mostly the notes you actually played, plus a completion bonus
 * and a little for stars and for a clean take.
 */
export function xpForRun(run: RunOutcome): number {
  if (!run.judged) return 0;
  let xp = run.correct;
  if (run.completed) xp += 25;
  xp += run.stars * 15;
  if (run.completed && run.wrong === 0) xp += 10;
  return xp;
}

// ---------------------------------------------------------------------------
// Achievements
// ---------------------------------------------------------------------------

export interface Achievement {
  id: string;
  title: string;
  description: string;
  /** Icon name from `icons.ts`. */
  icon: string;
  /** Value of `progress` at which it unlocks. */
  goal: number;
  /** Current value, from the stats. */
  progress(stats: Stats): number;
}

/** Songs at level 4 or above — the real classical repertoire. */
const CLASSICAL_IDS = new Set(SONGS.filter((s) => s.level >= 4).map((s) => s.id));

/**
 * Ids that count towards "finish the library".
 *
 * Generated technique exercises and imported scores also land in `stats.songs`,
 * and they must not be able to satisfy this: playing ten scales is not finishing
 * the repertoire.
 */
const LIBRARY_IDS = new Set(SONGS.map((s) => s.id));

/** Whole minutes of practice, for the time-based achievements. */
function minutes(stats: Stats): number {
  return Math.floor(stats.seconds / 60);
}

export const ACHIEVEMENTS: Achievement[] = [
  {
    id: "first-note",
    title: "La primera nota",
    description: "Toca una nota correcta.",
    icon: "note",
    goal: 1,
    progress: (s) => s.notes,
  },
  {
    id: "notes-100",
    title: "Cien notas",
    description: "Acumula 100 notas correctas.",
    icon: "note",
    goal: 100,
    progress: (s) => s.notes,
  },
  {
    id: "notes-1000",
    title: "Mil notas",
    description: "Acumula 1.000 notas correctas.",
    icon: "note",
    goal: 1000,
    progress: (s) => s.notes,
  },
  {
    id: "notes-10000",
    title: "Diez mil notas",
    description: "Acumula 10.000 notas correctas.",
    icon: "note",
    goal: 10000,
    progress: (s) => s.notes,
  },
  {
    id: "song-1",
    title: "Tu primera pieza",
    description: "Termina una canción de principio a fin.",
    icon: "check",
    goal: 1,
    progress: (s) => s.songs.length,
  },
  {
    id: "songs-5",
    title: "Cinco piezas",
    description: "Termina 5 canciones distintas.",
    icon: "check",
    goal: 5,
    progress: (s) => s.songs.length,
  },
  {
    id: "songs-10",
    title: "Diez piezas",
    description: "Termina 10 canciones distintas.",
    icon: "check",
    goal: 10,
    progress: (s) => s.songs.length,
  },
  {
    id: "songs-all",
    title: "Biblioteca completa",
    description: "Termina todas las piezas de la biblioteca.",
    icon: "star",
    goal: SONGS.length,
    progress: (s) => s.songs.filter((id) => LIBRARY_IDS.has(id)).length,
  },
  {
    id: "perfect-1",
    title: "Sin un fallo",
    description: "Termina una pieza sin ninguna nota equivocada.",
    icon: "star",
    goal: 1,
    progress: (s) => s.perfect,
  },
  {
    id: "perfect-5",
    title: "Cinco veces impecable",
    description: "Termina 5 piezas sin ningún fallo.",
    icon: "star",
    goal: 5,
    progress: (s) => s.perfect,
  },
  {
    id: "streak-20",
    title: "Veinte seguidas",
    description: "Enlaza 20 notas correctas sin fallar.",
    icon: "bolt",
    goal: 20,
    progress: (s) => s.bestStreak,
  },
  {
    id: "streak-50",
    title: "Cincuenta seguidas",
    description: "Enlaza 50 notas correctas sin fallar.",
    icon: "bolt",
    goal: 50,
    progress: (s) => s.bestStreak,
  },
  {
    id: "two-hands",
    title: "Las dos manos",
    description: "Termina una pieza tocando con las dos manos.",
    icon: "hand",
    goal: 1,
    progress: (s) => (s.hands.includes("both") ? 1 : 0),
  },
  {
    id: "real-piano",
    title: "Piano de verdad",
    description: "Practica con un piano real por el micrófono.",
    icon: "mic",
    goal: 1,
    progress: (s) => (s.modes.includes("mic") ? 1 : 0),
  },
  {
    id: "classical-3",
    title: "Repertorio clásico",
    description: "Termina 3 piezas de Bach, Beethoven o Dvořák.",
    icon: "note",
    goal: 3,
    progress: (s) => s.songs.filter((id) => CLASSICAL_IDS.has(id)).length,
  },
  {
    id: "minutes-10",
    title: "Diez minutos",
    description: "Practica 10 minutos en total.",
    icon: "clock",
    goal: 10,
    progress: minutes,
  },
  {
    id: "minutes-60",
    title: "Una hora al piano",
    description: "Acumula 60 minutos de práctica.",
    icon: "clock",
    goal: 60,
    progress: minutes,
  },
  {
    id: "minutes-600",
    title: "Diez horas",
    description: "Acumula 600 minutos de práctica.",
    icon: "clock",
    goal: 600,
    progress: minutes,
  },
  {
    id: "days-3",
    title: "Tres días",
    description: "Practica en 3 días distintos.",
    icon: "keys",
    goal: 3,
    progress: (s) => s.days.length,
  },
  {
    id: "days-7",
    title: "Una semana",
    description: "Practica en 7 días distintos.",
    icon: "keys",
    goal: 7,
    progress: (s) => s.days.length,
  },
];

/** Fraction of an achievement completed, clamped to [0, 1]. */
export function achievementRatio(achievement: Achievement, stats: Stats): number {
  return Math.min(1, achievement.progress(stats) / achievement.goal);
}

/** Ids of every achievement the stats currently satisfy. */
export function unlockedIds(stats: Stats): string[] {
  return ACHIEVEMENTS.filter((a) => a.progress(stats) >= a.goal).map((a) => a.id);
}

/**
 * Achievements newly satisfied by `after` that were not satisfied by `before`.
 * Comparing two snapshots (rather than trusting a stored list) means a retuned
 * goal or a new achievement is awarded correctly on the next run.
 */
export function newlyUnlocked(before: Stats, after: Stats): Achievement[] {
  const had = new Set(unlockedIds(before));
  return ACHIEVEMENTS.filter((a) => !had.has(a.id) && a.progress(after) >= a.goal);
}
