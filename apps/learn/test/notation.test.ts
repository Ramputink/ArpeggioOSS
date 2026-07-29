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

import { beamGroups, noteName, octaveOf, spell, type StaffNote } from "../src/staff.js";

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

test("every beamed note appears in exactly one group", () => {
  const run = notes(
    [60, 0, 0.5], [62, 0.5, 0.5], [64, 1, 0.5], [65, 1.5, 0.5], [67, 2, 2],
  );
  const grouped = beamGroups(run).flat();
  assert.equal(new Set(grouped.map((n) => n.index)).size, grouped.length);
  assert.ok(!grouped.some((n) => n.offset - n.onset > 0.75), "no long note is beamed");
});
