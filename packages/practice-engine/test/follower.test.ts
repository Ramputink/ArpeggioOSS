/**
 * Unit tests for the score-following subsystem (follower/).
 *
 * Fixture: a 4-note C-D-E-F run in 4/4 (MIDI 60, 62, 64, 65), parsed from
 * inline MusicXML so the tests exercise the real `Score` -> `ExpectedNote`
 * projection rather than a hand-built literal.
 */

import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMusicXML } from "@arpeggio/musicxml-parser";

import type { DetectedNote } from "../src/types.js";
import { expectedNotesFromScore } from "../src/follower/expected.js";
import { FollowYouFollower } from "../src/follower/followYou.js";
import { dtwAlign } from "../src/follower/dtw.js";

// A single 4/4 measure: C D E F quarter notes, no repeats.
const FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time>
        <clef><sign>G</sign><line>2</line></clef>
      </attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

/** Build a DetectedNote for the given pitch at a given time (confident by default). */
function det(midi: number, onsetSec: number, confidence = 1): DetectedNote {
  return { midi, onsetSec, offsetSec: null, confidence, engine: "mono" };
}

test("expectedNotesFromScore yields 4 ordered notes 60,62,64,65", () => {
  const score = parseMusicXML(FIXTURE);
  const expected = expectedNotesFromScore(score);
  assert.equal(expected.length, 4);
  assert.deepEqual(
    expected.map((e) => e.midi),
    [60, 62, 64, 65],
  );
  // Onsets are non-decreasing.
  for (let i = 1; i < expected.length; i++) {
    assert.ok(expected[i].onset >= expected[i - 1].onset);
  }
});

test("correct pitches in order advance to the end, all events correct", () => {
  const score = parseMusicXML(FIXTURE);
  const follower = new FollowYouFollower(score);

  const pitches = [60, 62, 64, 65];
  const allEvents = [];
  for (let i = 0; i < pitches.length; i++) {
    const events = follower.onDetected(det(pitches[i], i * 0.5));
    allEvents.push(...events);
  }

  assert.equal(follower.state.index, 4);
  assert.equal(follower.state.done, true);
  assert.equal(allEvents.length, 4);
  for (const e of allEvents) {
    assert.equal(e.kind, "correct");
  }
});

test("a wrong pitch reports 'wrong' and does not advance; the right one then advances", () => {
  const score = parseMusicXML(FIXTURE);
  const follower = new FollowYouFollower(score);

  // Expected first note is C (60); play E (64) instead.
  const wrong = follower.onDetected(det(64, 0));
  assert.equal(wrong.length, 1);
  assert.equal(wrong[0].kind, "wrong");
  assert.equal(follower.state.index, 0);
  assert.equal(follower.state.done, false);

  // Now the correct C advances the cursor.
  const right = follower.onDetected(det(60, 0.2));
  assert.equal(right.length, 1);
  assert.equal(right[0].kind, "correct");
  assert.equal(follower.state.index, 1);
});

test("onTick surfaces a single hesitation after the wait", () => {
  const score = parseMusicXML(FIXTURE);
  const follower = new FollowYouFollower(score, { hesitationWaitSec: 1 });

  assert.equal(follower.onTick(0.5).length, 0); // within the wait
  const late = follower.onTick(1.5);
  assert.equal(late.length, 1);
  assert.equal(late[0].kind, "hesitation");
  assert.equal(follower.onTick(2.5).length, 0); // only fires once per position
});

test("dtwAlign maps a stream with a spurious note back onto the expected run", () => {
  const score = parseMusicXML(FIXTURE);
  const expected = expectedNotesFromScore(score);

  // C, D, <spurious high note>, E, F.
  const detected = [det(60, 0.0), det(62, 0.5), det(96, 0.7), det(64, 1.0), det(65, 1.5)];
  const mapping = dtwAlign(detected, expected);

  // The genuine notes align to their own indices; the spurious note folds onto
  // a neighbour without disturbing them.
  assert.equal(mapping[0], 0); // 60 -> 60
  assert.equal(mapping[1], 1); // 62 -> 62
  assert.equal(mapping[3], 2); // 64 -> 64
  assert.equal(mapping[4], 3); // 65 -> 65
  assert.ok(mapping[2] >= 1 && mapping[2] <= 2); // spurious note near its neighbours
});

// Regression: the online DtwFollower must report intermediate positions. The
// classic fixed-endpoint backtrack made every latest detection snap to the last
// expected note, pinning currentIndex to the end on the first detection.
// (Found in review; fixed via free-endpoint alignment.)
test("DtwFollower reports intermediate positions, not pinned to the end", async () => {
  const { DtwFollower } = await import("../src/follower/dtw.js");
  const exp = [60, 62, 64, 65].map((midi, i) => ({
    midi,
    onset: i,
    offset: i + 1,
    measure: 1,
    voice: 1,
    staff: 1,
  }));
  const det = (midi: number) => ({
    midi,
    onsetSec: 0,
    offsetSec: null,
    confidence: 1,
    engine: "mono" as const,
  });
  const f = new DtwFollower(exp);
  const i0 = f.onDetected(det(60));
  assert.ok(i0 < 3, `first note must not pin to the last index, got ${i0}`);
  assert.equal(i0, 0);
  const i1 = f.onDetected(det(62));
  assert.ok(i1 >= i0 && i1 < 3, `second note should progress, got ${i1}`);
});
