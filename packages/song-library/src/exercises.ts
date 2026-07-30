/**
 * Technique exercises, generated rather than transcribed.
 *
 * A learner who only ever plays pieces plateaus: pieces teach you *that* piece,
 * while five-finger patterns, contrary motion, broken chords and scales teach
 * the hand. Every method book opens with them and this library had none.
 *
 * They are **generated from a few parameters**, which is the whole point:
 *
 *  - no copyright question — a five-finger pattern in D is arithmetic, not a work;
 *  - transposing to another key is one number, so the same exercise can be met
 *    again in a key the learner has never played;
 *  - the fingering is derived from the shape, so it cannot drift out of step
 *    with the notes the way hand-authored digits can.
 *
 * The output is a plain `Song`, so exercises flow through the notation, the
 * follower, the staff and the scoring unchanged — there is no "exercise mode".
 */
import type { Song } from "./types.js";

/** Semitones above the tonic for the five notes of a major five-finger position. */
const FIVE_FINGER = [0, 2, 4, 5, 7];

/** Semitones above the tonic for a major scale, one octave. */
const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11, 12];

/** Spelling used when writing a generated note back out as a token. */
const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];

/**
 * Render a MIDI number as a notation token, spelled for the key so a flat key
 * does not print sharps. Mirrors `midiToSpelling` in notation.ts, but emits the
 * text form the parser reads back.
 */
function token(midi: number, sharps: number, finger: number, duration?: number): string {
  const pc = ((midi % 12) + 12) % 12;
  const name = (sharps < 0 ? FLAT_NAMES : SHARP_NAMES)[pc];
  // The octave belongs to the natural letter; none of the generated pitches is
  // spelled across an octave boundary (no B# or Cb), so this is exact.
  const octave = Math.floor(midi / 12) - 1;
  const dur = duration !== undefined && duration !== 1 ? `:${duration}` : "";
  return `${name}${octave}/${finger}${dur}`;
}

/** Join tokens into bars, one array per bar. */
function bars(lines: string[][]): string {
  return lines.map((b) => b.join(" ")).join(" | ");
}

export type ExerciseKind = "five-finger" | "contrary" | "broken-chord" | "scale";

export interface ExerciseSpec {
  id: string;
  /** Display name of the key, e.g. "DO mayor". */
  keyName: string;
  kind: ExerciseKind;
  /** MIDI note of the right hand's tonic. */
  tonic: number;
  /** Key signature as a sharp count (negative = flats). */
  sharps: number;
  bpm: number;
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

/**
 * Five-finger pattern: up, down, then the tonic triad and a long tonic.
 *
 * The most useful minute a beginner can spend. Both hands play the same shape
 * two octaves apart, so it is also the cheapest way to practise hands together.
 */
function fiveFinger(spec: ExerciseSpec): Pick<Song, "right" | "left" | "startPosition"> {
  const r = (i: number, f: number, d?: number): string =>
    token(spec.tonic + FIVE_FINGER[i], spec.sharps, f, d);
  const l = (i: number, f: number, d?: number): string =>
    token(spec.tonic - 24 + FIVE_FINGER[i], spec.sharps, f, d);

  return {
    right: bars([
      [r(0, 1), r(1, 2), r(2, 3), r(3, 4)],
      [r(4, 5), r(3, 4), r(2, 3), r(1, 2)],
      [r(0, 1), r(2, 3), r(4, 5), r(2, 3)],
      [r(0, 1, 4)],
    ]),
    // Left-hand fingers mirror: the little finger takes the lowest note.
    left: bars([
      [l(0, 5), l(1, 4), l(2, 3), l(3, 2)],
      [l(4, 1), l(3, 2), l(2, 3), l(1, 4)],
      [l(0, 5), l(2, 3), l(4, 1), l(2, 3)],
      [l(0, 5, 4)],
    ]),
    startPosition: { right: spec.tonic, left: spec.tonic - 24 },
  };
}

/**
 * Contrary motion: the hands start on the same note name and move apart.
 *
 * Harder than it looks and worth far more than it costs — it is the first thing
 * that forces the two hands to stop copying each other, which is exactly the
 * skill every two-hand piece from level 3 onwards assumes.
 */
function contrary(spec: ExerciseSpec): Pick<Song, "right" | "left" | "startPosition"> {
  // Descending major degrees from the tonic: tonic, 7th, 6th, 5th, 4th.
  const DOWN = [0, -1, -3, -5, -7];
  const r = (i: number, f: number, d?: number): string =>
    token(spec.tonic + FIVE_FINGER[i], spec.sharps, f, d);
  const l = (i: number, f: number, d?: number): string =>
    token(spec.tonic - 12 + DOWN[i], spec.sharps, f, d);

  return {
    right: bars([
      [r(0, 1), r(1, 2), r(2, 3), r(3, 4)],
      [r(4, 5), r(3, 4), r(2, 3), r(1, 2)],
      [r(0, 1, 4)],
    ]),
    left: bars([
      [l(0, 1), l(1, 2), l(2, 3), l(3, 4)],
      [l(4, 5), l(3, 4), l(2, 3), l(1, 2)],
      [l(0, 1, 4)],
    ]),
    startPosition: { right: spec.tonic, left: spec.tonic - 19 },
  };
}

/**
 * Broken triad, up and down in quavers.
 *
 * This is the level-6 idiom in miniature: the same rolling left hand, small
 * enough that it can be learnt before the piece that needs it.
 */
function brokenChord(spec: ExerciseSpec): Pick<Song, "right" | "left" | "startPosition"> {
  const SHAPE = [0, 4, 7, 12, 7, 4, 0];
  const R_FINGERS = [1, 2, 3, 5, 3, 2, 1];
  const L_FINGERS = [5, 3, 2, 1, 2, 3, 5];
  // Six quavers and a closing crotchet make exactly one 4/4 bar.
  const DURATIONS = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 1];

  const bar = (root: number, octaveShift: number, fingers: number[]): string[] =>
    SHAPE.map((semis, i) =>
      token(root + octaveShift + semis, spec.sharps, fingers[i], DURATIONS[i]),
    );

  // I – IV – V – I, the progression under most of the repertoire.
  const ROOTS = [0, 5, 7, 0];
  return {
    right: bars(ROOTS.map((root) => bar(spec.tonic + root, 0, R_FINGERS))),
    left: bars(ROOTS.map((root) => bar(spec.tonic + root, -24, L_FINGERS))),
    // No `startPosition`: the hand rolls across an octave and back, so claiming
    // a five-finger span would be a lie the highlighted keys would repeat.
  };
}

/**
 * One-octave major scale, hands together, with the standard fingering.
 *
 * Only generated for keys whose fingering is the plain 1-2-3-1-2-3-4-5 pattern
 * (C and G among the keys this library teaches). F major turns the thumb under
 * at a different place, and printing the wrong digits would be worse than
 * printing none — so it simply is not offered.
 */
function scale(spec: ExerciseSpec): Pick<Song, "right" | "left" | "startPosition"> {
  const UP_R = [1, 2, 3, 1, 2, 3, 4, 5];
  const DOWN_R = [4, 3, 2, 1, 3, 2, 1];
  const UP_L = [5, 4, 3, 2, 1, 3, 2, 1];
  const DOWN_L = [2, 3, 1, 2, 3, 4, 5];

  const up = (base: number, fingers: number[]): string[] =>
    MAJOR_SCALE.map((semis, i) => token(base + semis, spec.sharps, fingers[i], 0.5));
  // Coming back down: the seventh degree first, and the tonic held as a crotchet.
  const down = (base: number, fingers: number[]): string[] => [
    ...MAJOR_SCALE.slice(1, 7)
      .reverse()
      .map((semis, i) => token(base + semis, spec.sharps, fingers[i], 0.5)),
    token(base, spec.sharps, fingers[6], 1),
  ];

  return {
    right: bars([up(spec.tonic, UP_R), down(spec.tonic, DOWN_R)]),
    left: bars([up(spec.tonic - 24, UP_L), down(spec.tonic - 24, DOWN_L)]),
    // No `startPosition`: the thumb passes under, so the hand does not stay put.
  };
}

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

const KIND_META: Record<ExerciseKind, { name: string; tip: string; goal: string }> = {
  "five-finger": {
    name: "Cinco dedos",
    tip: "Un dedo por tecla y la mano quieta. Busca que las cinco notas suenen igual de fuerte: es lo único que se practica aquí.",
    goal: "Iguala el sonido de los cinco dedos.",
  },
  contrary: {
    name: "Movimiento contrario",
    tip: "Las dos manos empiezan en la misma nota y se separan. Es la primera vez que las manos dejan de copiarse: ve muy despacio.",
    goal: "Que cada mano vaya a lo suyo.",
  },
  "broken-chord": {
    name: "Acordes rotos",
    tip: "El mismo arpegio sobre I-IV-V-I. Mueve el brazo entero en vez de estirar los dedos.",
    goal: "El motor de los niveles 5 y 6, en pequeño.",
  },
  scale: {
    name: "Escala",
    tip: "El pulgar pasa por debajo del dedo 3 sin que la mano dé un tirón. Si suena un bache, vas demasiado rápido.",
    goal: "Pulgar por debajo, sin bache.",
  },
};

const GENERATORS: Record<
  ExerciseKind,
  (spec: ExerciseSpec) => Pick<Song, "right" | "left" | "startPosition">
> = {
  "five-finger": fiveFinger,
  contrary,
  "broken-chord": brokenChord,
  scale,
};

/** Time signature and level per kind — every exercise is in 4/4. */
function levelOf(kind: ExerciseKind): 1 | 2 | 3 {
  if (kind === "five-finger") return 1;
  if (kind === "scale" || kind === "contrary") return 2;
  return 3;
}

export const EXERCISE_SPECS: ExerciseSpec[] = [
  { id: "ex-five-c", keyName: "DO mayor", kind: "five-finger", tonic: 60, sharps: 0, bpm: 76 },
  { id: "ex-five-g", keyName: "SOL mayor", kind: "five-finger", tonic: 67, sharps: 1, bpm: 80 },
  { id: "ex-five-f", keyName: "FA mayor", kind: "five-finger", tonic: 65, sharps: -1, bpm: 80 },
  { id: "ex-five-d", keyName: "RE mayor", kind: "five-finger", tonic: 62, sharps: 2, bpm: 84 },
  { id: "ex-contrary-c", keyName: "DO mayor", kind: "contrary", tonic: 60, sharps: 0, bpm: 66 },
  { id: "ex-contrary-g", keyName: "SOL mayor", kind: "contrary", tonic: 67, sharps: 1, bpm: 66 },
  { id: "ex-scale-c", keyName: "DO mayor", kind: "scale", tonic: 60, sharps: 0, bpm: 72 },
  { id: "ex-scale-g", keyName: "SOL mayor", kind: "scale", tonic: 67, sharps: 1, bpm: 72 },
  { id: "ex-broken-c", keyName: "DO mayor", kind: "broken-chord", tonic: 60, sharps: 0, bpm: 60 },
  { id: "ex-broken-g", keyName: "SOL mayor", kind: "broken-chord", tonic: 67, sharps: 1, bpm: 60 },
];

/** Compile one spec into a playable `Song`. */
export function buildExercise(spec: ExerciseSpec): Song {
  const meta = KIND_META[spec.kind];
  return {
    id: spec.id,
    title: `${meta.name} · ${spec.keyName}`,
    composer: meta.goal,
    level: levelOf(spec.kind),
    bpm: spec.bpm,
    beats: 4,
    beatType: 4,
    sharps: spec.sharps,
    tip: meta.tip,
    ...GENERATORS[spec.kind](spec),
  };
}

/**
 * The generated warm-up catalogue.
 *
 * Deliberately *not* part of `SONGS`: exercises are not repertoire, they do not
 * belong in the curriculum's ordering, and "finish the library" must not be
 * satisfiable by playing scales.
 */
export const EXERCISES: Song[] = EXERCISE_SPECS.map(buildExercise);

/** Look a generated exercise up by its id. */
export function exerciseById(id: string): Song | undefined {
  return EXERCISES.find((e) => e.id === id);
}
