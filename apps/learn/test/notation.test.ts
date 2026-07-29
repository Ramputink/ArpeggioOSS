/**
 * The notation maths, tested headlessly.
 *
 * `StaffView` itself needs a canvas, but the decisions that make notation right
 * or wrong — which line a note sits on, how it is spelled in a key, and which
 * notes share a beam — are pure functions, and those are worth pinning down. A
 * note on the wrong staff line is a bug a screenshot review will miss.
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { MIN_KEY_WIDTH, whiteKeysNeeded } from "../src/keyboard.js";
import {
  beamGroups,
  noteName,
  octaveOf,
  shortestGap,
  spell,
  type StaffNote,
} from "../src/staff.js";

/** CSS width of the reference device, an iPhone 15 Pro in portrait. */
const IPHONE_15_PRO_WIDTH = 393;

/** Build a note run from `[midi, onset, duration]` triples. */
function notes(...spec: Array<[number, number, number]>): StaffNote[] {
  return spec.map(([midi, onset, dur], index) => ({
    index,
    midi,
    onset,
    offset: onset + dur,
    hand: "right" as const,
  }));
}

test("octave numbering follows scientific pitch", () => {
  assert.equal(octaveOf(60), 4); // middle C
  assert.equal(octaveOf(59), 3);
  assert.equal(octaveOf(72), 5);
  assert.equal(octaveOf(21), 0); // lowest key on a piano
});

test("sharp keys spell with sharps, flat keys with flats", () => {
  assert.deepEqual(spell(66, 2), { letter: "F", alter: 1, d: 4 * 7 + 3 });
  assert.deepEqual(spell(70, -1), { letter: "B", alter: -1, d: 4 * 7 + 6 });
  assert.equal(noteName(61, 0), "DO♯");
  assert.equal(noteName(61, -2), "RE♭");
  assert.equal(noteName(60, 0), "DO");
});

test("an accidental sits on its natural letter's staff line", () => {
  // D♯4 and D4 share a line; E4 is one step above.
  assert.equal(spell(63, 0).d, spell(62, 0).d);
  assert.equal(spell(64, 0).d, spell(62, 0).d + 1);
  // B♭4 sits on B's line, not A's.
  assert.equal(spell(70, -1).d, spell(71, -1).d);
});

test("eighths are beamed within a beat and broken across one", () => {
  const groups = beamGroups(notes([60, 0, 0.5], [62, 0.5, 0.5], [64, 1, 0.5], [65, 1.5, 0.5]));
  assert.equal(groups.length, 2, "one beam per beat");
  assert.deepEqual(groups.map((g) => g.length), [2, 2]);
});

test("a triplet is one beam of three", () => {
  const third = 1 / 3;
  const groups = beamGroups(notes([60, 0, third], [62, third, third], [64, 2 * third, third]));
  assert.equal(groups.length, 1);
  assert.equal(groups[0].length, 3);
});

test("sixteenths beam four to a beat", () => {
  const groups = beamGroups(
    notes([60, 0, 0.25], [62, 0.25, 0.25], [64, 0.5, 0.25], [65, 0.75, 0.25]),
  );
  assert.deepEqual(groups.map((g) => g.length), [4]);
});

test("long notes, rests and lone short notes never form a beam", () => {
  // A quarter note between two eighths breaks the run.
  assert.deepEqual(beamGroups(notes([60, 0, 0.5], [62, 0.5, 1], [64, 1.5, 0.5])), []);
  // A gap (a rest) also breaks it, even inside one beat.
  assert.deepEqual(beamGroups(notes([60, 0, 0.25], [62, 0.5, 0.25])), []);
  // A single eighth on its own keeps its flag.
  assert.deepEqual(beamGroups(notes([60, 0, 0.5])), []);
});

test("the horizontal scale follows the shortest note in the piece", () => {
  assert.equal(shortestGap(notes([60, 0, 1], [62, 1, 1], [64, 2, 1])), 1);
  assert.equal(shortestGap(notes([60, 0, 1], [62, 1, 0.5], [64, 1.5, 0.5])), 0.5);
  // Chords share a slot, so a simultaneous note must not count as zero spacing.
  assert.equal(shortestGap(notes([60, 0, 2], [64, 0, 2], [67, 2, 2])), 1);
  // A piece of whole notes must not spread itself across three screens…
  assert.equal(shortestGap(notes([60, 0, 4], [62, 4, 4])), 1);
  // …and a 32nd must not shrink the layout past the floor.
  assert.equal(shortestGap(notes([60, 0, 0.05], [62, 0.05, 0.05])), 0.125);
  assert.equal(shortestGap([]), 1);
});

test("a beginner's key range fits an iPhone 15 Pro without scrolling", () => {
  const fits = (lo: number, hi: number): boolean =>
    whiteKeysNeeded(lo, hi) * MIN_KEY_WIDTH <= IPHONE_15_PRO_WIDTH;
  // Level 1 lives in the five-finger position: one octave of keys, no scrolling.
  assert.ok(fits(60, 67), "C4–G4 must fit");
  assert.ok(fits(60, 71), "a full octave must fit");
  // Für Elise spans three and a half octaves and genuinely cannot fit — that is
  // the case the setup sheet warns about rather than pretending otherwise.
  assert.ok(!fits(45, 76), "A2–E5 must not claim to fit");
  // At least twelve white keys are visible, which is what makes a two-hand piece
  // usable at all on this screen.
  assert.ok(Math.floor(IPHONE_15_PRO_WIDTH / MIN_KEY_WIDTH) >= 12);
});

test("the key range is padded out to whole octaves", () => {
  // A single note still yields a full octave, so the keyboard always starts on a C.
  assert.equal(whiteKeysNeeded(64, 64), 7);
  assert.equal(whiteKeysNeeded(60, 71), 7);
  assert.equal(whiteKeysNeeded(60, 72), 14);
});

test("every beamed note appears in exactly one group", () => {
  const run = notes(
    [60, 0, 0.5], [62, 0.5, 0.5], [64, 1, 0.5], [65, 1.5, 0.5], [67, 2, 2],
  );
  const grouped = beamGroups(run).flat();
  assert.equal(new Set(grouped.map((n) => n.index)).size, grouped.length);
  assert.ok(!grouped.some((n) => n.offset - n.onset > 0.75), "no long note is beamed");
});
