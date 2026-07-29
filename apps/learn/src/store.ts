/**
 * Progress, stats and preferences — persisted in localStorage.
 *
 * Deliberately local-only: no account, no server, no analytics. The app is a
 * static bundle that must keep working offline, and a beginner's practice history
 * is not something worth sending anywhere.
 *
 * Every read tolerates missing/corrupt data and every write tolerates storage
 * being unavailable (private mode), because losing a preference must never break
 * practice.
 */
import type { HandChoice } from "@arpeggio/song-library";

import { EMPTY_STATS, xpForRun, type RunOutcome, type Stats } from "./gamification.js";
import type { PracticeMode } from "./runner.js";

const PROGRESS_KEY = "arpeggio.progress.v1";
const PREFS_KEY = "arpeggio.prefs.v1";
const STATS_KEY = "arpeggio.stats.v1";

export interface SongProgress {
  /** Best correct-note ratio achieved on a completed run, 0–1. */
  bestAccuracy: number;
  /** Times the piece was played to the end. */
  completions: number;
  /** Epoch milliseconds of the last attempt. */
  lastPlayed: number;
}

export interface Prefs {
  mode: PracticeMode;
  hand: HandChoice;
  showNames: boolean;
  theme: "dark" | "light";
  /** Count in three beats before the first note. */
  countIn: boolean;
  /** Short vibration on a judged key (where the browser supports it). */
  haptics: boolean;
  /** Set once the first-run explainer has been dismissed. */
  introSeen: boolean;
}

const DEFAULT_PREFS: Prefs = {
  mode: "keys",
  hand: "right",
  showNames: true,
  theme: "dark",
  countIn: true,
  haptics: true,
  introSeen: false,
};

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: this session simply does not persist */
  }
}

// --------------------------------------------------------------- per-song
export function loadProgress(): Record<string, SongProgress> {
  return read<Record<string, SongProgress>>(PROGRESS_KEY, {});
}

/** Merge one attempt into the stored history and return the updated entry. */
export function recordRun(
  songId: string,
  run: { accuracy: number; completed: boolean },
): SongProgress {
  const all = loadProgress();
  const prev = all[songId] ?? { bestAccuracy: 0, completions: 0, lastPlayed: 0 };
  const next: SongProgress = {
    bestAccuracy: Math.max(prev.bestAccuracy, run.completed ? run.accuracy : 0),
    completions: prev.completions + (run.completed ? 1 : 0),
    lastPlayed: Date.now(),
  };
  all[songId] = next;
  write(PROGRESS_KEY, all);
  return next;
}

/**
 * Stars for a piece: finishing it at all is worth one, and the other two are for
 * accuracy. Rewarding completion first matters for a beginner who will hit plenty
 * of wrong notes on the way through.
 */
export function starsFor(p: SongProgress | undefined): 0 | 1 | 2 | 3 {
  if (!p || p.completions === 0) return 0;
  if (p.bestAccuracy >= 0.95) return 3;
  if (p.bestAccuracy >= 0.8) return 2;
  return 1;
}

// ----------------------------------------------------------------- prefs
export function loadPrefs(): Prefs {
  return read<Prefs>(PREFS_KEY, DEFAULT_PREFS);
}

export function savePrefs(prefs: Prefs): void {
  write(PREFS_KEY, prefs);
}

// ----------------------------------------------------------------- stats
export function loadStats(): Stats {
  const raw = read<Stats>(STATS_KEY, EMPTY_STATS);
  // Arrays are merged by replacement, not by union, so guard against a stored
  // shape that predates a field.
  return {
    ...EMPTY_STATS,
    ...raw,
    songs: [...new Set(raw.songs ?? [])],
    days: [...new Set(raw.days ?? [])],
    modes: [...new Set(raw.modes ?? [])],
    hands: [...new Set(raw.hands ?? [])],
  };
}

export function saveStats(stats: Stats): void {
  write(STATS_KEY, stats);
}

/** Local calendar day, for the "practised on N different days" achievements. */
export function todayKey(now = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export interface RunContext extends RunOutcome {
  songId: string;
  mode: PracticeMode;
  hand: HandChoice;
  /** Longest streak of correct notes within this run. */
  streak: number;
}

/**
 * Fold one finished run into the lifetime stats and return the snapshot before
 * and after, so the caller can diff them for freshly unlocked achievements.
 */
export function applyRun(run: RunContext): { before: Stats; after: Stats; xp: number } {
  const before = loadStats();
  const xp = xpForRun(run);
  const after: Stats = {
    notes: before.notes + (run.judged ? run.correct : 0),
    songs: run.completed && run.judged
      ? [...new Set([...before.songs, run.songId])]
      : before.songs,
    perfect: before.perfect + (run.judged && run.completed && run.wrong === 0 ? 1 : 0),
    bestStreak: Math.max(before.bestStreak, run.judged ? run.streak : 0),
    xp: before.xp + xp,
    days: [...new Set([...before.days, todayKey()])],
    modes: [...new Set([...before.modes, run.mode])],
    hands: run.completed ? [...new Set([...before.hands, run.hand])] : before.hands,
  };
  saveStats(after);
  return { before, after, xp };
}

/** Wipe everything the app has stored about the learner (kept out of prefs). */
export function resetProgress(): void {
  try {
    localStorage.removeItem(PROGRESS_KEY);
    localStorage.removeItem(STATS_KEY);
  } catch {
    /* nothing to clear */
  }
}
