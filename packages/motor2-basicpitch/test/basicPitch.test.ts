/**
 * Headless unit + integration tests for the real MOTOR 2 (Basic Pitch) detector.
 *
 * These exercise the parts we own — resampling, the rolling context buffer,
 * per-window memoization, cross-window onset dedup, and the note mapping — by
 * INJECTING a fake `transcribe`, so the heavy @tensorflow/tfjs runtime never
 * loads here. The real model is verified in the browser (see the package README /
 * the web app), which is its true runtime anyway.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMusicXML } from "@arpeggio/musicxml-parser";
import { PracticeSession } from "@arpeggio/practice-engine";
import type { AudioFrame } from "@arpeggio/practice-engine";
import type { NoteEventTime } from "@spotify/basic-pitch";

import { BasicPitchDetector, resampleLinear, BASIC_PITCH_SAMPLE_RATE } from "../src/basicPitch.js";

const SR = 48000;
const FRAME = 2048;

/** One window of `count` silent frames advancing the audio clock from `startSec`. */
function window(startSec: number, count = 4, sampleRate = SR): AudioFrame[] {
  const frames: AudioFrame[] = [];
  let t = startSec;
  for (let i = 0; i < count; i++) {
    frames.push({ samples: new Float32Array(FRAME), sampleRate, timeSec: t });
    t += FRAME / sampleRate;
  }
  return frames;
}

/** A Basic-Pitch-style timed note (fields we consume). */
function note(pitchMidi: number, startTimeSeconds: number, amplitude = 0.8): NoteEventTime {
  return { startTimeSeconds, durationSeconds: 0.5, pitchMidi, amplitude };
}

// ---------------------------------------------------------------------------
// resampleLinear
// ---------------------------------------------------------------------------

test("resampleLinear rescales length by the rate ratio and preserves endpoints", () => {
  const input = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 5));
  const out = resampleLinear(input, 48000, BASIC_PITCH_SAMPLE_RATE);
  assert.equal(out.length, Math.round(480 * (22050 / 48000)));
  assert.ok(Math.abs(out[0] - input[0]) < 1e-6, "first sample preserved");
});

test("resampleLinear is a copy (not aliased) when rates match", () => {
  const input = Float32Array.from([1, 2, 3]);
  const out = resampleLinear(input, 44100, 44100);
  assert.notEqual(out, input);
  assert.deepEqual(Array.from(out), [1, 2, 3]);
});

// ---------------------------------------------------------------------------
// detect() — memoization
// ---------------------------------------------------------------------------

test("detect memoizes by window identity: the same frames array runs transcribe once", async () => {
  let calls = 0;
  const det = new BasicPitchDetector({
    transcribe: async () => {
      calls++;
      return [note(60, 0.05)];
    },
  });

  const w = window(0);
  const a = await det.detect(w);
  const b = await det.detect(w); // same reference — combiner does this per frame
  assert.equal(calls, 1, "transcribe must not re-run for the same window");
  assert.deepEqual(a, b);
});

test("detect returns defensive copies (mutating a result can't corrupt the cache)", async () => {
  const det = new BasicPitchDetector({ transcribe: async () => [note(60, 0.05)] });
  const w = window(0);
  const first = await det.detect(w);
  first[0].midi = 999;
  const second = await det.detect(w);
  assert.equal(second[0].midi, 60);
});

// ---------------------------------------------------------------------------
// detect() — polyphony + mapping
// ---------------------------------------------------------------------------

test("detect surfaces a real chord as simultaneous poly notes with mapped fields", async () => {
  const det = new BasicPitchDetector({
    transcribe: async () => [note(67, 0.1), note(60, 0.1), note(64, 0.1, 1.7)],
  });
  const notes = await det.detect(window(0));

  assert.equal(notes.length, 3, "a triad yields three simultaneous notes");
  assert.deepEqual(
    notes.map((n) => n.midi),
    [60, 64, 67],
    "notes are sorted by onset then returned; pitches preserved (rounded)",
  );
  for (const n of notes) {
    assert.equal(n.engine, "poly");
    assert.ok(n.onsetSec > 0 && n.offsetSec! > n.onsetSec);
    assert.ok(n.confidence >= 0 && n.confidence <= 1, "amplitude clamped to [0,1]");
  }
});

// ---------------------------------------------------------------------------
// detect() — cross-window onset dedup + absolute clock
// ---------------------------------------------------------------------------

test("an onset already reported is not emitted again by the next overlapping window", async () => {
  // Window A sees one note; window B's overlapping buffer re-detects that same
  // note AND a new later one. Only the genuinely new onset should come out of B.
  const scripts: NoteEventTime[][] = [[note(60, 0.05)], [note(60, 0.05), note(64, 0.15)]];
  let i = 0;
  const det = new BasicPitchDetector({ transcribe: async () => scripts[i++] });

  const a = await det.detect(window(0));
  const b = await det.detect(window(0.2)); // distinct array -> cache miss, new window

  assert.deepEqual(
    a.map((n) => n.midi),
    [60],
  );
  assert.deepEqual(
    b.map((n) => n.midi),
    [64],
    "the repeated onset is deduped away",
  );
  // Onsets are on the absolute audio clock (buffer start + model-relative time).
  assert.ok(Math.abs(a[0].onsetSec - 0.05) < 1e-6);
});

test("reset() clears rolling state so a re-detected onset is emitted afresh", async () => {
  const det = new BasicPitchDetector({ transcribe: async () => [note(60, 0.05)] });
  const first = await det.detect(window(0));
  assert.equal(first.length, 1);

  det.reset();
  const again = await det.detect(window(0)); // same onset, but state was cleared
  assert.equal(again.length, 1, "after reset the onset is no longer considered stale");
});

// ---------------------------------------------------------------------------
// Integration — the combiner escalates a scored chord to MOTOR 2
// ---------------------------------------------------------------------------

const CHORD_FIXTURE = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

test("PracticeSession routes a scored chord through MOTOR 2 and judges it correct", async () => {
  const score = parseMusicXML(CHORD_FIXTURE);
  let called = 0;
  // A detector that "hears" exactly the C-E-G triad when asked.
  const poly = new BasicPitchDetector({
    transcribe: async () => {
      called++;
      return [note(60, 0.02), note(64, 0.02), note(67, 0.02)];
    },
  });
  const session = new PracticeSession(score, { poly });

  const events = await session.listen(window(0, 6));

  assert.ok(called > 0, "the combiner escalated the scored chord to MOTOR 2");
  const correct = events.filter((e) => e.kind === "correct");
  const wrong = events.filter((e) => e.kind === "wrong");
  assert.ok(correct.length >= 1, `expected the chord tones judged correct, got ${correct.length}`);
  assert.equal(wrong.length, 0, "no chord tone should be judged wrong");
});

// ---------------------------------------------------------------------------
// Regression — presence-based dedup (found in review)
// ---------------------------------------------------------------------------

/** A held note that always reaches the buffer end (long duration). */
function held(pitchMidi: number, amplitude = 0.8): NoteEventTime {
  return { startTimeSeconds: 0, durationSeconds: 5, pitchMidi, amplitude };
}

test("a sustained note fires exactly once even after the rolling buffer scrolls", async () => {
  // The onset scheme re-fired a held note every window once its true onset left
  // the ~2 s buffer; presence-dedup must emit it only on the initial attack.
  const det = new BasicPitchDetector({ transcribe: async () => [held(60)] });
  const step = (4 * FRAME) / SR;
  let total = 0;
  for (let k = 0; k < 20; k++) {
    total += (await det.detect(window(k * step))).length; // contiguous windows, ~3.4 s
  }
  assert.equal(total, 1, "held note emitted once, not once per window");
});

test("a time gap resets context so the note counts as a fresh attack", async () => {
  const det = new BasicPitchDetector({ transcribe: async () => [held(60)] });
  const step = (4 * FRAME) / SR;
  const a = await det.detect(window(0));
  const b = await det.detect(window(step)); // contiguous, still ringing
  const c = await det.detect(window(10)); // large gap -> buffer + sounding reset
  assert.equal(a.length, 1);
  assert.equal(b.length, 0, "still-ringing pitch is not re-emitted");
  assert.equal(c.length, 1, "after a discontinuity it re-attacks");
});

test("a note dropped for low confidence does not suppress a genuine later note", async () => {
  // Old bug: the high-water mark advanced on dropped notes, silencing later ones.
  const scripts: NoteEventTime[][] = [
    [held(64, 0.1)], // E quiet -> dropped
    [held(60, 0.9), held(64, 0.9)], // C + E now loud
  ];
  let i = 0;
  const det = new BasicPitchDetector({ minConfidence: 0.5, transcribe: async () => scripts[i++] });
  const a = await det.detect(window(0));
  const b = await det.detect(window((4 * FRAME) / SR));
  assert.deepEqual(
    a.map((n) => n.midi),
    [],
    "quiet note dropped",
  );
  assert.deepEqual(
    b.map((n) => n.midi),
    [60, 64],
    "both loud notes emerge, none suppressed",
  );
});
