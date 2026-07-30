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
  systemLayout,
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
  assert.deepEqual(
    groups.map((g) => g.length),
    [2, 2],
  );
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
  assert.deepEqual(
    groups.map((g) => g.length),
    [4],
  );
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
  const run = notes([60, 0, 0.5], [62, 0.5, 0.5], [64, 1, 0.5], [65, 1.5, 0.5], [67, 2, 2]);
  const grouped = beamGroups(run).flat();
  assert.equal(new Set(grouped.map((n) => n.index)).size, grouped.length);
  assert.ok(!grouped.some((n) => n.offset - n.onset > 0.75), "no long note is beamed");
});

// ---------------------------------------------------------------------------
// System geometry
// ---------------------------------------------------------------------------

/** An iPhone 15 Pro in portrait, with the staff area a phone actually gives it. */
const PHONE = { width: 393, height: 260, clefCount: 1, sharps: 0, maxSpace: 22, minGap: 1 };
/** The same phone in landscape on a music desk, where the notation grows. */
const STAND = { width: 852, height: 300, clefCount: 2, sharps: 0, maxSpace: 34, minGap: 1 };

test("the staff is centred vertically, not pinned to the top", () => {
  // A top-anchored staff leaves a dead half-screen underneath on a tall phone.
  const tall = systemLayout({ ...PHONE, height: 600 });
  const used = tall.staffTops[0] + 4 * tall.space;
  const above = tall.staffTops[0];
  const below = 600 - used;
  assert.ok(Math.abs(above - below) < 3 * tall.space, "the system sits near the middle");
});

test("notation never grows past the cap for its layout", () => {
  assert.ok(systemLayout({ ...PHONE, height: 2000 }).space <= 22);
  assert.ok(systemLayout({ ...STAND, height: 2000 }).space <= 34);
  // ...and never collapses to nothing on a short screen either.
  assert.ok(systemLayout({ ...PHONE, height: 40 }).space >= 5);
});

test("a grand staff leaves a corridor between the two staves", () => {
  const grand = systemLayout(STAND);
  assert.equal(grand.staffTops.length, 2);
  const gapBetween = grand.staffTops[1] - (grand.staffTops[0] + 4 * grand.space);
  assert.ok(gapBetween > 3 * grand.space, "the two staves must not touch");
});

test("the key-signature gutter is sized by its contents", () => {
  // A constant wide enough for four sharps would spend a third of a 393 px
  // screen on a piece in C major.
  const cMajor = systemLayout(PHONE);
  const eMajor = systemLayout({ ...PHONE, sharps: 4 });
  assert.ok(eMajor.gutter > cMajor.gutter, "four sharps need more room than none");
  assert.ok(cMajor.gutter < 0.25 * PHONE.width, "C major must not eat the screen");
});

test("a crowded key signature is squeezed to the cap the library can actually reach", () => {
  // Four sharps is the worst case in the repertoire (the Moonlight), and there
  // the squeeze holds the gutter to exactly the 34% budget.
  const four = systemLayout({ ...PHONE, sharps: 4 });
  assert.ok(four.gutter <= 0.34 * PHONE.width + 0.5, "four sharps fit the budget");
  assert.ok(four.accStep < 0.85 * four.space, "and they were squeezed to do it");
});

test("the squeeze stops at legibility, and says so rather than pretending", () => {
  // Seven sharps cannot fit the 34% budget without accidentals narrower than
  // half a staff space, which is unreadable on a phone. The floor wins, and the
  // gutter is allowed past the target — a deliberate trade, not an oversight,
  // and worth pinning down so nobody "fixes" the cap and gets mush instead.
  const seven = systemLayout({ ...PHONE, sharps: 7 });
  assert.ok(seven.gutter > 0.34 * PHONE.width, "the budget is exceeded");
  assert.ok(seven.accStep >= 0.52 * seven.space, "because legibility is the floor");
  // It must still leave the music most of the screen, and the playhead past the clef.
  assert.ok(seven.gutter < 0.45 * PHONE.width);
  assert.ok(seven.playX > seven.gutter, "the playhead stays past the clef");
});

test("the horizontal scale comes from the shortest note, so heads cannot overlap", () => {
  // A head is 1.32 staff spaces wide; a semiquaver passage (minGap 0.25) must
  // still leave daylight between consecutive heads.
  const dense = systemLayout({ ...PHONE, minGap: 0.25 });
  assert.ok(dense.pxPerBeat * 0.25 > 1.32 * dense.space, "semiquavers must not collide");
  // And a piece of crotchets is not stretched to absurdity by the same rule.
  const sparse = systemLayout({ ...PHONE, minGap: 4 });
  assert.ok(sparse.pxPerBeat >= 46 && sparse.pxPerBeat <= 200);
});

test("the playhead leaves room for what was just played", () => {
  const phone = systemLayout(PHONE);
  assert.ok(phone.playX > phone.gutter, "never behind the clef");
  assert.ok(phone.playX < PHONE.width / 2, "and never past the middle of a phone");
});
