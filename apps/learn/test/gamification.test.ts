/**
 * The game layer is the part of the app a test can pin down completely: pure
 * functions over a plain `Stats` object, no DOM, no storage, no clock. These
 * tests exist so the reward numbers can be retuned without anyone having to
 * replay a piece by hand to check that nothing broke.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { SONGS } from "@arpeggio/song-library";

import {
  ACHIEVEMENTS,
  EMPTY_STATS,
  achievementRatio,
  levelFor,
  newlyUnlocked,
  unlockedIds,
  xpForRun,
  xpToAdvance,
  type Stats,
} from "../src/gamification.js";

function stats(patch: Partial<Stats> = {}): Stats {
  return { ...EMPTY_STATS, ...patch };
}

test("a fresh learner is level 1 with nothing unlocked", () => {
  const state = levelFor(0);
  assert.equal(state.level, 1);
  assert.equal(state.into, 0);
  assert.equal(state.need, xpToAdvance(1));
  assert.equal(state.title, "Principiante");
  assert.deepEqual(unlockedIds(stats()), []);
});

test("levels consume exactly the XP they advertise", () => {
  // Walk the first ten levels, feeding in exactly the advertised requirement.
  let xp = 0;
  for (let level = 1; level <= 10; level++) {
    assert.equal(levelFor(xp).level, level, `should be level ${level} at ${xp} XP`);
    // One XP short of the requirement must not advance.
    assert.equal(levelFor(xp + xpToAdvance(level) - 1).level, level);
    xp += xpToAdvance(level);
  }
  assert.equal(levelFor(xp).level, 11);
});

test("progress inside a level never exceeds what it needs", () => {
  for (let xp = 0; xp < 4000; xp += 37) {
    const state = levelFor(xp);
    assert.ok(state.into >= 0 && state.into < state.need, `bad progress at ${xp} XP`);
  }
});

test("level titles rise and never regress", () => {
  const seen: string[] = [];
  let xp = 0;
  for (let level = 1; level <= 14; level++) {
    const title = levelFor(xp).title;
    if (seen[seen.length - 1] !== title) seen.push(title);
    xp += xpToAdvance(level);
  }
  assert.deepEqual(seen, ["Principiante", "Aprendiz", "Intérprete", "Músico", "Maestro"]);
});

test("XP rewards playing, and a listen-through earns nothing", () => {
  const played = { correct: 40, wrong: 6, stars: 2, completed: true, judged: true };
  const listened = { correct: 40, wrong: 0, stars: 0, completed: true, judged: false };
  assert.equal(xpForRun(listened), 0);
  // 40 notes + 25 for finishing + 30 for two stars; no clean-run bonus.
  assert.equal(xpForRun(played), 95);
  // A clean run of the same piece is worth more, but the notes still dominate.
  const clean = { ...played, wrong: 0, stars: 3 };
  assert.equal(xpForRun(clean), 40 + 25 + 45 + 10);
  assert.ok(xpForRun(clean) < 2 * xpForRun(played), "bonuses must not dwarf the notes");
});

test("an abandoned run still pays for the notes played", () => {
  const abandoned = { correct: 12, wrong: 3, stars: 0, completed: false, judged: true };
  assert.equal(xpForRun(abandoned), 12);
});

test("every achievement is reachable and well-formed", () => {
  assert.equal(new Set(ACHIEVEMENTS.map((a) => a.id)).size, ACHIEVEMENTS.length);
  for (const a of ACHIEVEMENTS) {
    assert.ok(a.goal >= 1, `${a.id}: goal must be positive`);
    assert.ok(a.title.length > 3 && a.description.length > 10, `${a.id}: needs real copy`);
    assert.equal(a.progress(stats()), 0, `${a.id}: must start at zero`);
  }
  // "Whole library" has to track the library, not a number frozen in the source.
  const all = ACHIEVEMENTS.find((a) => a.id === "songs-all");
  assert.equal(all?.goal, SONGS.length);
});

test("achievement progress is clamped and monotonic", () => {
  const a = ACHIEVEMENTS.find((x) => x.id === "notes-100")!;
  assert.equal(achievementRatio(a, stats({ notes: 0 })), 0);
  assert.equal(achievementRatio(a, stats({ notes: 50 })), 0.5);
  assert.equal(achievementRatio(a, stats({ notes: 100 })), 1);
  assert.equal(achievementRatio(a, stats({ notes: 9999 })), 1, "must not exceed 1");
});

test("note milestones unlock in order and only once", () => {
  const before = stats({ notes: 99 });
  const after = stats({ notes: 120 });
  const fresh = newlyUnlocked(before, after).map((a) => a.id);
  assert.deepEqual(fresh, ["notes-100"], "only the crossed milestone is new");
  // The first note was already unlocked at 99, so it must not fire again.
  assert.ok(unlockedIds(before).includes("first-note"));
  assert.deepEqual(newlyUnlocked(after, after), [], "no change unlocks nothing");
});

test("one run can unlock several achievements at once", () => {
  const before = stats();
  const after = stats({ notes: 1, songs: ["twinkle"], perfect: 1, bestStreak: 25 });
  const fresh = newlyUnlocked(before, after).map((a) => a.id);
  assert.deepEqual([...fresh].sort(), ["first-note", "perfect-1", "song-1", "streak-20"].sort());
});

test("the classical achievement only counts level 4+ pieces", () => {
  const classical = ACHIEVEMENTS.find((a) => a.id === "classical-3")!;
  const easy = SONGS.filter((s) => s.level < 4)
    .slice(0, 3)
    .map((s) => s.id);
  const hard = SONGS.filter((s) => s.level >= 4)
    .slice(0, 3)
    .map((s) => s.id);
  assert.equal(classical.progress(stats({ songs: easy })), 0);
  assert.equal(classical.progress(stats({ songs: hard })), 3);
});

test("mode and hand achievements need the real thing, not any run", () => {
  const twoHands = ACHIEVEMENTS.find((a) => a.id === "two-hands")!;
  const mic = ACHIEVEMENTS.find((a) => a.id === "real-piano")!;
  assert.equal(twoHands.progress(stats({ hands: ["right", "left"] })), 0);
  assert.equal(twoHands.progress(stats({ hands: ["both"] })), 1);
  assert.equal(mic.progress(stats({ modes: ["keys", "demo"] })), 0);
  assert.equal(mic.progress(stats({ modes: ["mic"] })), 1);
});
