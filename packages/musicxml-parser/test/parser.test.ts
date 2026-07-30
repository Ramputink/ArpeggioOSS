/**
 * Unit tests for the MusicXML parser.
 *
 * The fixture exercises the two trickiest behaviours: repeat flattening (a
 * `forward`/`backward` repeat pair doubles the timeline) and tie merging (two
 * half notes joined by a tie collapse into one event).
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMusicXML, qualityReport } from "../src/index.js";

// 2 measures in 4/4, divisions=1. Measure 1 (C D E F quarters) is wrapped in a
// forward/backward repeat, and measure 2 is a G tied across two half notes.
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
      <barline location="left"><repeat direction="forward"/></barline>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="2">
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice><staff>1</staff></note>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice><staff>1</staff></note>
      <barline location="right"><repeat direction="backward"/></barline>
    </measure>
  </part>
</score-partwise>`;

test("flattens repeats into a linear timeline", () => {
  const score = parseMusicXML(FIXTURE);
  assert.equal(score.repeatsFlattened, true);
  // 4 quarter notes x 2 plays + 1 tied G x 2 plays = 10 events.
  assert.equal(score.events.length, 10);
  // 4 measures of 4 beats each after expansion.
  const report = qualityReport(score);
  assert.equal(report.durationQuarters, 16);
});

test("merges tied notes into a single event", () => {
  const score = parseMusicXML(FIXTURE);
  const gNotes = score.events.filter((e) => e.pitchMidi === 67);
  assert.equal(gNotes.length, 2); // one per repeat pass, each already merged
  for (const g of gNotes) {
    assert.equal(g.tied, true);
    assert.equal(g.offset - g.onset, 4); // full 4/4 measure, not 2
  }
});

test("computes correct pitch, onset ordering and hands", () => {
  const score = parseMusicXML(FIXTURE);
  const first = score.events[0];
  assert.equal(first.pitchMidi, 60); // C4
  assert.equal(first.onset, 0);
  assert.equal(first.hand, "right"); // staff 1
  // Onsets must be non-decreasing.
  for (let i = 1; i < score.events.length; i++) {
    assert.ok(score.events[i].onset >= score.events[i - 1].onset);
  }
});

test("quality report is clean for a well-formed score", () => {
  const report = qualityReport(parseMusicXML(FIXTURE));
  assert.equal(report.notes, 10);
  assert.equal(report.parts, 1);
  assert.deepEqual(report.pitchRange, [60, 67]);
  const errors = report.warnings.filter((w) => w.level === "error");
  assert.equal(errors.length, 0);
});

// A repeat-flattened measure must not be flagged overfull just because it
// recurs (regression: durations were measured on global onsets, conflating
// repeat passes). The clean FIXTURE has repeats, so it must stay warning-free.
test("repeat-flattened measures are not falsely flagged as overfull", () => {
  const report = qualityReport(parseMusicXML(FIXTURE));
  const overfull = report.warnings.filter((w) => w.code === "measure-overfull");
  assert.equal(overfull.length, 0);
});

// A genuinely overfull measure (5 quarters crammed into 4/4) must be flagged.
test("genuinely overfull measure is flagged", () => {
  const bad = `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1"><measure number="1">
      <attributes><divisions>1</divisions>
        <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice></note>
    </measure></part>
  </score-partwise>`;
  const report = qualityReport(parseMusicXML(bad));
  const overfull = report.warnings.filter((w) => w.code === "measure-overfull");
  assert.equal(overfull.length, 1);
});

// Regression: a tie across a barline extends a note into the next measure. Its
// out-of-measure duration must NOT count toward the starting measure's length,
// or every legitimate cross-barline tie (ubiquitous in piano music) would be
// flagged "measure-overfull". (Found in review.)
test("cross-barline tie does not trigger a false overfull warning", () => {
  const xml = `<?xml version="1.0"?>
  <score-partwise version="4.0">
    <part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>
    <part id="P1">
      <measure number="1">
        <attributes><divisions>1</divisions>
          <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
        <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="start"/><voice>1</voice></note>
      </measure>
      <measure number="2">
        <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><tie type="stop"/><voice>1</voice></note>
        <note><rest/><duration>2</duration><voice>1</voice></note>
      </measure>
    </part>
  </score-partwise>`;
  const score = parseMusicXML(xml);
  // The tie merged into one G spanning into measure 2 (onset 2, offset 6).
  const g = score.events.find((e) => e.pitchMidi === 67);
  assert.ok(g && g.tied === true && g.offset - g.onset === 4);
  const report = qualityReport(score);
  const overfull = report.warnings.filter((w) => w.code === "measure-overfull");
  assert.equal(overfull.length, 0);
});

// ---------------------------------------------------------------------------
// Key signatures
// ---------------------------------------------------------------------------

/** Two measures, opening in D major and modulating to F major. */
const KEY_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes>
        <divisions>1</divisions>
        <key><fifths>2</fifths><mode>major</mode></key>
        <time><beats>4</beats><beat-type>4</beat-type></time>
      </attributes>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    </measure>
    <measure number="2">
      <attributes><key><fifths>-1</fifths></key></attributes>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    </measure>
  </part>
</score-partwise>`;

test("reads key signatures, including a mid-piece change", () => {
  const score = parseMusicXML(KEY_FIXTURE);
  assert.deepEqual(score.keySignatures, [
    { measure: 1, fifths: 2 },
    { measure: 2, fifths: -1 },
  ]);
});

test("C major is a key signature, not a missing one", () => {
  // `<fifths>0</fifths>` must survive: a renderer that treats 0 as "absent"
  // would print every accidental explicitly for the most common key there is.
  const score = parseMusicXML(KEY_FIXTURE.replace("<fifths>2</fifths>", "<fifths>0</fifths>"));
  assert.equal(score.keySignatures[0].fifths, 0);
});

test("a score with no key element reports no key signature", () => {
  const score = parseMusicXML(FIXTURE);
  assert.deepEqual(score.keySignatures, []);
});
