/**
 * A tiny text notation for authoring beginner pieces, plus compilers to the
 * canonical `Score` and to MusicXML.
 *
 * Grammar (whitespace separated, `|` closes a bar):
 *
 *     C4            quarter note (default duration = 1 beat)
 *     F#4:0.5        eighth note; duration is in quarter-note beats
 *     Bb3:1.5        dotted quarter
 *     E5:1/3         triplet eighth (fractions keep tuplets exact)
 *     C4/1           with a finger number (1 = thumb … 5 = little finger)
 *     r:2            rest of 2 beats (rests only advance the clock)
 *     C3+E3+G3:2     chord — notes sharing one onset
 *     |              bar line (validated against the time signature)
 *
 * Why a custom notation rather than MusicXML source: a song becomes a readable
 * ~10-line diff, and bar lines give us a free correctness check — every bar must
 * add up to the time signature, so a typo in a duration fails the test suite
 * instead of silently desynchronising the follower.
 */
import type { Hand, NoteEvent, Score, TimeSignature } from "@arpeggio/musicxml-parser";

import type { Song } from "./types.js";

/** Semitone offset of each note letter within its octave. */
const LETTER_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Diatonic index of each letter within its octave (C = 0 … B = 6). */
const LETTER_STEP: Record<string, number> = { C: 0, D: 1, E: 2, F: 3, G: 4, A: 5, B: 6 };

const PITCH_RE = /^([A-G])(#|b)?(-?\d)$/;

/** Parse a pitch token such as `C4`, `F#4` or `Bb3` into a MIDI number. */
export function pitchToMidi(token: string): number {
  const m = PITCH_RE.exec(token);
  if (!m) throw new Error(`bad pitch token: "${token}"`);
  const [, letter, accidental, octave] = m;
  const alter = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  // MIDI convention: C4 = 60, i.e. octave 4 starts at 60.
  return (Number(octave) + 1) * 12 + LETTER_SEMITONE[letter] + alter;
}

/** Spell a MIDI number back to `{ step, alter, octave }` for a key signature. */
export function midiToSpelling(
  midi: number,
  sharps: number,
): { step: string; alter: -1 | 0 | 1; octave: number } {
  const pc = ((midi % 12) + 12) % 12;
  // Prefer sharps in sharp keys and in C major (where accidentals are chromatic
  // passing tones — Für Elise's D# reads far better than E♭).
  const useFlats = sharps < 0;
  const sharpNames: Array<[string, -1 | 0 | 1]> = [
    ["C", 0], ["C", 1], ["D", 0], ["D", 1], ["E", 0], ["F", 0],
    ["F", 1], ["G", 0], ["G", 1], ["A", 0], ["A", 1], ["B", 0],
  ];
  const flatNames: Array<[string, -1 | 0 | 1]> = [
    ["C", 0], ["D", -1], ["D", 0], ["E", -1], ["E", 0], ["F", 0],
    ["G", -1], ["G", 0], ["A", -1], ["A", 0], ["B", -1], ["B", 0],
  ];
  const [step, alter] = (useFlats ? flatNames : sharpNames)[pc];
  // The octave number belongs to the *natural* letter: B#3 would be octave 3
  // even though it sounds as C4. Our library never spells such notes, so the
  // straightforward computation is enough.
  const octave = Math.floor(midi / 12) - 1;
  return { step, alter, octave };
}

/**
 * Absolute diatonic step index (C-1 = 0, rising by one per letter). This is the
 * vertical position of a note on the staff, independent of accidentals.
 */
export function diatonicIndex(midi: number, sharps: number): number {
  const { step, octave } = midiToSpelling(midi, sharps);
  return octave * 7 + LETTER_STEP[step];
}

/**
 * Read a duration token. Fractions (`1/3`) are accepted so tuplets stay exact:
 * writing a triplet eighth as `0.333` would drift a bar out of tolerance, while
 * `1/3` divides at full double precision and three of them still sum to 1.
 */
function parseDuration(token: string | undefined): number {
  if (token === undefined) return 1;
  const slash = token.indexOf("/");
  if (slash < 0) return Number(token);
  return Number(token.slice(0, slash)) / Number(token.slice(slash + 1));
}

export interface VoiceOptions {
  hand: Hand;
  /** MusicXML staff number (1 = treble/right, 2 = bass/left). */
  staff: number;
  voice: number;
  /** Beats (quarter notes) per full bar. */
  beatsPerBar: number;
  /** Beats in the incomplete opening bar; 0 when the piece starts on a downbeat. */
  pickupBeats?: number;
}

/** Onsets closer than this (in beats) are the same moment in the music. */
const SIMULTANEOUS_EPSILON = 1e-6;

export interface ParsedVoice {
  events: NoteEvent[];
  /** Total length in quarter-note beats, rests included. */
  totalBeats: number;
  /** Number of written bars (the pickup counts as bar 1). */
  bars: number;
}

/**
 * Compile one voice line into `NoteEvent`s on the shared beat timeline.
 *
 * Throws when a bar does not add up to the time signature — that check is the
 * whole point of requiring bar lines in the source.
 */
export function parseVoice(source: string, opts: VoiceOptions): ParsedVoice {
  const { hand, staff, voice, beatsPerBar } = opts;
  const pickup = opts.pickupBeats ?? 0;

  const events: NoteEvent[] = [];
  let cursor = 0;
  let barIndex = 0; // 0-based; measure number is barIndex + 1
  let barStart = 0;
  let expectedBarLength = pickup > 0 ? pickup : beatsPerBar;

  const closeBar = (): void => {
    const played = cursor - barStart;
    if (Math.abs(played - expectedBarLength) > 1e-6) {
      throw new Error(
        `bar ${barIndex + 1} has ${played} beats, expected ${expectedBarLength}`,
      );
    }
    barIndex++;
    barStart = cursor;
    expectedBarLength = beatsPerBar;
  };

  for (const token of source.trim().split(/\s+/).filter(Boolean)) {
    if (token === "|") {
      closeBar();
      continue;
    }
    const [pitchPart, durPart] = token.split(":");
    const duration = parseDuration(durPart);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`bad duration in token "${token}"`);
    }
    if (pitchPart !== "r") {
      for (const p of pitchPart.split("+")) {
        // A trailing "/n" is the finger, not part of the pitch: C4/1.
        const slash = p.indexOf("/");
        const pitch = slash < 0 ? p : p.slice(0, slash);
        const finger = slash < 0 ? undefined : Number(p.slice(slash + 1));
        if (finger !== undefined && !(finger >= 1 && finger <= 5)) {
          throw new Error(`finger must be 1–5 in token "${token}"`);
        }
        events.push({
          onset: cursor,
          offset: cursor + duration,
          pitchMidi: pitchToMidi(pitch),
          voice,
          staff,
          hand,
          measure: barIndex + 1,
          position: cursor - barStart,
          ...(finger !== undefined ? { finger } : {}),
        });
      }
    }
    cursor += duration;
  }
  // A trailing bar line is optional; close the final bar either way.
  if (cursor > barStart) closeBar();

  return { events, totalBeats: cursor, bars: barIndex };
}

/**
 * Compile a `Song` into the canonical `Score`.
 *
 * @param hands Which voices to include. Filtering here (rather than downstream)
 *   keeps the follower's expected-note indices aligned with what is drawn.
 */
export function songToScore(song: Song, hands: "right" | "left" | "both" = "both"): Score {
  const beatsPerBar = (song.beats * 4) / song.beatType;
  const voices: NoteEvent[] = [];

  if (hands !== "left") {
    voices.push(
      ...parseVoice(song.right, {
        hand: "right",
        staff: 1,
        voice: 1,
        beatsPerBar,
        pickupBeats: song.pickupBeats,
      }).events,
    );
  }
  if (hands !== "right" && song.left) {
    voices.push(
      ...parseVoice(song.left, {
        hand: "left",
        staff: 2,
        voice: 2,
        beatsPerBar,
        pickupBeats: song.pickupBeats,
      }).events,
    );
  }
  // Compare onsets with a tolerance before falling back to pitch. Accumulating
  // triplets leaves a voice a few ulps off its bar line, and an exact comparison
  // would order a left-hand note that is simultaneous "after" a right-hand one
  // purely from that drift — making the note order depend on rounding noise.
  voices.sort((a, b) =>
    Math.abs(a.onset - b.onset) < SIMULTANEOUS_EPSILON
      ? a.pitchMidi - b.pitchMidi
      : a.onset - b.onset,
  );

  const timeSignatures: TimeSignature[] = [
    { measure: 1, beats: song.beats, beatType: song.beatType },
  ];
  return {
    events: voices,
    divisions: 1,
    timeSignatures,
    tempos: [{ onset: 0, bpm: song.bpm }],
    parts: ["Piano"],
    repeatsFlattened: true,
  };
}

/** Beats per bar in quarter-note units, e.g. 3 for 6/8 and 4 for 4/4. */
export function beatsPerBar(song: Song): number {
  return (song.beats * 4) / song.beatType;
}

// ---------------------------------------------------------------------------
// MusicXML export
// ---------------------------------------------------------------------------

/**
 * Ticks per quarter note used by the exporter.
 *
 * 24 rather than a power of two because the library contains triplets (the
 * Moonlight Sonata): a triplet eighth is a third of a beat, which 8 ticks per
 * quarter cannot express without rounding the piece out of time.
 */
const DIVISIONS = 24;

interface NoteValue {
  type: string;
  dots: number;
  /** Set for tuplets, e.g. 3 in the time of 2 for triplets. */
  tuplet?: { actual: number; normal: number };
}

/** Map a duration in beats to a MusicXML `<type>`, dots and tuplet ratio. */
function noteType(beats: number): NoteValue {
  const table: Array<[number, string]> = [
    [4, "whole"], [2, "half"], [1, "quarter"], [0.5, "eighth"], [0.25, "16th"],
  ];
  for (const [value, type] of table) {
    if (Math.abs(beats - value) < 1e-6) return { type, dots: 0 };
    if (Math.abs(beats - value * 1.5) < 1e-6) return { type, dots: 1 };
  }
  // Triplets: three in the time of two, so each note is 2/3 of its written value.
  for (const [value, type] of table) {
    if (Math.abs(beats - (value * 2) / 3) < 1e-6) {
      return { type, dots: 0, tuplet: { actual: 3, normal: 2 } };
    }
  }
  // Anything else would need a tie; still export a loadable note.
  return { type: "quarter", dots: 0 };
}

/** The `<type>`/`<dot>`/`<time-modification>` lines shared by notes and rests. */
function valueXml(beats: number): string[] {
  const { type, dots, tuplet } = noteType(beats);
  return [
    `        <type>${type}</type>`,
    ...Array.from({ length: dots }, () => "        <dot/>"),
    ...(tuplet
      ? [
          "        <time-modification>",
          `          <actual-notes>${tuplet.actual}</actual-notes>`,
          `          <normal-notes>${tuplet.normal}</normal-notes>`,
          "        </time-modification>",
        ]
      : []),
  ];
}

/**
 * Export a song as MusicXML so it can be opened in the desktop app, in
 * MuseScore, or shared. Round-tripping through @arpeggio/musicxml-parser is
 * covered by the test suite.
 */
export function songToMusicXML(song: Song): string {
  const perBar = beatsPerBar(song);
  const staves: Array<{ staff: number; events: NoteEvent[] }> = [
    {
      staff: 1,
      events: parseVoice(song.right, {
        hand: "right", staff: 1, voice: 1, beatsPerBar: perBar, pickupBeats: song.pickupBeats,
      }).events,
    },
  ];
  if (song.left) {
    staves.push({
      staff: 2,
      events: parseVoice(song.left, {
        hand: "left", staff: 2, voice: 2, beatsPerBar: perBar, pickupBeats: song.pickupBeats,
      }).events,
    });
  }

  const lastMeasure = Math.max(
    ...staves.flatMap((s) => s.events.map((e) => e.measure)),
    1,
  );

  const out: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">',
    '<score-partwise version="4.0">',
    "  <work><work-title>" + escapeXml(song.title) + "</work-title></work>",
    "  <identification><creator type=\"composer\">" + escapeXml(song.composer) + "</creator></identification>",
    '  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>',
    '  <part id="P1">',
  ];

  for (let m = 1; m <= lastMeasure; m++) {
    out.push(`    <measure number="${m}">`);
    if (m === 1) {
      out.push(
        "      <attributes>",
        `        <divisions>${DIVISIONS}</divisions>`,
        `        <key><fifths>${song.sharps}</fifths></key>`,
        `        <time><beats>${song.beats}</beats><beat-type>${song.beatType}</beat-type></time>`,
        `        <staves>${staves.length}</staves>`,
        '        <clef number="1"><sign>G</sign><line>2</line></clef>',
        ...(staves.length > 1 ? ['        <clef number="2"><sign>F</sign><line>4</line></clef>'] : []),
        "      </attributes>",
      );
    }
    // Bar 1 is short when the piece has an anacrusis; every other bar is full.
    const barLength = m === 1 && song.pickupBeats ? song.pickupBeats : perBar;
    staves.forEach((s, i) => {
      // Each staff is written for the whole bar (padded with rests), so the
      // rewind before the next staff is always exactly one bar.
      if (i > 0) {
        out.push(`      <backup><duration>${Math.round(barLength * DIVISIONS)}</duration></backup>`);
      }
      out.push(...measureXml(s.events, m, s.staff, i + 1, barLength));
    });
    out.push("    </measure>");
  }

  out.push("  </part>", "</score-partwise>", "");
  return out.join("\n");
}

/**
 * Serialize one staff's notes for one measure, with rests filling every gap —
 * including the tail. Padding the tail matters: a staff that stops early would
 * make the following measure's notes start too soon once the file is read back.
 */
function measureXml(
  events: NoteEvent[],
  m: number,
  staff: number,
  voice: number,
  barLength: number,
): string[] {
  const inBar = events
    .filter((e) => e.measure === m)
    .sort((a, b) => a.position - b.position || a.pitchMidi - b.pitchMidi);
  const lines: string[] = [];
  let cursor = 0;

  // Group by onset so chord tones share one `<chord/>`-linked run.
  const byPosition = new Map<number, NoteEvent[]>();
  for (const e of inBar) {
    const list = byPosition.get(e.position);
    if (list) list.push(e);
    else byPosition.set(e.position, [e]);
  }

  for (const [position, group] of [...byPosition.entries()].sort((a, b) => a[0] - b[0])) {
    if (position - cursor > 1e-6) {
      lines.push(...restXml(position - cursor, staff, voice));
      cursor = position;
    }
    const beats = group[0].offset - group[0].onset;
    group.forEach((e, i) => {
      lines.push(...pitchedXml(e, beats, staff, voice, i > 0));
    });
    cursor = position + beats;
  }
  if (barLength - cursor > 1e-6) lines.push(...restXml(barLength - cursor, staff, voice));
  return lines;
}

function restXml(beats: number, staff: number, voice: number): string[] {
  return [
    "      <note>",
    "        <rest/>",
    `        <duration>${Math.round(beats * DIVISIONS)}</duration>`,
    `        <voice>${voice}</voice>`,
    ...valueXml(beats),
    `        <staff>${staff}</staff>`,
    "      </note>",
  ];
}

function pitchedXml(
  e: NoteEvent,
  beats: number,
  staff: number,
  voice: number,
  isChordTone: boolean,
): string[] {
  // Spelling for export always uses sharps; our sharp-key library never needs
  // flats, and the parser reads either back to the same MIDI number anyway.
  const { step, alter, octave } = midiToSpelling(e.pitchMidi, 0);
  return [
    "      <note>",
    ...(isChordTone ? ["        <chord/>"] : []),
    "        <pitch>",
    `          <step>${step}</step>`,
    ...(alter !== 0 ? [`          <alter>${alter}</alter>`] : []),
    `          <octave>${octave}</octave>`,
    "        </pitch>",
    `        <duration>${Math.round(beats * DIVISIONS)}</duration>`,
    `        <voice>${voice}</voice>`,
    ...valueXml(beats),
    `        <staff>${staff}</staff>`,
    "      </note>",
  ];
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
