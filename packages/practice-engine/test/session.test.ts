/**
 * Capstone integration test: drive a full PracticeSession with synthesized audio
 * and assert the whole chain works — detection (YIN) → follow-you → feedback.
 *
 * The "player" performs a C-D-E-F run (the same notes the score expects) as pure
 * sine tones; the session must follow them to the end, judge them correct, and
 * populate the feedback loops.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMusicXML } from "@arpeggio/musicxml-parser";
import { PracticeSession } from "../src/session.js";
import type { AudioFrame } from "../src/types.js";

const FIXTURE = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
    <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><voice>1</voice><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

const SR = 44100;
const FRAME = 2048;

/** Build `count` sine frames at the given MIDI pitch, advancing the clock. */
function sineFrames(midi: number, startSec: number, count = 5): AudioFrame[] {
  const hz = 440 * Math.pow(2, (midi - 69) / 12);
  const frames: AudioFrame[] = [];
  let t = startSec;
  for (let i = 0; i < count; i++) {
    const samples = new Float32Array(FRAME);
    for (let n = 0; n < FRAME; n++) {
      const tt = t + n / SR;
      samples[n] = 0.9 * Math.sin(2 * Math.PI * hz * tt);
    }
    frames.push({ samples, sampleRate: SR, timeSec: t });
    t += FRAME / SR;
  }
  return frames;
}

test("a correct C-D-E-F performance follows to the end and judges correct", async () => {
  const score = parseMusicXML(FIXTURE);
  const session = new PracticeSession(score);

  const midis = [60, 62, 64, 65];
  let t = 0;
  const allEvents = [];
  for (const midi of midis) {
    const events = await session.listen(sineFrames(midi, t));
    allEvents.push(...events);
    t += 0.5;
  }

  // The follower reached the end...
  assert.equal(session.follower.state.done, true);
  // ...and produced at least one "correct" per played note, with no "wrong".
  const correct = allEvents.filter((e) => e.kind === "correct");
  const wrong = allEvents.filter((e) => e.kind === "wrong");
  assert.ok(correct.length >= 4, `expected >=4 correct, got ${correct.length}`);
  assert.equal(wrong.length, 0);
});

test("the feedback loops are populated and thresholds stay valid", async () => {
  const score = parseMusicXML(FIXTURE);
  const session = new PracticeSession(score);

  let t = 0;
  for (const midi of [60, 62, 64, 65]) {
    await session.listen(sineFrames(midi, t));
    t += 0.5;
  }

  const p = session.progress;
  // Thresholds remain well-formed after calibration.
  assert.ok(p.thresholds.thetaLow >= 0 && p.thresholds.thetaLow <= 1);
  assert.ok(Math.abs(p.thresholds.monoWeight + p.thresholds.polyWeight - 1) < 1e-6);
  // The student model recorded measure 1 activity.
  const stats = session.student.statsByMeasure();
  assert.ok((stats.get(1)?.attempts ?? 0) >= 4);
});
