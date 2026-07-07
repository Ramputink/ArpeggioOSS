/**
 * Unit tests for da capo / dal segno navigation and score-timewise support.
 *
 * The navigation fixtures use one whole note per measure (divisions=1, 4/4) so
 * the played measure sequence maps one-to-one onto the emitted note pitches,
 * making the expanded timeline easy to assert on.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMusicXML } from "../src/index.js";

/** One measure carrying a single whole note of the given pitch, plus extras. */
function measure(number: number, step: string, extra = ""): string {
  const attrs =
    number === 1
      ? `<attributes><divisions>1</divisions>` +
        `<time><beats>4</beats><beat-type>4</beat-type></time></attributes>`
      : "";
  return (
    `<measure number="${number}">${attrs}${extra}` +
    `<note><pitch><step>${step}</step><octave>4</octave></pitch>` +
    `<duration>4</duration><voice>1</voice><staff>1</staff></note></measure>`
  );
}

function wrap(body: string): string {
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<score-partwise version="4.0">` +
    `<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>` +
    `<part id="P1">${body}</part></score-partwise>`
  );
}

// D.C. al Fine: play 1-2-3, da capo back to the top, then play until Fine
// (marked on measure 1) and stop. Expected sequence: 1, 2, 3, 1.
const DC_AL_FINE = wrap(
  measure(1, "C", `<direction><sound fine="yes"/></direction>`) +
    measure(2, "D") +
    measure(3, "E", `<direction><sound dacapo="yes"/></direction>`),
);

test("expands D.C. al Fine into a linear timeline", () => {
  const score = parseMusicXML(DC_AL_FINE);
  assert.equal(score.repeatsFlattened, true);
  assert.equal(score.events.length, 4);
  assert.deepEqual(
    score.events.map((e) => e.pitchMidi),
    [60, 62, 64, 60], // C D E C
  );
  assert.deepEqual(
    score.events.map((e) => e.measure),
    [1, 2, 3, 1],
  );
});

// D.S. al Coda: play 1-2-3, dal segno back to the segno (measure 1), then on the
// return pass jump from the "to coda" point (measure 2) to the coda (measure 4).
// Expected sequence: 1, 2, 3, 1, 2, 4.
const DS_AL_CODA = wrap(
  measure(1, "C", `<direction><sound segno="segno"/></direction>`) +
    measure(2, "D", `<direction><sound tocoda="coda"/></direction>`) +
    measure(3, "E", `<direction><sound dalsegno="segno"/></direction>`) +
    measure(4, "F", `<direction><sound coda="coda"/></direction>`),
);

test("expands D.S. al Coda into a linear timeline", () => {
  const score = parseMusicXML(DS_AL_CODA);
  assert.equal(score.repeatsFlattened, true);
  assert.equal(score.events.length, 6);
  assert.deepEqual(
    score.events.map((e) => e.pitchMidi),
    [60, 62, 64, 60, 62, 65], // C D E C D F
  );
  assert.deepEqual(
    score.events.map((e) => e.measure),
    [1, 2, 3, 1, 2, 4],
  );
});

// score-timewise must parse to the same events as its partwise equivalent.
const PARTWISE = wrap(measure(1, "C") + measure(2, "D"));

const TIMEWISE =
  `<?xml version="1.0" encoding="UTF-8"?>` +
  `<score-timewise version="4.0">` +
  `<part-list><score-part id="P1"><part-name>P</part-name></score-part></part-list>` +
  `<measure number="1"><part id="P1">` +
  `<attributes><divisions>1</divisions>` +
  `<time><beats>4</beats><beat-type>4</beat-type></time></attributes>` +
  `<note><pitch><step>C</step><octave>4</octave></pitch>` +
  `<duration>4</duration><voice>1</voice><staff>1</staff></note></part></measure>` +
  `<measure number="2"><part id="P1">` +
  `<note><pitch><step>D</step><octave>4</octave></pitch>` +
  `<duration>4</duration><voice>1</voice><staff>1</staff></note></part></measure>` +
  `</score-timewise>`;

test("score-timewise parses to the same events as partwise", () => {
  const partwise = parseMusicXML(PARTWISE);
  const timewise = parseMusicXML(TIMEWISE);
  assert.deepEqual(timewise.parts, partwise.parts);
  assert.equal(timewise.divisions, partwise.divisions);
  assert.deepEqual(timewise.events, partwise.events);
  assert.equal(timewise.events.length, 2);
});
