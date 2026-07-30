/**
 * Tests for the feedback/adaptation subsystem (loops 1 and 2).
 *
 * These import directly from the feedback source files (not the package root) so the
 * subsystem can be exercised in isolation from detection/ and follower/.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { StudentModel } from "../src/feedback/studentModel.js";
import type { ObservedEvent } from "../src/feedback/studentModel.js";
import { ThresholdCalibrator } from "../src/feedback/calibration.js";
import { DEFAULT_THRESHOLDS } from "../src/types.js";
import type { PlayerEvent, PlayerEventKind } from "../src/types.js";

// --- helpers ----------------------------------------------------------------

let clock = 0;
function ev(kind: PlayerEventKind, midi: number, timingErrorSec?: number): PlayerEvent {
  clock += 1;
  return {
    kind,
    expectedMidi: midi,
    playedMidi: kind === "wrong" ? midi + 1 : midi,
    atBeat: clock,
    timeSec: clock * 0.5,
    timingErrorSec,
  };
}

// --- StudentModel ------------------------------------------------------------

test("StudentModel: measure 8 is the weakest and drilled first", () => {
  const model = new StudentModel();
  const items: ObservedEvent[] = [];

  // Measures 1..5: mostly correct, tight timing.
  for (let m = 1; m <= 5; m++) {
    for (let i = 0; i < 4; i++) {
      items.push({ event: ev("correct", 60 + m, 0.01), measure: m });
    }
  }
  // Measure 8: attempted 5 times, only 1 correct, sloppy timing => repeatedly failed.
  items.push({ event: ev("correct", 72, 0.15), measure: 8 });
  items.push({ event: ev("wrong", 72), measure: 8 });
  items.push({ event: ev("wrong", 72), measure: 8 });
  items.push({ event: ev("late", 72, 0.18), measure: 8 });
  items.push({ event: ev("wrong", 72), measure: 8 });

  model.recordMany(items);

  // statsByMeasure: attempts/correct correct.
  const stats = model.statsByMeasure();
  const m8 = stats.get(8);
  assert.ok(m8, "measure 8 should have stats");
  assert.equal(m8.attempts, 5);
  assert.equal(m8.correct, 1);
  const m1 = stats.get(1);
  assert.ok(m1);
  assert.equal(m1.attempts, 4);
  assert.equal(m1.correct, 4);

  // accuracyByMeasure: measure 8 is low (1/5), measure 1 is perfect.
  const acc = model.accuracyByMeasure();
  assert.equal(acc.get(8), 0.2);
  assert.equal(acc.get(1), 1);
  assert.ok(acc.get(8)! < 0.5);

  // difficultyHeatmap: hardest first is measure 8.
  const heat = model.difficultyHeatmap();
  assert.equal(heat[0].measure, 8);
  assert.ok(heat[0].difficulty > 0);

  // recommendPractice: measure 8 is first in the drill list.
  const rec = model.recommendPractice(3);
  assert.ok(rec.includes(8));
  assert.equal(rec[0], 8);
  assert.ok(rec.length <= 3);
});

test("StudentModel: pitch aggregation and reset", () => {
  const model = new StudentModel();
  model.record(ev("correct", 60, 0.02), 1);
  model.record(ev("wrong", 60), 1);
  const byPitch = model.statsByPitch();
  const p60 = byPitch.get(60);
  assert.ok(p60);
  assert.equal(p60.attempts, 2);
  assert.equal(p60.correct, 1);
  // avgTimingError only counts events that carried a timing error.
  assert.ok(Math.abs(p60.avgTimingError - 0.02) < 1e-9);

  model.reset();
  assert.equal(model.statsByMeasure().size, 0);
  assert.equal(model.statsByPitch().size, 0);
  assert.equal(model.recommendPractice(3).length, 0);
});

// --- ThresholdCalibrator -----------------------------------------------------

function within01(x: number): boolean {
  return x >= 0 && x <= 1;
}

test("ThresholdCalibrator: MOTOR 1 often wrong => escalate sooner", () => {
  const cal = new ThresholdCalibrator();
  for (let i = 0; i < 30; i++) {
    cal.observe({
      motor1Correct: false,
      monoConfidence: 0.9,
      highCertainty: true,
    });
  }
  const t = cal.getThresholds();
  assert.ok(t.thetaLow > DEFAULT_THRESHOLDS.thetaLow, "thetaLow should rise");
  assert.ok(t.polyWeight > t.monoWeight, "poly should outweigh mono when MOTOR 1 is unreliable");
  // Ranges + normalization intact.
  assert.ok(within01(t.thetaLow));
  assert.ok(within01(t.monoWeight));
  assert.ok(within01(t.polyWeight));
  assert.ok(Math.abs(t.monoWeight + t.polyWeight - 1) < 1e-9);
});

test("ThresholdCalibrator: feeding the opposite moves it back", () => {
  const cal = new ThresholdCalibrator();
  for (let i = 0; i < 30; i++) {
    cal.observe({ motor1Correct: false, monoConfidence: 0.9, highCertainty: true });
  }
  const wrongState = cal.getThresholds();

  // Now MOTOR 1 is reliably right.
  for (let i = 0; i < 40; i++) {
    cal.observe({ motor1Correct: true, monoConfidence: 0.9, highCertainty: true });
  }
  const rightState = cal.getThresholds();

  assert.ok(rightState.thetaLow < wrongState.thetaLow, "thetaLow should fall back");
  assert.ok(rightState.monoWeight > rightState.polyWeight, "mono should regain dominance");
  assert.ok(within01(rightState.thetaLow));
  assert.ok(Math.abs(rightState.monoWeight + rightState.polyWeight - 1) < 1e-9);
});

test("ThresholdCalibrator: silenceEnergy tracks toward the noise floor", () => {
  const cal = new ThresholdCalibrator();
  const start = cal.getThresholds().silenceEnergy; // 0.01 by default
  const floor = 0.05;
  for (let i = 0; i < 50; i++) {
    cal.observe({ playing: false, frameEnergy: floor });
  }
  const t = cal.getThresholds();
  assert.ok(t.silenceEnergy > start, "silenceEnergy should rise toward the floor");
  assert.ok(t.silenceEnergy <= floor + 1e-9, "and not overshoot the floor");
  assert.ok(Math.abs(t.silenceEnergy - floor) < 0.005, "and get close to it");
});
