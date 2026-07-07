/**
 * MusicXML -> Arpeggio internal model.
 *
 * Supports `score-partwise` MusicXML (the common export format). The parser
 * walks each measure in document order so that `<backup>`, `<forward>` and
 * `<chord>` are handled correctly, computes each note's onset in quarter-note
 * beats, expands repeats/voltas into a linear timeline, and merges tied notes.
 *
 * Known limitations (acceptable for the OMR demo, documented in the README):
 *  - `score-timewise` is not supported (rare; MuseScore/IMSLP export partwise).
 *  - Grace notes are skipped (they carry no `<duration>`).
 *  - Da capo / dal segno jumps are not expanded (only forward/backward repeats
 *    and first/second endings).
 */
import { XMLParser } from "fast-xml-parser";

import type { NoteEvent, Score, TempoMark, TimeSignature } from "./model.js";
import { computePlayOrder, type MeasureRepeatInfo } from "./repeats.js";

// --- preserveOrder tree helpers --------------------------------------------
// With preserveOrder, each node is an object with exactly one tag key whose
// value is an array of child nodes, plus an optional ":@" attributes object.
type PNode = Record<string, any>;

function nameOf(n: PNode): string {
  for (const k of Object.keys(n)) {
    if (k !== ":@" && k !== "#text") return k;
  }
  return "";
}

function kids(n: PNode): PNode[] {
  const nm = nameOf(n);
  const v = n[nm];
  return Array.isArray(v) ? v : [];
}

function attr(n: PNode, a: string): string | undefined {
  const at = n[":@"];
  return at ? at[`@_${a}`] : undefined;
}

function textOf(n: PNode): string | undefined {
  for (const c of kids(n)) {
    if ("#text" in c) return String(c["#text"]);
  }
  return undefined;
}

function findChild(parent: PNode, tag: string): PNode | undefined {
  return kids(parent).find((c) => nameOf(c) === tag);
}

function findChildren(parent: PNode, tag: string): PNode[] {
  return kids(parent).filter((c) => nameOf(c) === tag);
}

function childText(parent: PNode, tag: string): string | undefined {
  const c = findChild(parent, tag);
  return c ? textOf(c) : undefined;
}

function childInt(parent: PNode, tag: string): number | undefined {
  const t = childText(parent, tag);
  if (t === undefined) return undefined;
  const n = parseInt(t, 10);
  return Number.isNaN(n) ? undefined : n;
}

// --- pitch ------------------------------------------------------------------
const STEP_SEMITONE: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

function pitchToMidi(step: string, octave: number, alter: number): number {
  return 12 * (octave + 1) + (STEP_SEMITONE[step] ?? 0) + alter;
}

// --- raw per-measure structures --------------------------------------------
interface RawNote {
  /** Onset within the measure, in divisions. */
  localDiv: number;
  /** Duration in divisions. */
  durDiv: number;
  /** Divisions-per-quarter active for this note. */
  divisions: number;
  pitchMidi: number | null; // null for rests
  voice: number;
  staff: number;
  tieStart: boolean;
  tieStop: boolean;
}

interface RawMeasure {
  number: number;
  notes: RawNote[];
  /** Furthest cursor position reached, in divisions (= measure duration). */
  maxDiv: number;
  /** Divisions-per-quarter active in this measure. */
  divisions: number;
  time: TimeSignature | null;
  tempo: number | null;
  repeat: MeasureRepeatInfo;
}

/** Walk one `<measure>` and extract its notes, timing and barline info. */
function parseMeasure(
  measureNode: PNode,
  measureNumber: number,
  divisionsIn: number,
): RawMeasure {
  let divisions = divisionsIn;
  let cursor = 0;
  let maxDiv = 0;
  let lastOnset = 0; // onset of the previous non-chord note (for chords)
  const notes: RawNote[] = [];
  let time: TimeSignature | null = null;
  let tempo: number | null = null;

  const repeat: MeasureRepeatInfo = {
    forwardRepeat: false,
    backwardRepeat: false,
    repeatTimes: 2,
    endingStart: null,
  };

  const readSound = (node: PNode) => {
    const t = attr(node, "tempo");
    if (t !== undefined) tempo = parseFloat(t);
  };

  for (const child of kids(measureNode)) {
    const name = nameOf(child);
    switch (name) {
      case "attributes": {
        const d = childInt(child, "divisions");
        if (d !== undefined && d > 0) divisions = d;
        const timeNode = findChild(child, "time");
        if (timeNode) {
          const beats = childInt(timeNode, "beats");
          const beatType = childInt(timeNode, "beat-type");
          if (beats && beatType) time = { measure: measureNumber, beats, beatType };
        }
        break;
      }
      case "note": {
        // Grace notes carry no duration; skip them for the timeline.
        if (findChild(child, "grace")) break;
        const durDiv = childInt(child, "duration") ?? 0;
        const isChord = findChild(child, "chord") !== undefined;
        const isRest = findChild(child, "rest") !== undefined;
        const voice = childInt(child, "voice") ?? 1;
        const staff = childInt(child, "staff") ?? 1;

        let pitchMidi: number | null = null;
        const pitchNode = findChild(child, "pitch");
        if (pitchNode && !isRest) {
          const step = childText(pitchNode, "step") ?? "C";
          const octave = childInt(pitchNode, "octave") ?? 4;
          const alter = childInt(pitchNode, "alter") ?? 0;
          pitchMidi = pitchToMidi(step, octave, alter);
        }

        const ties = findChildren(child, "tie").map((t) => attr(t, "type"));
        const tieStart = ties.includes("start");
        const tieStop = ties.includes("stop");

        const onset = isChord ? lastOnset : cursor;
        if (!isChord) lastOnset = cursor;

        notes.push({
          localDiv: onset,
          durDiv,
          divisions,
          pitchMidi,
          voice,
          staff,
          tieStart,
          tieStop,
        });

        if (!isChord) {
          cursor += durDiv;
          if (cursor > maxDiv) maxDiv = cursor;
        }
        break;
      }
      case "backup": {
        cursor -= childInt(child, "duration") ?? 0;
        if (cursor < 0) cursor = 0;
        break;
      }
      case "forward": {
        cursor += childInt(child, "duration") ?? 0;
        if (cursor > maxDiv) maxDiv = cursor;
        break;
      }
      case "direction": {
        const sound = findChild(child, "sound");
        if (sound) readSound(sound);
        break;
      }
      case "sound": {
        readSound(child);
        break;
      }
      case "barline": {
        const rep = findChild(child, "repeat");
        if (rep) {
          const dir = attr(rep, "direction");
          if (dir === "forward") repeat.forwardRepeat = true;
          if (dir === "backward") {
            repeat.backwardRepeat = true;
            const times = attr(rep, "times");
            if (times) repeat.repeatTimes = Math.max(2, parseInt(times, 10) || 2);
          }
        }
        const ending = findChild(child, "ending");
        if (ending && attr(ending, "type") === "start") {
          const num = attr(ending, "number") ?? "";
          const parsed = num
            .split(/[,\s]+/)
            .map((s) => parseInt(s, 10))
            .filter((n) => !Number.isNaN(n));
          if (parsed.length) repeat.endingStart = parsed;
        }
        break;
      }
      default:
        break;
    }
  }

  return { number: measureNumber, notes, maxDiv, divisions, time, tempo, repeat };
}

/** A part = an ordered list of parsed measures. */
interface RawPart {
  id: string;
  measures: RawMeasure[];
}

function parsePart(partNode: PNode): RawPart {
  const id = attr(partNode, "id") ?? "P?";
  const measures: RawMeasure[] = [];
  let divisions = 1;
  let idx = 0;
  for (const m of findChildren(partNode, "measure")) {
    idx += 1;
    const numAttr = attr(m, "number");
    const number = numAttr !== undefined ? parseInt(numAttr, 10) || idx : idx;
    const parsed = parseMeasure(m, number, divisions);
    divisions = parsed.divisions; // carry forward across measures
    measures.push(parsed);
  }
  return { id, measures };
}

/**
 * Parse a MusicXML string into the canonical {@link Score} model, with repeats
 * expanded to a linear timeline and tied notes merged.
 */
export function parseMusicXML(xml: string): Score {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    preserveOrder: true,
    trimValues: true,
  });
  const tree: PNode[] = parser.parse(xml);

  // Locate <score-partwise> at the document root.
  const root = tree.find((n) => nameOf(n) === "score-partwise");
  if (!root) {
    if (tree.find((n) => nameOf(n) === "score-timewise")) {
      throw new Error("score-timewise MusicXML is not supported; convert to partwise.");
    }
    throw new Error("No <score-partwise> element found; not a MusicXML document.");
  }

  const parts = findChildren(root, "part").map(parsePart);
  if (parts.length === 0) throw new Error("MusicXML has no <part> elements.");

  // Repeat structure is taken from the part with the most measures (usually all
  // parts agree, but OMR output can be ragged).
  const primary = parts.reduce((a, b) => (b.measures.length > a.measures.length ? b : a));
  const nMeasures = primary.measures.length;
  const playOrder = computePlayOrder(primary.measures.map((m) => m.repeat));

  // Measure duration in quarter-note beats, aligned across parts (take the max).
  const measureQuarters: number[] = [];
  for (let i = 0; i < nMeasures; i++) {
    let q = 0;
    for (const p of parts) {
      const m = p.measures[i];
      if (m && m.divisions > 0) q = Math.max(q, m.maxDiv / m.divisions);
    }
    measureQuarters[i] = q;
  }

  const events: NoteEvent[] = [];
  const timeSignatures: TimeSignature[] = [];
  const tempos: TempoMark[] = [];
  const seenTimeSig = new Set<number>();

  // Open tie tracker: key `pitch|voice|staff` -> index into `events`.
  const openTies = new Map<string, number>();

  let globalQ = 0;
  for (const mi of playOrder) {
    const measureStartQ = globalQ;

    for (const part of parts) {
      const m = part.measures[mi];
      if (!m) continue;

      // Time signature / tempo: emit once, on the measure's first performance.
      if (m.time && !seenTimeSig.has(mi)) {
        timeSignatures.push(m.time);
        seenTimeSig.add(mi);
      }
      if (m.tempo != null) tempos.push({ onset: measureStartQ, bpm: m.tempo });

      for (const note of m.notes) {
        if (note.pitchMidi == null) continue; // rest
        const onset = measureStartQ + note.localDiv / note.divisions;
        const offset = onset + note.durDiv / note.divisions;
        const key = `${note.pitchMidi}|${note.voice}|${note.staff}`;

        if (note.tieStop && openTies.has(key)) {
          // Continuation of a tied note: extend the existing event.
          const idx = openTies.get(key)!;
          events[idx].offset = offset;
          events[idx].tied = true;
          if (!note.tieStart) openTies.delete(key);
          continue;
        }

        const ev: NoteEvent = {
          onset,
          offset,
          pitchMidi: note.pitchMidi,
          voice: note.voice,
          staff: note.staff,
          hand: note.staff <= 1 ? "right" : "left",
          measure: m.number,
          position: onset - measureStartQ,
          tied: note.tieStart || undefined,
        };
        events.push(ev);
        if (note.tieStart) openTies.set(key, events.length - 1);
      }
    }

    globalQ = measureStartQ + (measureQuarters[mi] || 0);
  }

  events.sort((a, b) => a.onset - b.onset || a.pitchMidi - b.pitchMidi);

  return {
    events,
    divisions: primary.measures[0]?.divisions ?? 1,
    timeSignatures,
    tempos,
    parts: parts.map((p) => p.id),
    repeatsFlattened: playOrder.length !== nMeasures,
  };
}
