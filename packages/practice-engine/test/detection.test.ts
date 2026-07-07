/**
 * Unit tests for the note-detection subsystem (MOTOR 1 + MOTOR 2 seam + combiner).
 *
 * Imports come DIRECTLY from the detection source files, not the package root,
 * because sibling subsystems (follower/, feedback/) may not exist yet when this
 * suite runs — the package `index.ts` re-exports them and would fail to resolve.
 */
import assert from "node:assert/strict";
import { test } from "node:test";

import { YinDetector, segmentNotes } from "../src/detection/yin.js";
import { StubPolyphonicDetector } from "../src/detection/polyphonic.js";
import { Combiner } from "../src/detection/combiner.js";
import type { AudioFrame, PitchEstimate } from "../src/types.js";

const SAMPLE_RATE = 44100;

/** Synthesize a mono sine-wave AudioFrame at a given frequency. */
function sineFrame(
  freq: number,
  {
    length = 4096,
    sampleRate = SAMPLE_RATE,
    timeSec = 0,
    amp = 0.5,
  }: { length?: number; sampleRate?: number; timeSec?: number; amp?: number } = {},
): AudioFrame {
  const samples = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    samples[i] = amp * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return { samples, sampleRate, timeSec };
}

/** A synthetic "confident mono" estimate for combiner tests. */
function estimate(partial: Partial<PitchEstimate> = {}): PitchEstimate {
  return {
    midi: 69,
    hz: 440,
    probability: 0.95,
    energy: 0.3,
    timeSec: 0,
    ...partial,
  };
}

// ---------------------------------------------------------------------------
// MOTOR 1 — YIN pitch detection
// ---------------------------------------------------------------------------

test("YIN detects A4 (440 Hz) as MIDI ~69", () => {
  const det = new YinDetector();
  const est = det.process(sineFrame(440));
  assert.notEqual(est.midi, null);
  assert.ok(Math.abs((est.midi as number) - 69) < 0.5, `midi was ${est.midi}`);
  assert.ok(est.probability > 0.8, `probability was ${est.probability}`);
});

test("YIN detects C4 (261.63 Hz) as MIDI ~60", () => {
  const det = new YinDetector();
  const est = det.process(sineFrame(261.63));
  assert.notEqual(est.midi, null);
  assert.ok(Math.abs((est.midi as number) - 60) < 0.5, `midi was ${est.midi}`);
});

test("YIN reports a silent frame as unvoiced (midi null)", () => {
  const det = new YinDetector();
  const silent: AudioFrame = {
    samples: new Float32Array(4096), // all zeros
    sampleRate: SAMPLE_RATE,
    timeSec: 0,
  };
  const est = det.process(silent);
  assert.equal(est.midi, null);
  assert.equal(est.hz, null);
  assert.equal(est.probability, 0);
});

test("YIN reports a very low-energy frame as unvoiced", () => {
  const det = new YinDetector();
  const est = det.process(sineFrame(440, { amp: 0.0001 }));
  assert.equal(est.midi, null);
});

// ---------------------------------------------------------------------------
// Segmentation
// ---------------------------------------------------------------------------

test("segmentNotes groups a stable A4 run into one note (midi 69)", () => {
  const estimates: PitchEstimate[] = [];
  for (let i = 0; i < 8; i++) {
    estimates.push({
      midi: 69 + (i % 2 === 0 ? 0.02 : -0.03), // tiny wobble, still rounds to 69
      hz: 440,
      probability: 0.9,
      energy: 0.3,
      timeSec: i * 0.02,
    });
  }
  const notes = segmentNotes(estimates);
  assert.equal(notes.length, 1);
  assert.equal(notes[0].midi, 69);
  assert.equal(notes[0].engine, "mono");
  assert.equal(notes[0].onsetSec, 0);
  assert.ok(notes[0].confidence > 0.8);
});

test("segmentNotes drops single-frame blips shorter than minFrames", () => {
  const base = { hz: 440, probability: 0.9, energy: 0.3 };
  const estimates: PitchEstimate[] = [
    { midi: 69, ...base, timeSec: 0 },
    { midi: 69, ...base, timeSec: 0.02 },
    { midi: 69, ...base, timeSec: 0.04 },
    { midi: 81, ...base, timeSec: 0.06 }, // lone octave-jump glitch
    { midi: 69, ...base, timeSec: 0.08 },
    { midi: 69, ...base, timeSec: 0.1 },
    { midi: 69, ...base, timeSec: 0.12 },
  ];
  const notes = segmentNotes(estimates);
  // The 1-frame midi-81 blip is discarded; two 3-frame runs of 69 survive.
  assert.ok(notes.every((n) => n.midi === 69));
  assert.ok(notes.length >= 1);
});

test("segmentNotes treats low-energy frames as rests", () => {
  const notes = segmentNotes([
    { midi: 69, hz: 440, probability: 0.9, energy: 0.001, timeSec: 0 },
    { midi: 69, hz: 440, probability: 0.9, energy: 0.001, timeSec: 0.02 },
    { midi: 69, hz: 440, probability: 0.9, energy: 0.001, timeSec: 0.04 },
  ]);
  assert.equal(notes.length, 0);
});

// ---------------------------------------------------------------------------
// Combiner — engine fusion
// ---------------------------------------------------------------------------

test("Combiner uses MOTOR 1 when mono is confident and agrees", async () => {
  const poly = new StubPolyphonicDetector([
    { midi: 60, onsetSec: 0, offsetSec: null, confidence: 0.9, engine: "poly" },
  ]);
  const combiner = new Combiner(poly);
  const result = await combiner.combine(estimate(), [], { expectedMidi: [69] });
  assert.equal(result.engine, "mono");
  assert.equal(result.notes[0].midi, 69);
  assert.equal(poly.calls, 0); // MOTOR 2 must NOT be invoked
});

test("Combiner escalates to MOTOR 2 immediately when the score expects polyphony", async () => {
  const chord = [
    { midi: 60, onsetSec: 0, offsetSec: null, confidence: 0.8, engine: "poly" as const },
    { midi: 64, onsetSec: 0, offsetSec: null, confidence: 0.8, engine: "poly" as const },
    { midi: 67, onsetSec: 0, offsetSec: null, confidence: 0.8, engine: "poly" as const },
  ];
  const poly = new StubPolyphonicDetector(chord);
  const combiner = new Combiner(poly);
  const result = await combiner.combine(estimate(), [sineFrame(261.63)], { polyphony: true });
  assert.equal(result.engine, "poly");
  assert.equal(result.notes.length, 3);
  assert.equal(poly.calls, 1);
});

test("Combiner escalates to MOTOR 2 on sustained low mono confidence (hysteresis)", async () => {
  const poly = new StubPolyphonicDetector([
    { midi: 60, onsetSec: 0, offsetSec: null, confidence: 0.7, engine: "poly" },
  ]);
  const combiner = new Combiner(poly, { hysteresisFrames: 3 });
  const lowConf = estimate({ midi: null, hz: null, probability: 0.1 });

  // First two low-confidence frames are debounced -> still mono.
  let r = await combiner.combine(lowConf);
  assert.equal(r.engine, "mono");
  r = await combiner.combine(lowConf);
  assert.equal(r.engine, "mono");
  assert.equal(poly.calls, 0);

  // Third consecutive low-confidence frame trips the hysteresis -> poly.
  r = await combiner.combine(lowConf);
  assert.equal(r.engine, "poly");
  assert.equal(poly.calls, 1);
});

test("Combiner relaxes back to MOTOR 1 after sustained confident frames", async () => {
  const poly = new StubPolyphonicDetector([
    { midi: 60, onsetSec: 0, offsetSec: null, confidence: 0.7, engine: "poly" },
  ]);
  const combiner = new Combiner(poly, { hysteresisFrames: 2 });
  const lowConf = estimate({ midi: null, probability: 0.1 });

  await combiner.combine(lowConf);
  await combiner.combine(lowConf); // now on poly
  assert.equal(combiner.currentEngine, "poly");

  await combiner.combine(estimate());
  const r = await combiner.combine(estimate()); // two confident frames -> mono
  assert.equal(r.engine, "mono");
  assert.equal(combiner.currentEngine, "mono");
});
