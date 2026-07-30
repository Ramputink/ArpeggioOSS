/**
 * Guards for the built-in repertoire.
 *
 * The bar-length check inside `parseVoice` is the real workhorse: a mistyped
 * duration desynchronises the follower silently at runtime, so we force it to
 * be a red test instead. The rest pins the curation promises (level 1 stays in
 * the five-finger position, hands line up, MusicXML round-trips).
 */
import { strict as assert } from "node:assert";
import test from "node:test";

import { parseMusicXML } from "@arpeggio/musicxml-parser";

import {
  EXERCISES,
  EXERCISE_SPECS,
  LEVEL_GOALS,
  LEVEL_NAMES,
  SONGS,
  beatsPerBar,
  diatonicIndex,
  exerciseById,
  parseVoice,
  pitchToMidi,
  songById,
  songToMusicXML,
  songToScore,
} from "../src/index.js";
import type { HandChoice } from "../src/index.js";

const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

test("pitchToMidi handles naturals, sharps and flats", () => {
  assert.equal(pitchToMidi("C4"), 60);
  assert.equal(pitchToMidi("A4"), 69);
  assert.equal(pitchToMidi("F#4"), 66);
  assert.equal(pitchToMidi("Bb3"), 58);
  assert.equal(pitchToMidi("C-1"), 0);
  assert.throws(() => pitchToMidi("H4"));
});

test("diatonicIndex puts enharmonics on the right staff line", () => {
  // D#4 and E4 are different lines; D#4 sits on D's line.
  assert.equal(diatonicIndex(63, 0), diatonicIndex(62, 0));
  assert.equal(diatonicIndex(64, 0), diatonicIndex(62, 0) + 1);
});

test("parseVoice rejects a bar that does not fill the time signature", () => {
  assert.throws(
    () =>
      parseVoice("C4 C4 C4 | C4 C4 C4 C4", { hand: "right", staff: 1, voice: 1, beatsPerBar: 4 }),
    /bar 1 has 3 beats, expected 4/,
  );
});

test("parseVoice honours a pickup bar and keeps measure numbers", () => {
  const v = parseVoice("G4 | C4 C4 C4 C4 |", {
    hand: "right",
    staff: 1,
    voice: 1,
    beatsPerBar: 4,
    pickupBeats: 1,
  });
  assert.equal(v.bars, 2);
  assert.equal(v.events[0].measure, 1);
  assert.equal(v.events[1].measure, 2);
  assert.equal(v.events[1].position, 0);
  assert.equal(v.totalBeats, 5);
});

test("parseVoice expands chords onto one onset", () => {
  const v = parseVoice("C3+E3+G3:4 |", { hand: "left", staff: 2, voice: 2, beatsPerBar: 4 });
  assert.equal(v.events.length, 3);
  assert.deepEqual(
    v.events.map((e) => e.onset),
    [0, 0, 0],
  );
  assert.deepEqual(
    v.events.map((e) => e.pitchMidi),
    [48, 52, 55],
  );
});

test("the library is a well-formed, progressive curriculum", () => {
  assert.ok(SONGS.length >= 10, "the starter library must stay substantial");
  assert.equal(new Set(SONGS.map((s) => s.id)).size, SONGS.length, "duplicate song id");
  // Songs are listed in teaching order, so levels must never go backwards.
  for (let i = 1; i < SONGS.length; i++) {
    assert.ok(SONGS[i].level >= SONGS[i - 1].level, `${SONGS[i].id} is out of order`);
  }
  // Every tier that has a name must have at least one piece in it.
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    assert.ok(
      SONGS.some((s) => s.level === level),
      `level ${level} is empty`,
    );
    assert.ok(LEVEL_GOALS[level].length > 20, `level ${level} has no stated goal`);
  }
  for (const song of SONGS) {
    assert.ok(LEVEL_NAMES[song.level], `${song.id}: unknown level`);
    assert.ok(song.tip.length > 20, `${song.id}: tip too short to help`);
    assert.ok(song.bpm >= 40 && song.bpm <= 160, `${song.id}: implausible bpm`);
    assert.equal(songById(song.id), song);
  }
});

test("every song compiles to a score with sane, ordered events", () => {
  for (const song of SONGS) {
    const score = songToScore(song);
    assert.ok(score.events.length > 10, `${song.id}: suspiciously short`);
    for (let i = 1; i < score.events.length; i++) {
      // Simultaneous notes are ordered by pitch, and "simultaneous" is a
      // tolerance — a voice full of triplets lands a few ulps off its bar line.
      assert.ok(
        score.events[i].onset >= score.events[i - 1].onset - 1e-6,
        `${song.id}: unordered at ${i}`,
      );
    }
    for (const e of score.events) {
      assert.ok(e.pitchMidi >= 21 && e.pitchMidi <= 108, `${song.id}: pitch off the keyboard`);
      assert.ok(e.offset > e.onset, `${song.id}: zero-length note`);
    }
    assert.equal(score.timeSignatures[0].beats, song.beats);
    assert.equal(score.tempos[0].bpm, song.bpm);
  }
});

test("hand filtering yields exactly the requested voices", () => {
  const song = songById("twinkle")!;
  const right = songToScore(song, "right");
  const left = songToScore(song, "left");
  const both = songToScore(song, "both");
  assert.ok(right.events.every((e) => e.hand === "right"));
  assert.ok(left.events.every((e) => e.hand === "left"));
  assert.equal(both.events.length, right.events.length + left.events.length);
});

test("level 1 songs stay on white keys within reach of one hand position", () => {
  for (const song of SONGS.filter((s) => s.level === 1)) {
    const right = songToScore(song, "right").events;
    for (const e of right) {
      assert.ok(!BLACK_KEYS.has(e.pitchMidi % 12), `${song.id}: black key in a level 1 melody`);
    }
    const lo = Math.min(...right.map((e) => e.pitchMidi));
    const hi = Math.max(...right.map((e) => e.pitchMidi));
    assert.ok(hi - lo <= 12, `${song.id}: level 1 melody spans more than an octave`);
  }
});

test("both hands of a song cover the same span of bars", () => {
  for (const song of SONGS.filter((s) => s.left)) {
    const perBar = beatsPerBar(song);
    const r = parseVoice(song.right, {
      hand: "right",
      staff: 1,
      voice: 1,
      beatsPerBar: perBar,
      pickupBeats: song.pickupBeats,
    });
    const l = parseVoice(song.left!, {
      hand: "left",
      staff: 2,
      voice: 2,
      beatsPerBar: perBar,
      pickupBeats: song.pickupBeats,
    });
    assert.equal(r.bars, l.bars, `${song.id}: hands have a different number of bars`);
    // Tolerance, not equality: a bar of triplets sums to 4 only to within
    // double-precision rounding, and that is fine — it is far below a tick.
    assert.ok(
      Math.abs(r.totalBeats - l.totalBeats) < 1e-6,
      `${song.id}: hands have a different length (${r.totalBeats} vs ${l.totalBeats})`,
    );
  }
});

test("songs round-trip through MusicXML with identical pitches and onsets", () => {
  for (const song of SONGS) {
    const direct = songToScore(song);
    const viaXml = parseMusicXML(songToMusicXML(song));
    assert.deepEqual(
      viaXml.events.map((e) => [e.pitchMidi, round(e.onset), round(e.offset)]),
      direct.events.map((e) => [e.pitchMidi, round(e.onset), round(e.offset)]),
      `${song.id}: MusicXML export does not match the compiled score`,
    );
  }
});

// ---------------------------------------------------------------------------
// Fingering and hand positions
// ---------------------------------------------------------------------------

test("every note of every piece carries a finger", () => {
  // Fingering is the difference between "play a G" and an instruction a hand
  // can follow. A piece that loses its digits in an edit fails here rather than
  // teaching someone a fingering they will have to unlearn.
  for (const song of [...SONGS, ...EXERCISES]) {
    for (const e of songToScore(song).events) {
      assert.ok(
        e.finger !== undefined && e.finger >= 1 && e.finger <= 5,
        `${song.id}: note ${e.pitchMidi} at beat ${e.onset} has no usable finger`,
      );
    }
  }
});

test("a declared start position is a note the hand really plays, and its opening bar fits the hand", () => {
  for (const song of [...SONGS, ...EXERCISES]) {
    for (const hand of ["right", "left"] as const) {
      const anchor = song.startPosition?.[hand];
      if (anchor === undefined) continue;
      const events = songToScore(song, hand).events;
      assert.ok(events.length > 0, `${song.id}: ${hand} position declared but the hand is silent`);
      assert.ok(
        events.some((e) => e.pitchMidi === anchor),
        `${song.id}: ${hand} position ${anchor} is never played`,
      );
      // The opening bar must sit under the hand from that anchor: an octave is
      // the widest a hand covers, and anything below the anchor means the hand
      // was placed too high to reach its own first phrase.
      const firstBar = events.filter((e) => e.measure === events[0].measure);
      for (const e of firstBar) {
        assert.ok(
          e.pitchMidi >= anchor && e.pitchMidi <= anchor + 12,
          `${song.id}: ${hand} starts at ${anchor} but bar ${e.measure} needs ${e.pitchMidi}`,
        );
      }
    }
  }
});

// ---------------------------------------------------------------------------
// Generated exercises
// ---------------------------------------------------------------------------

test("generated exercises are playable songs, and are not repertoire", () => {
  assert.equal(EXERCISES.length, EXERCISE_SPECS.length);
  const songIds = new Set(SONGS.map((s) => s.id));
  for (const ex of EXERCISES) {
    assert.ok(!songIds.has(ex.id), `${ex.id}: an exercise must not shadow a piece`);
    assert.equal(exerciseById(ex.id), ex);
    assert.ok(ex.tip.length > 20, `${ex.id}: tip too short to help`);
    // Compiling is the real check: `parseVoice` validates every bar against the
    // time signature, so a generator that emits a wrong duration throws here.
    const score = songToScore(ex);
    assert.ok(score.events.length >= 8, `${ex.id}: suspiciously short`);
    for (const e of score.events) {
      assert.ok(e.pitchMidi >= 21 && e.pitchMidi <= 108, `${ex.id}: pitch off the keyboard`);
    }
  }
});

test("a five-finger exercise really does stay under five fingers", () => {
  for (const spec of EXERCISE_SPECS.filter((s) => s.kind === "five-finger")) {
    const ex = exerciseById(spec.id)!;
    for (const hand of ["right", "left"] as HandChoice[]) {
      const midis = songToScore(ex, hand).events.map((e) => e.pitchMidi);
      // A five-finger position spans a perfect fifth: seven semitones, no more.
      assert.equal(
        Math.max(...midis) - Math.min(...midis),
        7,
        `${spec.id}: ${hand} is not a fifth`,
      );
      assert.equal(new Set(midis).size, 5, `${spec.id}: ${hand} uses more than five keys`);
    }
  }
});

test("exercises are spelled for their key", () => {
  // A flat key must not print sharps: FA mayor contains SI♭, never LA♯.
  const fMajor = exerciseById("ex-five-f")!;
  assert.ok(fMajor.right.includes("Bb"), "F major five-finger must spell B flat");
  assert.ok(!fMajor.right.includes("A#"), "F major must not spell A sharp");
  const dMajor = exerciseById("ex-five-d")!;
  assert.ok(dMajor.right.includes("F#"), "D major five-finger must spell F sharp");
});

test("the exercise catalogue covers each kind of technique", () => {
  const kinds = new Set(EXERCISE_SPECS.map((s) => s.kind));
  for (const kind of ["five-finger", "contrary", "broken-chord", "scale"] as const) {
    assert.ok(kinds.has(kind), `no ${kind} exercise is offered`);
  }
});

// ---------------------------------------------------------------------------
// Key signatures
// ---------------------------------------------------------------------------

test("a song's key signature survives the trip through MusicXML", () => {
  for (const song of SONGS) {
    assert.deepEqual(
      songToScore(song).keySignatures,
      [{ measure: 1, fifths: song.sharps }],
      `${song.id}: compiled score lost its key`,
    );
    assert.equal(
      parseMusicXML(songToMusicXML(song)).keySignatures[0]?.fifths,
      song.sharps,
      `${song.id}: MusicXML export lost its key`,
    );
  }
});

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
