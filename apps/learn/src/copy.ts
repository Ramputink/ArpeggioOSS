/**
 * Every user-facing sentence the app builds at runtime.
 *
 * Two reasons this is one file rather than string literals scattered through the
 * screens. First, the messages that matter — what to say about a wrong note,
 * where to put the hand — are *decisions*, not decoration, and decisions belong
 * somewhere they can be tested: everything here is a pure function of plain
 * data. Second, it is the seam an English translation goes through, and having
 * it already drawn is most of that job.
 *
 * (Static markup still lives in `index.html`; this is only the dynamic half.)
 */
import type { HandChoice, StartPosition } from "@arpeggio/song-library";

import { noteName, octaveOf } from "./staff.js";

// ---------------------------------------------------------------------------
// Grammar helpers
// ---------------------------------------------------------------------------

/** "1 nota tocada" / "26 notas tocadas" — Spanish copy needs the agreement. */
export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "DO4", "FA♯5" — a pitch a learner can find on the keyboard. */
export function pitchLabel(midi: number, sharps: number): string {
  return `${noteName(midi, sharps)}${octaveOf(midi)}`;
}

// ---------------------------------------------------------------------------
// Fixed vocabulary
// ---------------------------------------------------------------------------

export const HAND_LABEL: Record<HandChoice, string> = {
  right: "mano derecha",
  left: "mano izquierda",
  both: "las dos manos",
};

export const MODE_HELP = {
  keys: "Toca las teclas del móvil. No necesitas piano.",
  mic: "Toca en un piano de verdad: la app te escucha por el micrófono.",
  demo: "La app toca la pieza para que la escuches y la sigas con la vista.",
} as const;

export const JUDGE_HELP = {
  wait: "El cursor te espera en cada nota. Perdona el ritmo: ideal para leer la pieza por primera vez.",
  tempo:
    "El cursor sigue al tempo y corrige si llegas tarde o pronto. Es el modo honesto con el ritmo.",
} as const;

export const MIC_VERDICT = {
  silence: "No oigo nada. ¿Está el micrófono tapado?",
  quiet: "Te oigo muy bajito: acerca el móvil al piano.",
  good: "Nivel perfecto.",
  loud: "Un poco fuerte: aleja el móvil un palmo.",
  clipping: "Demasiado fuerte, se satura. Aleja el móvil.",
} as const;

// ---------------------------------------------------------------------------
// Hand placement
// ---------------------------------------------------------------------------

/**
 * Where to put the hands before the first note.
 *
 * The single most useful thing to say to a beginner and the one thing a printed
 * score never says. The anchor is the lowest key of each hand's span, which is
 * the thumb on the right and the little finger on the left — so the sentence can
 * name a finger and a key, not a vague region.
 *
 * Returns null when the piece has no settled position, because inventing one is
 * worse than saying nothing: a learner who plants their hand where the app said
 * and then finds the music somewhere else will trust it less next time.
 */
export function handPositionText(
  position: StartPosition | undefined,
  sharps: number,
  hand: HandChoice,
): string | null {
  if (!position) return null;
  const parts: string[] = [];
  if (position.right !== undefined && hand !== "left") {
    parts.push(`pulgar derecho en ${pitchLabel(position.right, sharps)}`);
  }
  if (position.left !== undefined && hand !== "right") {
    parts.push(`meñique izquierdo en ${pitchLabel(position.left, sharps)}`);
  }
  if (parts.length === 0) return null;
  return `Coloca la mano: ${parts.join(" · ")}.`;
}

/** The five keys a hand covers from its anchor, for highlighting the keyboard. */
export function fiveFingerSpan(anchor: number): number[] {
  // A major five-finger position: tone, tone, semitone, tone. Highlighting the
  // literal white keys instead would be wrong in every key with a black note.
  return [0, 2, 4, 5, 7].map((semis) => anchor + semis);
}

// ---------------------------------------------------------------------------
// Judging feedback
// ---------------------------------------------------------------------------

/**
 * What to say about a wrong note. Three genuinely different situations, and one
 * message for all of them would be wrong in two of them:
 *
 *  - nothing was played and the deadline passed (an a-tempo miss);
 *  - the right note in the wrong octave, which is a misplaced hand;
 *  - a wrong note — and only then is "look at the lit key" useful, and only when
 *    there is a keyboard on screen to look at.
 */
export function wrongNoteMessage(
  event: { playedMidi?: number; octaveOff?: number },
  hasKeyboard: boolean,
): string {
  if (event.playedMidi === undefined) return "Se te ha pasado esa nota";
  if (event.octaveOff !== undefined) {
    const octaves = Math.abs(event.octaveOff);
    const where = event.octaveOff < 0 ? "más abajo" : "más arriba";
    // Not `plural()` here: the singular takes an article ("una octava"), not a
    // numeral, so the generic helper produced "1 una octava".
    const amount = octaves === 1 ? "una octava" : `${octaves} octavas`;
    return `Nota correcta, pero ${amount} ${where}`;
  }
  return hasKeyboard ? "Esa no… mira la tecla iluminada" : "Esa no era";
}

/** The heading over the result sheet. */
export function resultHeadline(judged: boolean, stars: number, completed: boolean): string {
  if (!judged) return "Fin de la escucha";
  if (stars === 3) return "¡Impecable!";
  return completed ? "¡Pieza terminada!" : "Buen intento";
}

/** Bars to revise, phrased for one bar or several. */
export function reviseAdvice(measures: readonly number[]): string | null {
  if (measures.length === 0) return null;
  return measures.length === 1
    ? `Repasa el compás ${measures[0]} antes de volver a tocarla entera.`
    : `Repasa los compases ${measures.join(", ")} antes de volver a tocarla entera.`;
}
