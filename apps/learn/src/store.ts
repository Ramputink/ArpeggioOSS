/**
 * Progress and preferences, persisted in localStorage.
 *
 * Deliberately local-only: no account, no server, no analytics. The app is a
 * static bundle that must keep working offline and on a plane, and a beginner's
 * practice history is not something worth sending anywhere.
 */
import type { HandChoice } from "@arpeggio/song-library";

import type { PracticeMode } from "./runner.js";

const PROGRESS_KEY = "arpeggio.progress.v1";
const PREFS_KEY = "arpeggio.prefs.v1";

export interface SongProgress {
  /** Best correct-note ratio achieved, 0–1. */
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
}

const DEFAULT_PREFS: Prefs = { mode: "keys", hand: "right", showNames: true, theme: "dark" };

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as T) } : fallback;
  } catch {
    // Private mode, disabled storage, corrupted JSON — practice still works.
    return fallback;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: preferences simply do not persist */
  }
}

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
 * Stars for a piece: finishing it at all is worth one, and the other two are
 * for accuracy. Rewarding completion first matters for a beginner who will hit
 * plenty of wrong notes on the way through.
 */
export function starsFor(p: SongProgress | undefined): 0 | 1 | 2 | 3 {
  if (!p || p.completions === 0) return 0;
  if (p.bestAccuracy >= 0.95) return 3;
  if (p.bestAccuracy >= 0.8) return 2;
  return 1;
}

export function loadPrefs(): Prefs {
  return read<Prefs>(PREFS_KEY, DEFAULT_PREFS);
}

export function savePrefs(prefs: Prefs): void {
  write(PREFS_KEY, prefs);
}
