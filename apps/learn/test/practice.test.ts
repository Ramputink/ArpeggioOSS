/**
 * The parts of real-piano practice that can be pinned down without a piano.
 *
 * A-tempo judging, the latency budget arithmetic and the session planner are all
 * pure functions over plain data, and all three are places where a quiet mistake
 * would be invisible on screen: a note graded correct when it was 400 ms late, a
 * latency figure that flatters the pipeline, a session plan that puts the new
 * piece before the warm-up.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { octaveDisplacement, type ExpectedNote } from "@arpeggio/practice-engine";
import { SONGS } from "@arpeggio/song-library";

import { ATempoJudge } from "../src/aTempo.js";
import { LatencyMeter, latencyVerdict, windowLatencyMs } from "../src/latency.js";
import { levelVerdict } from "../src/micCheck.js";
import { planSession } from "../src/session.js";

/** Expected notes on the beat: `[midi, beat]`. */
function expected(...spec: Array<[number, number]>): ExpectedNote[] {
  return spec.map(([midi, onset]) => ({
    midi,
    onset,
    offset: onset + 1,
    measure: Math.floor(onset / 4) + 1,
    voice: 1,
    staff: 1,
  }));
}

// ---------------------------------------------------------------------------
// A tempo
// ---------------------------------------------------------------------------
const SEC_PER_BEAT = 0.5; // 120 bpm

test("a note played on its beat is correct; off its beat is early or late", () => {
  const judge = new ATempoJudge(expected([60, 0], [62, 1], [64, 2]), {
    secPerBeat: SEC_PER_BEAT,
  });
  assert.equal(judge.judge(60, 0).kind, "correct");
  // RE is due at 0.5 s. 100 ms late is inside the 150 ms tolerance.
  assert.equal(judge.judge(62, 0.6).kind, "correct");
  // MI is due at 1.0 s; 300 ms late is outside it.
  const late = judge.judge(64, 1.3);
  assert.equal(late.kind, "late");
  assert.ok(late.timingErrorSec !== undefined && late.timingErrorSec > 0.29);
});

test("early and late are signed the way a musician would say them", () => {
  const judge = new ATempoJudge(expected([60, 2]), { secPerBeat: SEC_PER_BEAT });
  const early = judge.judge(60, 0.6); // due at 1.0 s
  assert.equal(early.kind, "early");
  assert.ok(early.timingErrorSec! < 0, "playing ahead must be negative");
});

test("a note nowhere near its slot is wrong, and never consumes the slot", () => {
  const judge = new ATempoJudge(expected([60, 0], [62, 8]), { secPerBeat: SEC_PER_BEAT });
  // RE is due at 4 s; playing it at 0 s is 4 s early — outside the match window.
  assert.equal(judge.judge(62, 0).kind, "wrong");
  assert.equal(judge.judged, 0, "a wrong note must not settle anything");
  // The slot is still there to be played properly later.
  assert.equal(judge.judge(62, 4).kind, "correct");
});

test("a repeated pitch is credited to the repetition actually played", () => {
  const judge = new ATempoJudge(expected([60, 0], [60, 4], [60, 8]), {
    secPerBeat: SEC_PER_BEAT,
  });
  // Play only the third DO, at 4 s. It must match that slot, not the first.
  const event = judge.judge(60, 4);
  assert.equal(event.kind, "correct");
  assert.equal(event.atBeat, 8);
});

test("deadlines that pass unplayed are counted as misses exactly once", () => {
  const judge = new ATempoJudge(expected([60, 0], [62, 1]), { secPerBeat: SEC_PER_BEAT });
  assert.deepEqual(judge.collectMissed(0.1), [], "nothing is overdue yet");
  const missed = judge.collectMissed(5);
  assert.equal(missed.length, 2);
  assert.ok(missed.every((e) => e.kind === "wrong" && e.playedMidi === undefined));
  assert.deepEqual(judge.collectMissed(6), [], "a miss must not be reported twice");
  assert.equal(judge.judged, judge.total);
});

test("the clock, not the learner, decides where the cursor is", () => {
  const judge = new ATempoJudge(expected([60, 0], [62, 4]), { secPerBeat: SEC_PER_BEAT });
  assert.equal(judge.positionBeats(0), 0);
  assert.equal(judge.positionBeats(1), 2);
  assert.ok(!judge.isDone(1));
  assert.ok(judge.isDone(10), "past the last deadline the run is over");
  assert.equal(judge.measureAt(0), 1);
  assert.equal(judge.measureAt(2.1), 2);
});

test("the keyboard lights only what is due about now", () => {
  const judge = new ATempoJudge(expected([60, 0], [62, 8]), { secPerBeat: SEC_PER_BEAT });
  assert.deepEqual(judge.dueNotes(0), [60]);
  assert.deepEqual(judge.dueNotes(2), [], "nothing is due mid-bar");
  assert.deepEqual(judge.dueNotes(4), [62]);
});

test("a wrong octave is reported as an octave error, not a wrong note", () => {
  const judge = new ATempoJudge(expected([60, 0]), { secPerBeat: SEC_PER_BEAT });
  const event = judge.judge(48, 0);
  assert.equal(event.kind, "wrong");
  assert.equal(event.octaveOff, -1, "an octave below must read as -1");

  // And the same judgement in the waiting follower's own helper.
  assert.equal(octaveDisplacement(expected([60, 0]), 72), 1);
  assert.equal(octaveDisplacement(expected([60, 0]), 61), undefined);
  // Against a chord spanning octaves, the nearest candidate wins.
  assert.equal(octaveDisplacement(expected([48, 0], [72, 0]), 60), 1);
});

// ---------------------------------------------------------------------------
// Latency
// ---------------------------------------------------------------------------
test("windowing latency is frames x frame duration, and dominates the budget", () => {
  // 2048 samples at 44.1 kHz is 46.4 ms; four of them is what the loop shipped
  // with, and it is the number to attack before optimising anything else.
  assert.equal(Math.round(windowLatencyMs(2048, 4, 44100)), 186);
  assert.equal(Math.round(windowLatencyMs(2048, 2, 44100)), 93);
  assert.equal(Math.round(windowLatencyMs(2048, 1, 48000)), 43);
  // Halving the window really does halve it: no hidden constant.
  assert.equal(windowLatencyMs(2048, 4, 44100) / 2, windowLatencyMs(2048, 2, 44100));
});

test("the latency verdict matches what a player can actually feel", () => {
  assert.equal(latencyVerdict(15), "imperceptible");
  assert.equal(latencyVerdict(60), "good");
  assert.equal(latencyVerdict(120), "noticeable");
  assert.equal(latencyVerdict(220), "bad");
  // The four-frame window alone lands in "bad", which is the finding that
  // justified making the window configurable.
  assert.equal(latencyVerdict(windowLatencyMs(2048, 4, 44100)), "bad");
});

test("the meter reports percentiles and ignores events it never saw a frame for", () => {
  const meter = new LatencyMeter();
  assert.equal(meter.stats.samples, 0);
  meter.eventJudged(1.234);
  assert.equal(meter.stats.samples, 0, "an unknown stamp must not be guessed at");

  for (let i = 0; i < 20; i++) meter.frameArrived(i);
  for (let i = 0; i < 20; i++) meter.eventJudged(i);
  const stats = meter.stats;
  assert.equal(stats.samples, 20);
  assert.ok(stats.p50 >= 0 && stats.p95 >= stats.p50 && stats.worst >= stats.p95);

  meter.reset();
  assert.equal(meter.stats.samples, 0);
});

test("the frame table stays bounded over a long session", () => {
  const meter = new LatencyMeter();
  for (let i = 0; i < 5000; i++) meter.frameArrived(i);
  // The oldest frames are evicted, so an event from the distant past is unknown…
  meter.eventJudged(0);
  assert.equal(meter.stats.samples, 0);
  // …while a recent one is still dated.
  meter.eventJudged(4999);
  assert.equal(meter.stats.samples, 1);
});

// ---------------------------------------------------------------------------
// Microphone level
// ---------------------------------------------------------------------------
test("input level verdicts cover silence through clipping", () => {
  assert.equal(levelVerdict(0), "silence");
  assert.equal(levelVerdict(0.01), "quiet");
  assert.equal(levelVerdict(0.1), "good");
  assert.equal(levelVerdict(0.4), "loud");
  assert.equal(levelVerdict(0.9), "clipping");
});

// ---------------------------------------------------------------------------
// Session plan
// ---------------------------------------------------------------------------
test("a first-ever session opens with a piece, not with an empty plan", () => {
  const plan = planSession({ stars: {}, lastPlayed: {}, weakBars: [] });
  assert.equal(plan.length, 1);
  assert.equal(plan[0].kind, "new");
});

test("warm-up comes first, the drill second, the new piece last", () => {
  const plan = planSession({
    stars: { twinkle: 3, "ode-to-joy": 1 },
    lastPlayed: { twinkle: 1000, "ode-to-joy": 2000 },
    weakBars: [5, 7],
  });
  assert.deepEqual(plan.map((s) => s.kind), ["warmup", "review", "new"]);
  // The drill targets the most recent piece and the bars that failed in it.
  assert.equal(plan[1].song.id, "ode-to-joy");
  assert.deepEqual(plan[1].loop, { from: 5, to: 7 });
  // The warm-up is the easiest thing already learnt, not the hardest.
  assert.equal(plan[0].song.level, 1);
  // And the new piece is one that has never been finished.
  assert.equal(plan[2].song.id, "mary-lamb");
});

test("with nothing failing there is no drill step", () => {
  const plan = planSession({ stars: { twinkle: 3 }, lastPlayed: { twinkle: 1 }, weakBars: [] });
  assert.ok(!plan.some((s) => s.kind === "review"));
});

test("a finished library still yields a plan", () => {
  const stars: Record<string, number> = {};
  const lastPlayed: Record<string, number> = {};
  for (const song of SONGS) {
    stars[song.id] = 3;
    lastPlayed[song.id] = 1000;
  }
  const plan = planSession({ stars, lastPlayed, weakBars: [] });
  // Nothing is unplayed, so there is no "new" step — but the plan must not be
  // empty: it falls back to revisiting the hardest piece.
  assert.ok(plan.length >= 1);
  assert.ok(!plan.some((s) => s.kind === "new"));
  assert.ok(plan.some((s) => s.song.level === 6), "should point at the hard end");
});
