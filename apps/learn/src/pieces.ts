/**
 * A `Piece` is anything the practice screen can play.
 *
 * Two very different sources have to behave identically: the built-in library
 * (authored in the compact notation, with a level, a tip and a curated tempo) and
 * a MusicXML file the learner imported — which is the honest path to real Chopin,
 * since a verified public-domain edition beats notes transcribed from memory.
 *
 * The practice screen therefore never sees a `Song`; it sees this, and asks for a
 * `Score` for whichever hand is being practised.
 */
import { parseMusicXML, type Score } from "@arpeggio/musicxml-parser";
import {
  beatsPerBar as songBeatsPerBar,
  songToScore,
  type HandChoice,
  type Level,
  type Song,
} from "@arpeggio/song-library";

export interface Piece {
  id: string;
  title: string;
  composer: string;
  /** Curriculum tier, or null for something the learner brought themselves. */
  level: Level | null;
  bpm: number;
  beats: number;
  beatType: number;
  sharps: number;
  pickupBeats: number;
  tip: string;
  hasLeft: boolean;
  imported: boolean;
  /** Bars in the piece, for the setup sheet. */
  bars: number;
  /** The score for one hand (or both), built on demand. */
  score(hand: HandChoice): Score;
}

export function pieceFromSong(song: Song): Piece {
  const perBar = songBeatsPerBar(song);
  const full = songToScore(song, "both");
  return {
    id: song.id,
    title: song.title,
    composer: song.composer,
    level: song.level,
    bpm: song.bpm,
    beats: song.beats,
    beatType: song.beatType,
    sharps: song.sharps,
    pickupBeats: song.pickupBeats ?? 0,
    tip: song.tip,
    hasLeft: Boolean(song.left),
    imported: false,
    bars: Math.max(1, Math.ceil((lastBeat(full) - (song.pickupBeats ?? 0)) / perBar)),
    score: (hand) => songToScore(song, hand),
  };
}

/** A piece imported from MusicXML. Throws when the file cannot be parsed. */
export function pieceFromMusicXML(id: string, name: string, xml: string): Piece {
  const score = parseMusicXML(xml);
  if (score.events.length === 0) throw new Error("La partitura no tiene notas");

  const time = score.timeSignatures[0] ?? { beats: 4, beatType: 4, measure: 1 };
  const perBar = (time.beats * 4) / time.beatType;
  const hasLeft = score.events.some((e) => e.staff === 2 || e.hand === "left");

  return {
    id,
    title: name,
    composer: score.parts[0] ?? "Partitura importada",
    level: null,
    // MusicXML tempo marks are optional; 90 is a workable default for reading.
    bpm: Math.round(score.tempos[0]?.bpm ?? 90),
    beats: time.beats,
    beatType: time.beatType,
    // The canonical model carries no key signature, so accidentals print
    // explicitly on every note. Musically correct, just busier than an engraved
    // edition — and better than guessing a key and spelling notes wrongly.
    sharps: 0,
    pickupBeats: detectPickup(score, perBar),
    tip: "Partitura importada por ti. Empieza despacio y con una sola mano.",
    hasLeft,
    imported: true,
    bars: Math.max(...score.events.map((e) => e.measure)),
    score: (hand) =>
      hand === "both"
        ? score
        : { ...score, events: score.events.filter((e) => handOf(e.staff, e.hand) === hand) },
  };
}

function handOf(staff: number, hand: string): HandChoice {
  if (hand === "left" || hand === "right") return hand;
  return staff >= 2 ? "left" : "right";
}

function lastBeat(score: Score): number {
  return score.events.reduce((max, e) => Math.max(max, e.offset), 0);
}

/**
 * Beats in an incomplete opening bar, inferred from the content of measure 1.
 *
 * MusicXML marks an anacrusis with `<measure implicit="yes">`, which the parser
 * does not retain, so it is recovered here: if the first bar holds less than a
 * full bar of music, the difference is the pickup. Getting this wrong only shifts
 * where bar lines are drawn, never the notes themselves.
 */
function detectPickup(score: Score, perBar: number): number {
  const first = score.events.filter((e) => e.measure === 1);
  if (first.length === 0) return 0;
  const filled = Math.max(...first.map((e) => e.position + (e.offset - e.onset)));
  return filled < perBar - 1e-6 ? Math.round(filled * 1000) / 1000 : 0;
}

// ---------------------------------------------------------------------------
// Storage for imported scores
// ---------------------------------------------------------------------------

const IMPORTED_KEY = "arpeggio.imported.v1";

export interface ImportedRecord {
  id: string;
  name: string;
  xml: string;
  added: number;
}

export function loadImported(): ImportedRecord[] {
  try {
    const raw = localStorage.getItem(IMPORTED_KEY);
    return raw ? (JSON.parse(raw) as ImportedRecord[]) : [];
  } catch {
    return [];
  }
}

/**
 * Persist an imported score. Rejects a file that does not parse *before* storing
 * it, so a broken import cannot make the library fail to render afterwards.
 */
export function addImported(name: string, xml: string): ImportedRecord {
  pieceFromMusicXML("probe", name, xml);
  const record: ImportedRecord = {
    id: `imported-${Date.now().toString(36)}`,
    name,
    xml,
    added: Date.now(),
  };
  const all = [...loadImported(), record];
  try {
    localStorage.setItem(IMPORTED_KEY, JSON.stringify(all));
  } catch {
    // Quota exceeded: a MusicXML file can be hundreds of kilobytes.
    throw new Error("No hay espacio para guardar más partituras");
  }
  return record;
}

export function removeImported(id: string): void {
  try {
    localStorage.setItem(
      IMPORTED_KEY,
      JSON.stringify(loadImported().filter((r) => r.id !== id)),
    );
  } catch {
    /* nothing stored */
  }
}
