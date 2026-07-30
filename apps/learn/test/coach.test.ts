/**
 * The teaching layer, tested without a piano, a phone or a clock.
 *
 * Everything here is a decision the learner feels directly — how long they
 * practised, where to put their hand, when the app plays the other hand, what
 * the session says it did — and every one of them is a pure function over plain
 * data, so there is no excuse for finding out on a phone.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { EXERCISES, SONGS, songById } from "@arpeggio/song-library";

import { notesDue, type AccompanyNote } from "../src/accompanist.js";
import { fiveFingerSpan, handPositionText, wrongNoteMessage } from "../src/copy.js";
import { ACHIEVEMENTS, EMPTY_STATS, unlockedIds } from "../src/gamification.js";
import { MAX_SEGMENT_SEC, PracticeClock, formatDuration } from "../src/practiceTime.js";
import { summariseSession, type StepResult } from "../src/session.js";

// ---------------------------------------------------------------------------
// Practice time
// ---------------------------------------------------------------------------

test("the clock counts only the time it was running", () => {
  const clock = new PracticeClock();
  clock.start(100);
  assert.equal(clock.seconds(160), 60);
  clock.pause(160);
  // Sixty seconds pass with the app in the background: none of them count.
  assert.equal(clock.seconds(220), 60);
  clock.start(220);
  assert.equal(clock.seconds(250), 90);
});

test("starting an already-running clock does not restart it", () => {
  // The play screen and `visibilitychange` can both ask to start; asking twice
  // must not discard the segment in progress.
  const clock = new PracticeClock();
  clock.start(0);
  clock.start(30);
  assert.equal(clock.seconds(60), 60);
});

test("one unbroken stretch is capped, so a sleeping phone banks nothing extra", () => {
  const clock = new PracticeClock();
  clock.start(0);
  assert.equal(clock.seconds(10 * 3600), MAX_SEGMENT_SEC);
});

test("taking the time resets it, so the same minute cannot be banked twice", () => {
  // The run ends and the result screen banks the time; going back to the library
  // banks again. Without the reset the learner would be paid twice for it.
  const clock = new PracticeClock();
  clock.start(0);
  assert.equal(clock.take(120), 120);
  assert.equal(clock.take(120), 0);
  // ...and the clock keeps running from the moment it was taken.
  assert.equal(clock.seconds(150), 30);
});

test("taking from a paused clock leaves it paused", () => {
  const clock = new PracticeClock();
  clock.start(0);
  clock.pause(60);
  assert.equal(clock.take(60), 60);
  assert.equal(clock.running, false);
  assert.equal(clock.seconds(600), 0);
});

test("durations are phrased the way a learner thinks about them", () => {
  assert.equal(formatDuration(0), "0 min");
  assert.equal(formatDuration(90), "2 min");
  assert.equal(formatDuration(3600), "1 h 00 min");
  assert.equal(formatDuration(3600 + 5 * 60), "1 h 05 min");
});

test("practice minutes unlock the time achievements", () => {
  const ids = (seconds: number): string[] => unlockedIds({ ...EMPTY_STATS, seconds });
  assert.ok(!ids(9 * 60).includes("minutes-10"));
  assert.ok(ids(10 * 60).includes("minutes-10"));
  assert.ok(ids(3600).includes("minutes-60"));
  assert.ok(!ids(3600).includes("minutes-600"));
});

test("finishing the library means the library, not a pile of scales", () => {
  // Exercises and imported scores land in `stats.songs` too. If they counted
  // here, ten warm-ups would unlock "Biblioteca completa" without the learner
  // having finished a single piece.
  const all = ACHIEVEMENTS.find((a) => a.id === "songs-all")!;
  const scalesOnly = { ...EMPTY_STATS, songs: EXERCISES.map((e) => e.id) };
  assert.equal(all.progress(scalesOnly), 0);
  assert.equal(all.progress({ ...EMPTY_STATS, songs: SONGS.map((s) => s.id) }), SONGS.length);
});

// ---------------------------------------------------------------------------
// The app playing the other hand
// ---------------------------------------------------------------------------

const OTHER: AccompanyNote[] = [
  { midi: 48, onset: 0, offset: 1 },
  { midi: 52, onset: 1, offset: 2 },
  { midi: 55, onset: 2, offset: 3 },
];

test("the other hand sounds as the cursor passes each note", () => {
  assert.deepEqual(
    notesDue(OTHER, -1, 0).map((n) => n.midi),
    [48],
  );
  assert.deepEqual(
    notesDue(OTHER, 0, 1).map((n) => n.midi),
    [52],
  );
  assert.deepEqual(
    notesDue(OTHER, 1, 2.5).map((n) => n.midi),
    [55],
  );
});

test("a cursor that has not moved plays nothing again", () => {
  // In wait mode the position is republished on every animation frame while the
  // learner thinks. A closed interval here would re-fire the same note sixty
  // times a second.
  assert.deepEqual(notesDue(OTHER, 1, 1), []);
});

// ---------------------------------------------------------------------------
// Where the hands go
// ---------------------------------------------------------------------------

test("hand placement names a finger and a key, per hand", () => {
  const twinkle = songById("twinkle")!;
  assert.equal(
    handPositionText(twinkle.startPosition, twinkle.sharps, "both"),
    "Coloca la mano: pulgar derecho en DO4 · meñique izquierdo en DO3.",
  );
  // Practising one hand must not be told where to put the other.
  assert.equal(
    handPositionText(twinkle.startPosition, twinkle.sharps, "right"),
    "Coloca la mano: pulgar derecho en DO4.",
  );
  assert.equal(
    handPositionText(twinkle.startPosition, twinkle.sharps, "left"),
    "Coloca la mano: meñique izquierdo en DO3.",
  );
});

test("a piece with no settled position says nothing rather than guessing", () => {
  // The Canon's right hand runs a scale and its left leaps a fifth a bar. A
  // learner who plants their hand where the app said and finds the music
  // somewhere else trusts it less next time.
  const canon = songById("canon-d")!;
  assert.equal(canon.startPosition, undefined);
  assert.equal(handPositionText(canon.startPosition, canon.sharps, "both"), null);
  assert.equal(handPositionText({ left: 45 }, 2, "right"), null);
});

test("the five keys under a hand follow the major pattern, not the white keys", () => {
  // From RE the position is RE-MI-FA♯-SOL-LA: highlighting five consecutive
  // white keys would light FA natural, which is not in the position at all.
  assert.deepEqual(fiveFingerSpan(62), [62, 64, 66, 67, 69]);
});

// ---------------------------------------------------------------------------
// Feedback
// ---------------------------------------------------------------------------

test("a wrong note is described by what actually went wrong", () => {
  assert.equal(wrongNoteMessage({}, true), "Se te ha pasado esa nota");
  // The singular takes an article, not a numeral: "una octava", never "1 una
  // octava" — which is what the generic plural helper used to produce here.
  assert.equal(
    wrongNoteMessage({ playedMidi: 48, octaveOff: -1 }, true),
    "Nota correcta, pero una octava más abajo",
  );
  assert.equal(
    wrongNoteMessage({ playedMidi: 48, octaveOff: 2 }, true),
    "Nota correcta, pero 2 octavas más arriba",
  );
  assert.equal(wrongNoteMessage({ playedMidi: 61 }, true), "Esa no… mira la tecla iluminada");
  // No keyboard on screen (music-stand mode): do not point at something absent.
  assert.equal(wrongNoteMessage({ playedMidi: 61 }, false), "Esa no era");
});

// ---------------------------------------------------------------------------
// The session reports back
// ---------------------------------------------------------------------------

const STEPS: StepResult[] = [
  {
    title: "Calentamiento",
    songTitle: "Cinco dedos · DO mayor",
    stars: 3,
    correct: 14,
    completed: true,
  },
  { title: "Repaso", songTitle: "Estrellita", stars: 2, correct: 40, completed: true },
  { title: "Pieza nueva", songTitle: "Jingle Bells", stars: 0, correct: 9, completed: false },
];

test("the session summary is honest about what was finished", () => {
  const report = summariseSession(STEPS, 11 * 60);
  assert.equal(report.headline, "2 de 3 pasos terminados · 11 min");
  assert.equal(report.notes, 63);
  assert.equal(report.lines.length, 3);
  assert.match(report.lines[2], /sin terminar/);
});

test("a session where everything was finished says so", () => {
  const report = summariseSession(
    STEPS.map((s) => ({ ...s, completed: true })),
    600,
  );
  assert.equal(report.headline, "Sesión completa · 10 min");
});

test("walking away after the warm-up is not a complete session", () => {
  // The learner attempted 1 of 3 planned steps and finished it. Judging only the
  // steps attempted would call that "Sesión completa", which is flattery at the
  // exact moment the app should not be flattering.
  const report = summariseSession([STEPS[0]], 120, 3);
  assert.equal(report.headline, "1 de 3 pasos terminados · 2 min");
});

test("an abandoned session does not claim a completion", () => {
  assert.equal(summariseSession([], 0).headline, "Sesión sin terminar");
});
