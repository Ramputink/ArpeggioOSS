/**
 * Two keys at once: the whole chain, end to end.
 *
 * This is the case the app cannot get away with approximating, and the one with
 * the most moving parts:
 *
 *   the score says "chord here"  -> the combiner escalates to MOTOR 2 immediately
 *   MOTOR 2 transcribes the notes -> the follower collects the tones
 *   every tone collected          -> and only then does the cursor advance
 *
 * MOTOR 1 (YIN) is monophonic and *cannot* report two pitches, so a chord played
 * into it produces one pitch or none. Everything here therefore checks that the
 * escalation happens, that it happens on the structural rule (not by luck), and
 * that a partly-played chord does not advance the cursor.
 *
 * MOTOR 2 is injected as a fake: the real one is Basic Pitch, tested separately
 * in @arpeggio/motor2-basicpitch. What matters here is the wiring around it.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { parseMusicXML } from "@arpeggio/musicxml-parser";

import { Combiner } from "../src/detection/combiner.js";
import { PracticeSession } from "../src/session.js";
import type { AudioFrame, DetectedNote, PitchEstimate, PolyphonicDetector } from "../src/types.js";

const SR = 44100;
const FRAME = 2048;

/** A C-E chord (two keys at once), then a single G. */
const FIXTURE = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
    <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

/** Sum of sines: what two keys pressed together actually look like. */
function chordFrames(midis: number[], startSec: number, count = 4): AudioFrame[] {
  const frames: AudioFrame[] = [];
  let t = startSec;
  for (let i = 0; i < count; i++) {
    const samples = new Float32Array(FRAME);
    for (let n = 0; n < FRAME; n++) {
      const tt = t + n / SR;
      let value = 0;
      for (const midi of midis) {
        value += Math.sin(2 * Math.PI * 440 * Math.pow(2, (midi - 69) / 12) * tt);
      }
      samples[n] = (0.9 * value) / midis.length;
    }
    frames.push({ samples, sampleRate: SR, timeSec: t });
    t += FRAME / SR;
  }
  return frames;
}

/**
 * A MOTOR 2 stand-in. Given one pitch set it reports it every time; given a list
 * of sets it plays them out one window at a time, which is how a chord spread
 * across windows is modelled.
 */
class FakePoly implements PolyphonicDetector {
  calls = 0;
  /** Windows served so far — the script advances per window, not per call. */
  windows = 0;
  private readonly script: number[][];
  private lastFrames: AudioFrame[] | null = null;

  constructor(midis: number[] | number[][]) {
    this.script = Array.isArray(midis[0]) ? (midis as number[][]) : [midis as number[]];
  }

  async detect(frames: AudioFrame[]): Promise<DetectedNote[]> {
    this.calls++;
    // `PracticeSession.listen` runs the combiner once per FRAME, so a four-frame
    // window asks MOTOR 2 four times with the same audio. A detector must
    // therefore be idempotent per window — the real ones (BasicPitchDetector,
    // WorkerPolyDetector) memoise on the frames array identity for exactly this
    // reason, and a fake that ignored it would model something that cannot happen.
    if (frames !== this.lastFrames) {
      this.lastFrames = frames;
      this.windows++;
    }
    const step = this.script[Math.min(this.windows - 1, this.script.length - 1)];
    const timeSec = frames[0]?.timeSec ?? 0;
    return step.map((midi) => ({
      midi,
      onsetSec: timeSec,
      offsetSec: null,
      confidence: 0.9,
      engine: "poly" as const,
    }));
  }
}

function estimate(patch: Partial<PitchEstimate> = {}): PitchEstimate {
  return { midi: 60, hz: 261.6, probability: 0.9, energy: 0.2, timeSec: 0, ...patch };
}

// ---------------------------------------------------------------------------
// The combiner: why MOTOR 2 is ever asked at all
// ---------------------------------------------------------------------------

test("a chord in the score escalates to MOTOR 2 on the very first frame", async () => {
  const poly = new FakePoly([60, 64]);
  const combiner = new Combiner(poly);
  // A confident, perfectly monophonic-looking frame: none of the soft rules fire.
  const result = await combiner.combine(estimate({ probability: 0.99 }), [], {
    polyphony: true,
    expectedMidi: [60, 64],
  });
  assert.equal(result.engine, "poly", "the score is authoritative, no debounce");
  assert.deepEqual(
    result.notes.map((n) => n.midi),
    [60, 64],
  );
  assert.equal(poly.calls, 1);
});

test("without a chord in the score, one bad frame does not switch engines", async () => {
  const poly = new FakePoly([60, 64]);
  const combiner = new Combiner(poly, { hysteresisFrames: 3 });
  // A single low-confidence frame is noise, not a chord.
  const first = await combiner.combine(estimate({ probability: 0.1 }), [], {});
  assert.equal(first.engine, "mono");
  assert.equal(poly.calls, 0, "MOTOR 2 must not be run on a hunch");
  // Three in a row is a pattern, and then it switches.
  await combiner.combine(estimate({ probability: 0.1 }), [], {});
  const third = await combiner.combine(estimate({ probability: 0.1 }), [], {});
  assert.equal(third.engine, "poly");
});

test("a loud frame with only moderate confidence reads as a smeared chord", async () => {
  const poly = new FakePoly([60, 64]);
  const combiner = new Combiner(poly, { hysteresisFrames: 1, thetaHigh: 0.85 });
  // Loud, pitched, and above thetaLow — so rule (b) misses it — but not
  // confident enough to be a clean single note. That is what two keys at once
  // do to an autocorrelation.
  const result = await combiner.combine(estimate({ probability: 0.7, energy: 0.4 }), [], {});
  assert.equal(result.engine, "poly");
});

test("a loud, unambiguous single note stays on the cheap engine", async () => {
  const poly = new FakePoly([60, 64]);
  const combiner = new Combiner(poly, { hysteresisFrames: 1 });
  const result = await combiner.combine(estimate({ probability: 0.97, energy: 0.4 }), [], {
    expectedMidi: [60],
  });
  assert.equal(result.engine, "mono");
  assert.equal(poly.calls, 0);
});

// ---------------------------------------------------------------------------
// The session: two keys at once, judged
// ---------------------------------------------------------------------------

test("half a chord is credited, but the cursor does not move", async () => {
  const score = parseMusicXML(FIXTURE);
  const session = new PracticeSession(score, { poly: new FakePoly([60]) });

  // Only DO of the DO+MI chord.
  const half = await session.listen(chordFrames([60, 64], 0));
  assert.ok(
    half.some((e) => e.kind === "correct" && e.playedMidi === 60),
    "the tone that was played is acknowledged straight away",
  );
  // `state.index` counts *completed* expected notes, and a chord is all or
  // nothing: half of it contributes zero. That is the difference between "you
  // played a right note" (an event) and "you got past this position" (the index).
  assert.equal(session.follower.state.index, 0, "the position is not yet cleared");
  assert.equal(session.follower.state.positionBeats, 0, "still on the chord");
  assert.equal(session.follower.state.done, false);
});

test("a complete chord advances the cursor exactly once", async () => {
  const score = parseMusicXML(FIXTURE);
  const session = new PracticeSession(score, { poly: new FakePoly([60, 64]) });

  const events = await session.listen(chordFrames([60, 64], 0));
  const correct = events.filter((e) => e.kind === "correct").map((e) => e.playedMidi);
  assert.deepEqual(
    [...correct].sort((a, b) => a! - b!),
    [60, 64],
  );
  assert.equal(session.follower.state.index, 2, "both tones counted");
  assert.equal(session.follower.state.positionBeats, 2, "now on the G");
});

test("a tone heard several times in one chord is credited once", async () => {
  // A sustained note is re-reported window after window; it must not be able to
  // complete a chord on its own.
  const score = parseMusicXML(FIXTURE);
  const session = new PracticeSession(score, { poly: new FakePoly([60, 60, 60]) });
  const events = await session.listen(chordFrames([60], 0));
  const correct = events.filter((e) => e.kind === "correct" && e.playedMidi === 60);
  assert.equal(correct.length, 1, "one tone, however often it is heard");
  assert.equal(session.follower.state.positionBeats, 0, "the chord is still incomplete");
});

test("the notes heard are reported before the follower judges them", async () => {
  const score = parseMusicXML(FIXTURE);
  const heard: number[][] = [];
  const session = new PracticeSession(score, {
    poly: new FakePoly([60, 64]),
    onDetections: (notes) => heard.push(notes.map((n) => n.midi)),
  });

  await session.listen(chordFrames([60, 64], 0));
  assert.deepEqual(heard, [[60, 64]], "both pitches, raw, in one window");
  // This is the hook a-tempo grading needs: the waiting follower's verdict is
  // not usable when the clock, not the follower, decides what is on time.
});

test("two keys that do not land in the same window still make a chord", async () => {
  // This is the normal case, not the exception: two keys pressed "together" on a
  // real piano are tens of milliseconds apart, and each 4-frame window is 186 ms,
  // so they may or may not share one. The follower keeps the tones it has already
  // heard for the current position, so either way the chord completes.
  const score = parseMusicXML(FIXTURE);
  // DO in the first window, MI in the second.
  const session = new PracticeSession(score, { poly: new FakePoly([[60], [64]]) });

  // First window: only DO reaches the detector.
  await session.listen(chordFrames([60], 0));
  assert.equal(session.follower.state.positionBeats, 0, "waiting for the other tone");

  // A later window brings MI, and the position clears.
  await session.listen(chordFrames([64], 0.2));
  assert.equal(session.follower.state.index, 2, "the chord completed across windows");
  assert.equal(session.follower.state.positionBeats, 2, "now on the G");
});
