/**
 * The built-in starter library: public-domain pieces ordered so a complete
 * beginner can start on the first one today and work down the list.
 *
 * Curation rules:
 *  - Level 1 stays inside the five-finger C position (C4–G4), no black keys.
 *  - Level 2 adds hand shifts, dotted rhythms and a simple left-hand bass.
 *  - Level 3 adds accidentals and real two-hand coordination.
 *  - Everything is public domain (traditional, or composers dead >100 years).
 *
 * Bar lines in the notation are load-bearing: every bar is checked against the
 * time signature at parse time, so a wrong duration fails `npm test`.
 *
 * FINGERING. Every piece carries fingers (the `/n` suffix) and, where the hand
 * has a definite home, a `startPosition`. This is not decoration: "play a G" is
 * ambiguous, and a beginner who picks the wrong finger has to unlearn it before
 * the passage can go up to speed. The fingerings below follow the standard
 * five-finger positions and, in the scale-shaped passages, standard scale
 * mechanics (thumb under, third over). Where the hand must move, it moves on a
 * long note or a rest, and the `tip` says so.
 */
import type { Level, Song } from "./types.js";

export const SONGS: Song[] = [
  // --- Level 1 — five-finger C position, right hand -------------------------
  {
    id: "mary-lamb",
    title: "María tenía un corderito",
    composer: "Tradicional",
    level: 1,
    bpm: 88,
    beats: 4,
    beatType: 4,
    sharps: 0,
    // First in the list, not second: it is the only piece in the library that
    // never moves the hand at all, and "which one do I press first" is the
    // question a beginner actually has.
    tip: "Tu primera canción. Solo tres dedos: pulgar en DO, índice en RE y corazón en MI, y la mano no se mueve.",
    startPosition: { right: 60 },
    // Everything sits under one hand in the five-finger position, so the digits
    // are unambiguous (1 = thumb on DO … 5 = little finger on SOL).
    right:
      "E4/3 D4/2 C4/1 D4/2 | E4/3 E4/3 E4/3:2 | D4/2 D4/2 D4/2:2 | E4/3 G4/5 G4/5:2 | " +
      "E4/3 D4/2 C4/1 D4/2 | E4/3 E4/3 E4/3 E4/3 | D4/2 D4/2 E4/3 D4/2 | C4/1:4",
  },
  {
    id: "twinkle",
    title: "Estrellita, ¿dónde estás?",
    composer: "Tradicional",
    level: 1,
    bpm: 84,
    beats: 4,
    beatType: 4,
    sharps: 0,
    // The melody spans a sixth (DO to LA), which is one note more than five
    // fingers cover — so the honest instruction is "move up for the LA and come
    // straight back", not "never move".
    tip: "Pulgar en DO. Solo mueves la mano en el compás 2: sube un paso para el LA y vuelve enseguida.",
    startPosition: { right: 60, left: 48 },
    right:
      "C4/1 C4/1 G4/5 G4/5 | A4/5 A4/5 G4/4:2 | F4/4 F4/4 E4/3 E4/3 | D4/2 D4/2 C4/1:2 | " +
      "G4/5 G4/5 F4/4 F4/4 | E4/3 E4/3 D4/2:2 | G4/5 G4/5 F4/4 F4/4 | E4/3 E4/3 D4/2:2 | " +
      "C4/1 C4/1 G4/5 G4/5 | A4/5 A4/5 G4/4:2 | F4/4 F4/4 E4/3 E4/3 | D4/2 D4/2 C4/1:2",
    left:
      "C3/5:4 | F3/2:2 C3/5:2 | F3/2:2 C3/5:2 | G3/1:2 C3/5:2 | " +
      "C3/5:2 F3/2:2 | C3/5:2 G3/1:2 | C3/5:2 F3/2:2 | C3/5:2 G3/1:2 | " +
      "C3/5:4 | F3/2:2 C3/5:2 | F3/2:2 C3/5:2 | G3/1:2 C3/5:2",
  },
  {
    id: "ode-to-joy",
    title: "Himno de la Alegría",
    composer: "Ludwig van Beethoven",
    level: 1,
    bpm: 92,
    beats: 4,
    beatType: 4,
    sharps: 0,
    // The low SOL is *below* the hand, so it is the thumb that moves, not the
    // little finger — the previous wording had the geometry backwards.
    tip: "Todo cae bajo los cinco dedos salvo el SOL grave del compás 12: baja la mano y tócalo con el pulgar.",
    startPosition: { right: 60, left: 48 },
    right:
      "E4/3 E4/3 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4/1 D4/2 E4/3 | E4/3:1.5 D4/2:0.5 D4/2:2 | " +
      "E4/3 E4/3 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4/1 D4/2 E4/3 | D4/2:1.5 C4/1:0.5 C4/1:2 | " +
      "D4/2 D4/2 E4/3 C4/1 | D4/2 E4/3:0.5 F4/4:0.5 E4/3 C4/1 | D4/2 E4/3:0.5 F4/4:0.5 E4/3 D4/2 | C4/1 D4/2 G3/1:2 | " +
      "E4/3 E4/3 F4/4 G4/5 | G4/5 F4/4 E4/3 D4/2 | C4/1 C4/1 D4/2 E4/3 | D4/2:1.5 C4/1:0.5 C4/1:2",
    left:
      "C3/5:4 | C3/5:2 G3/1:2 | C3/5:2 G3/1:2 | C3/5:2 G3/1:2 | " +
      "C3/5:4 | C3/5:2 G3/1:2 | C3/5:2 G3/1:2 | G3/1:2 C3/5:2 | " +
      "G3/1:2 C3/5:2 | G3/1:2 C3/5:2 | G3/1:4 | C3/5:2 G3/1:2 | " +
      "C3/5:4 | C3/5:2 G3/1:2 | C3/5:2 G3/1:2 | G3/1:2 C3/5:2",
  },
  {
    id: "jingle-bells",
    title: "Jingle Bells",
    composer: "James Lord Pierpont",
    level: 1,
    bpm: 108,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "Casi todo es MI repetido, y la mano no se mueve en toda la canción. Cuidado con el salto MI-SOL-DO del tercer compás.",
    startPosition: { right: 60, left: 48 },
    right:
      "E4/3 E4/3 E4/3:2 | E4/3 E4/3 E4/3:2 | E4/3 G4/5 C4/1 D4/2 | E4/3:4 | " +
      "F4/4 F4/4 F4/4 F4/4 | F4/4 E4/3 E4/3 E4/3:0.5 E4/3:0.5 | E4/3 D4/2 D4/2 E4/3 | D4/2:2 G4/5:2 | " +
      "E4/3 E4/3 E4/3:2 | E4/3 E4/3 E4/3:2 | E4/3 G4/5 C4/1 D4/2 | E4/3:4 | " +
      "F4/4 F4/4 F4/4 F4/4 | F4/4 E4/3 E4/3 E4/3:0.5 E4/3:0.5 | G4/5 G4/5 F4/4 D4/2 | C4/1:4",
    left:
      "C3/5:4 | C3/5:4 | C3/5:4 | C3/5:4 | F3/2:4 | C3/5:4 | G3/1:4 | G3/1:2 G3/1:2 | " +
      "C3/5:4 | C3/5:4 | C3/5:4 | C3/5:4 | F3/2:4 | C3/5:4 | G3/1:4 | C3/5:4",
  },

  // --- Level 2 — hand shifts, dotted rhythms, simple bass -------------------
  {
    id: "au-clair",
    title: "Au clair de la lune",
    composer: "Tradicional francesa",
    level: 2,
    bpm: 96,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "En el compás 9 la mano derecha baja entera: pulgar al SOL grave. Practica solo esa frase (compases 9 a 12) hasta que salga sin mirar.",
    startPosition: { right: 60, left: 43 },
    right:
      "C4/1 C4/1 C4/1 D4/2 | E4/3:2 D4/2:2 | C4/1 E4/3 D4/2 D4/2 | C4/1:4 | " +
      "C4/1 C4/1 C4/1 D4/2 | E4/3:2 D4/2:2 | C4/1 E4/3 D4/2 D4/2 | C4/1:4 | " +
      "D4/5 D4/5 D4/5 D4/5 | A3/2:2 A3/2:2 | D4/5 C4/4 B3/3 A3/2 | G3/1:4 | " +
      "C4/1 C4/1 C4/1 D4/2 | E4/3:2 D4/2:2 | C4/1 E4/3 D4/2 D4/2 | C4/1:4",
    left:
      "C3/2:4 | G2/5:4 | G2/5:4 | C3/2:4 | C3/2:4 | G2/5:4 | G2/5:4 | C3/2:4 | " +
      "G2/5:4 | D3/1:4 | G2/5:4 | G2/5:4 | C3/2:4 | G2/5:4 | G2/5:4 | C3/2:4",
  },
  {
    id: "frere-jacques",
    title: "Fray Santiago",
    composer: "Tradicional francesa",
    level: 2,
    bpm: 100,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "El compás 5 lleva corcheas: cuenta «1 y 2 y» en voz alta. Para el LA sube la mano un paso, y para el final bájala hasta el SOL grave.",
    startPosition: { right: 60, left: 43 },
    right:
      "C4/1 D4/2 E4/3 C4/1 | C4/1 D4/2 E4/3 C4/1 | E4/3 F4/4 G4/5:2 | E4/3 F4/4 G4/5:2 | " +
      "G4/4:0.5 A4/5:0.5 G4/4:0.5 F4/3:0.5 E4/2 C4/1 | " +
      "G4/4:0.5 A4/5:0.5 G4/4:0.5 F4/3:0.5 E4/2 C4/1 | " +
      "C4/4 G3/1 C4/4:2 | C4/4 G3/1 C4/4:2",
    left:
      "C3/1:4 | C3/1:4 | C3/1:2 G2/5:2 | C3/1:2 G2/5:2 | C3/1:4 | C3/1:4 | " +
      "C3/1:1 G2/5:1 C3/1:2 | C3/1:1 G2/5:1 C3/1:2",
  },
  {
    id: "london-bridge",
    title: "El puente de Londres",
    composer: "Tradicional inglesa",
    level: 2,
    bpm: 104,
    beats: 4,
    beatType: 4,
    sharps: 0,
    // Starting on RE rather than DO is the whole trick: the melody spans RE–LA,
    // which is exactly five fingers, and the hand never has to stretch.
    tip: "Pon el pulgar derecho en RE, no en DO: así toda la melodía cae bajo la mano y solo lo mueves en el último compás.",
    startPosition: { right: 62, left: 48 },
    right:
      "G4/4 A4/5 G4/4 F4/3 | E4/2 F4/3 G4/4:2 | D4/1 E4/2 F4/3:2 | E4/2 F4/3 G4/4:2 | " +
      "G4/4 A4/5 G4/4 F4/3 | E4/2 F4/3 G4/4:2 | D4/1:2 G4/4:2 | E4/2:2 C4/1:2",
    left: "C3/5:4 | C3/5:2 G3/1:2 | G3/1:4 | C3/5:4 | C3/5:4 | C3/5:2 G3/1:2 | G3/1:4 | C3/5:4",
  },
  {
    id: "silent-night",
    title: "Noche de paz",
    composer: "Franz Xaver Gruber",
    level: 2,
    bpm: 72,
    beats: 3,
    beatType: 4,
    sharps: 0,
    tip: "Compás de 3/4: cuenta «1-2-3» lento. El ritmo largo-corto (negra con puntillo + corchea) es el alma de esta canción.",
    startPosition: { right: 64, left: 41 },
    right:
      "G4/3:1.5 A4/4:0.5 G4/3:1 | E4/1:3 | G4/3:1.5 A4/4:0.5 G4/3:1 | E4/1:3 | " +
      "D5/5:2 D5/5:1 | B4/3:3 | C5/4:2 C5/4:1 | G4/1:3 | " +
      "A4/2:2 A4/2:1 | C5/4:1.5 B4/3:0.5 A4/2:1 | G4/3:1.5 A4/4:0.5 G4/3:1 | E4/1:3 | " +
      "A4/2:2 A4/2:1 | C5/4:1.5 B4/3:0.5 A4/2:1 | G4/3:1.5 A4/4:0.5 G4/3:1 | E4/1:3 | " +
      "D5/3:2 D5/3:1 | F5/5:1.5 D5/3:0.5 B4/1:1 | C5/2:3 | E5/4:3 | " +
      "C5/5:1 G4/3:1 E4/1:1 | G4/5:1.5 F4/4:0.5 D4/2:1 | C4/1:3",
    left:
      "C3/1:3 | C3/1:3 | C3/1:3 | C3/1:3 | G2/4:3 | G2/4:3 | C3/1:3 | C3/1:3 | " +
      "F2/5:3 | F2/5:3 | C3/1:3 | C3/1:3 | F2/5:3 | F2/5:3 | C3/1:3 | C3/1:3 | " +
      "G2/4:3 | G2/4:3 | C3/1:3 | C3/1:3 | C3/1:3 | G2/4:3 | C3/1:3",
  },

  // --- Level 3 — accidentals and two real hands -----------------------------
  //
  // From here on the pieces are real repertoire. Where a left hand is a
  // simplification of the original it says so in the `tip`, so nobody is misled
  // into thinking they are playing the urtext.
  {
    id: "fur-elise",
    title: "Para Elisa (tema)",
    composer: "Ludwig van Beethoven",
    level: 3,
    bpm: 76,
    beats: 3,
    beatType: 4,
    sharps: 0,
    pickupBeats: 1,
    tip: "La mano derecha no se mueve: pulgar en LA4, meñique en MI5. El RE♯ es tecla negra y va con el dedo 4, sin dejar caer la muñeca.",
    startPosition: { right: 69, left: 45 },
    right:
      "E5/5:0.5 D#5/4:0.5 | " +
      "E5/5:0.5 D#5/4:0.5 E5/5:0.5 B4/3:0.5 D5/2:0.5 C5/1:0.5 | " +
      "A4/1:1 r:2 | B4/1:1 r:2 | C5/1:1 r:1 E5/5:0.5 D#5/4:0.5 | " +
      "E5/5:0.5 D#5/4:0.5 E5/5:0.5 B4/3:0.5 D5/2:0.5 C5/1:0.5 | " +
      "A4/1:1 r:2 | B4/1:1 r:0.5 C5/3:0.5 B4/2:0.5 A4/1:0.5 | A4/1:3",
    left:
      "r:1 | r:3 | A2/5:0.5 E3/2:0.5 A3/1:0.5 r:1.5 | E2/5:0.5 E3/2:0.5 G#3/1:0.5 r:1.5 | " +
      "A2/5:0.5 E3/2:0.5 A3/1:0.5 r:1.5 | r:3 | A2/5:0.5 E3/2:0.5 A3/1:0.5 r:1.5 | " +
      "E2/5:0.5 E3/2:0.5 G#3/1:0.5 r:1.5 | A2/5:0.5 E3/2:0.5 A3/1:0.5 r:1.5",
  },
  {
    id: "canon-d",
    title: "Canon en Re",
    composer: "Johann Pachelbel",
    level: 3,
    bpm: 66,
    beats: 4,
    beatType: 4,
    sharps: 2,
    // The fingering here is the D major scale's, not a fixed position: the line
    // is a descending scale and learning it with the thumb-under is worth more
    // than learning it with a hand that jumps.
    tip: "Dos sostenidos en la armadura: FA♯ y DO♯ son siempre teclas negras. La derecha usa la digitación de la escala de RE: el pulgar pasa por debajo.",
    // No fixed position: the right hand runs a scale and the left leaps a fifth
    // every bar, so there is no five-finger span to show.
    right:
      "F#5/3:2 E5/2:2 | D5/1:2 C#5/4:2 | B4/3:2 A4/2:2 | B4/3:2 C#5/4:2 | " +
      "D5/1:2 C#5/4:2 | B4/3:2 A4/2:2 | G4/1:2 F#4/3:2 | G4/1:2 E4/3:2",
    left:
      "D3/1:2 A2/5:2 | B2/1:2 F#2/5:2 | G2/1:2 D2/5:2 | G2/2:2 A2/1:2 | " +
      "D3/1:2 A2/5:2 | B2/1:2 F#2/5:2 | G2/1:2 D2/5:2 | G2/2:2 A2/1:2",
  },
  {
    // Bridge into level 4. The jump from the Canon (half notes) to the Minuet
    // (continuous quavers, two independent hands) was the steepest step in the
    // curriculum, so the Minuet's first phrase is offered on its own, slower,
    // before the whole piece. Same notes, same fingering — nothing to unlearn.
    id: "bach-minuet-open",
    title: "Minueto en Sol (primera frase)",
    composer: "J. S. Bach / Christian Petzold",
    level: 3,
    bpm: 88,
    beats: 3,
    beatType: 4,
    sharps: 1,
    tip: "La mitad del Minueto completo y más despacio. La izquierda no se mueve: meñique en SOL2, pulgar en RE3.",
    startPosition: { right: 67, left: 43 },
    right:
      "D5/5:1 G4/1:0.5 A4/2:0.5 B4/3:0.5 C5/4:0.5 | D5/5:1 G4/1:1 G4/1:1 | " +
      "E5/3:1 C5/1:0.5 D5/2:0.5 E5/3:0.5 F#5/4:0.5 | G5/5:1 G4/1:1 G4/1:1 | " +
      "C5/4:1 D5/5:0.5 C5/4:0.5 B4/3:0.5 A4/2:0.5 | B4/3:1 C5/4:0.5 B4/3:0.5 A4/2:0.5 G4/1:0.5 | " +
      "F#4/1:1 G4/2:0.5 A4/3:0.5 B4/4:0.5 G4/2:0.5 | A4/3:3",
    left:
      "G2/5:3 | G2/5:1.5 D3/1:1.5 | C3/2:3 | B2/3:1.5 G2/5:1.5 | " +
      "A2/4:3 | G2/5:1.5 D3/1:1.5 | D3/1:3 | D3/1:1.5 A2/4:1.5",
  },

  // --- Level 4 — classical repertoire, as written ---------------------------
  {
    id: "dvorak-largo",
    title: "Largo del Nuevo Mundo",
    composer: "Antonín Dvořák",
    level: 4,
    bpm: 56,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "Muy lento y ligado: cada nota tiene que durar hasta que empiece la siguiente. En el compás 4 la mano baja al SOL grave y vuelve.",
    startPosition: { right: 60, left: 43 },
    right:
      "E4/3:1.5 G4/5:0.5 G4/5:2 | E4/3:1.5 D4/2:0.5 C4/1:2 | D4/2 E4/3 D4/2 C4/1 | A3/2:2 G3/1:2 | " +
      "E4/3:1.5 G4/5:0.5 G4/5:2 | E4/3:1.5 D4/2:0.5 C4/1:2 | D4/2 E4/3 D4/2 C4/1 | C4/1:4",
    left: "C3/1:4 | C3/1:4 | G2/5:4 | G2/5:4 | C3/1:4 | C3/1:4 | G2/5:4 | C3/1:4",
  },
  {
    id: "bach-minuet",
    title: "Minueto en Sol",
    composer: "J. S. Bach / Christian Petzold",
    level: 4,
    bpm: 108,
    beats: 3,
    beatType: 4,
    sharps: 1,
    tip: "La mano derecha es la de Bach, nota por nota; la izquierda es un bajo simplificado para que puedas tocarlo ya. Hay un FA♯ en la armadura: siempre tecla negra.",
    startPosition: { right: 67, left: 43 },
    right:
      "D5/5:1 G4/1:0.5 A4/2:0.5 B4/3:0.5 C5/4:0.5 | D5/5:1 G4/1:1 G4/1:1 | " +
      "E5/3:1 C5/1:0.5 D5/2:0.5 E5/3:0.5 F#5/4:0.5 | G5/5:1 G4/1:1 G4/1:1 | " +
      "C5/4:1 D5/5:0.5 C5/4:0.5 B4/3:0.5 A4/2:0.5 | B4/3:1 C5/4:0.5 B4/3:0.5 A4/2:0.5 G4/1:0.5 | " +
      "F#4/1:1 G4/2:0.5 A4/3:0.5 B4/4:0.5 G4/2:0.5 | A4/3:3 | " +
      "D5/5:1 G4/1:0.5 A4/2:0.5 B4/3:0.5 C5/4:0.5 | D5/5:1 G4/1:1 G4/1:1 | " +
      "E5/3:1 C5/1:0.5 D5/2:0.5 E5/3:0.5 F#5/4:0.5 | G5/5:1 G4/1:1 G4/1:1 | " +
      "C5/4:1 D5/5:0.5 C5/4:0.5 B4/3:0.5 A4/2:0.5 | B4/3:1 C5/4:0.5 B4/3:0.5 A4/2:0.5 G4/1:0.5 | " +
      "A4/3:1 B4/4:0.5 A4/3:0.5 G4/2:0.5 F#4/1:0.5 | G4/2:3",
    left:
      "G2/5:3 | G2/5:1.5 D3/1:1.5 | C3/2:3 | B2/3:1.5 G2/5:1.5 | " +
      "A2/4:3 | G2/5:1.5 D3/1:1.5 | D3/1:3 | D3/1:1.5 A2/4:1.5 | " +
      "G2/5:3 | G2/5:1.5 D3/1:1.5 | C3/2:3 | B2/3:1.5 G2/5:1.5 | " +
      "A2/4:3 | G2/5:1.5 D3/1:1.5 | D3/1:3 | G2/5:3",
  },
  {
    // Bridge into level 5. The Prelude is four bars of the same figure; two of
    // them, at a walking tempo, is a complete little piece and removes the
    // "sixteen bars of semiquavers" wall in front of level 5.
    id: "bach-prelude-open",
    title: "Preludio nº 1 (los dos primeros compases)",
    composer: "J. S. Bach (BWV 846)",
    level: 4,
    bpm: 54,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "La mitad del Preludio. Un solo arpegio por medio compás, con la mano quieta: dedos 1-3-5 en la derecha, sin mover la muñeca.",
    startPosition: { right: 67, left: 48 },
    right:
      "r:0.5 G4/1:0.25 C5/3:0.25 E5/5:0.25 G4/1:0.25 C5/3:0.25 E5/5:0.25 " +
      "r:0.5 G4/1:0.25 C5/3:0.25 E5/5:0.25 G4/1:0.25 C5/3:0.25 E5/5:0.25 | " +
      "r:0.5 A4/1:0.25 D5/3:0.25 F5/5:0.25 A4/1:0.25 D5/3:0.25 F5/5:0.25 " +
      "r:0.5 A4/1:0.25 D5/3:0.25 F5/5:0.25 A4/1:0.25 D5/3:0.25 F5/5:0.25",
    left:
      "C3/5:0.25 E3/3:0.25 r:1.5 C3/5:0.25 E3/3:0.25 r:1.5 | " +
      "C3/5:0.25 D3/4:0.25 r:1.5 C3/5:0.25 D3/4:0.25 r:1.5",
  },

  // --- Level 5 — the big ones -----------------------------------------------
  {
    id: "bach-prelude",
    title: "Preludio nº 1 en Do",
    composer: "J. S. Bach (BWV 846)",
    level: 5,
    bpm: 63,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "Los cuatro primeros compases. No hay melodía: solo un arpegio que se repite dos veces por compás. Mantén la mano quieta y deja que suenen todas las notas.",
    startPosition: { right: 67, left: 48 },
    // Each half bar is one figure: two low notes, then the right hand's six
    // sixteenths. Written out rather than repeated so the follower sees every note.
    right:
      "r:0.5 G4/1:0.25 C5/3:0.25 E5/5:0.25 G4/1:0.25 C5/3:0.25 E5/5:0.25 " +
      "r:0.5 G4/1:0.25 C5/3:0.25 E5/5:0.25 G4/1:0.25 C5/3:0.25 E5/5:0.25 | " +
      "r:0.5 A4/1:0.25 D5/3:0.25 F5/5:0.25 A4/1:0.25 D5/3:0.25 F5/5:0.25 " +
      "r:0.5 A4/1:0.25 D5/3:0.25 F5/5:0.25 A4/1:0.25 D5/3:0.25 F5/5:0.25 | " +
      "r:0.5 G4/1:0.25 D5/3:0.25 F5/5:0.25 G4/1:0.25 D5/3:0.25 F5/5:0.25 " +
      "r:0.5 G4/1:0.25 D5/3:0.25 F5/5:0.25 G4/1:0.25 D5/3:0.25 F5/5:0.25 | " +
      "r:0.5 G4/1:0.25 C5/3:0.25 E5/5:0.25 G4/1:0.25 C5/3:0.25 E5/5:0.25 " +
      "r:0.5 G4/1:0.25 C5/3:0.25 E5/5:0.25 G4/1:0.25 C5/3:0.25 E5/5:0.25",
    left:
      "C3/5:0.25 E3/3:0.25 r:1.5 C3/5:0.25 E3/3:0.25 r:1.5 | " +
      "C3/5:0.25 D3/4:0.25 r:1.5 C3/5:0.25 D3/4:0.25 r:1.5 | " +
      "B2/5:0.25 D3/4:0.25 r:1.5 B2/5:0.25 D3/4:0.25 r:1.5 | " +
      "C3/5:0.25 E3/3:0.25 r:1.5 C3/5:0.25 E3/3:0.25 r:1.5",
  },
  {
    id: "moonlight",
    title: "Claro de Luna (inicio)",
    composer: "Ludwig van Beethoven",
    level: 5,
    bpm: 50,
    beats: 4,
    beatType: 4,
    sharps: 4,
    tip: "Cuatro compases de tresillos: tres notas por pulso, sin acentuar ninguna, siempre con los dedos 1-2-5. La izquierda son octavas: 5 y 1.",
    startPosition: { right: 56, left: 37 },
    right:
      "G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 | " +
      "G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 | " +
      "A3/1:1/3 C#4/2:1/3 E4/5:1/3 A3/1:1/3 C#4/2:1/3 E4/5:1/3 A3/1:1/3 D4/2:1/3 F#4/5:1/3 A3/1:1/3 D4/2:1/3 F#4/5:1/3 | " +
      "G#3/1:1/3 C4/2:1/3 F#4/5:1/3 G#3/1:1/3 C4/2:1/3 F#4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3 G#3/1:1/3 C#4/2:1/3 E4/5:1/3",
    left: "C#2/5+C#3/1:4 | C#2/5+C#3/1:4 | A1/5+A2/1:2 F#1/5+F#2/1:2 | G#1/5+G#2/1:4",
  },

  // --- Level 6 — original studies on the way to neoclassical piano ----------
  //
  // These three are written for this app (AGPL, like the rest of the repo), not
  // transcribed. Modern neoclassical piano is under copyright, so instead of
  // shipping someone else's piece we teach its machinery: a wide broken-chord
  // left hand under a slow melody, which is the whole idiom.
  {
    id: "study-arpeggios",
    title: "Estudio 1 · Arpegios",
    composer: "Estudio original de Arpeggio",
    level: 6,
    bpm: 60,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "La izquierda repite el mismo arpegio 5-3-2-1 mientras la derecha canta notas largas. Es el motor de casi todo el piano neoclásico.",
    right:
      "E5/3:4 | F5/4:2 E5/3:2 | E5/3:2 G5/5:2 | D5/2:4 | " +
      "C5/1:4 | A4/1:2 C5/3:2 | B4/2:2 D5/4:2 | A4/1:4",
    left:
      "A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 | " +
      "F2/5:0.5 C3/3:0.5 F3/2:0.5 A3/1:0.5 F2/5:0.5 C3/3:0.5 F3/2:0.5 A3/1:0.5 | " +
      "C3/5:0.5 G3/3:0.5 C4/2:0.5 E4/1:0.5 C3/5:0.5 G3/3:0.5 C4/2:0.5 E4/1:0.5 | " +
      "G2/5:0.5 D3/3:0.5 G3/2:0.5 B3/1:0.5 G2/5:0.5 D3/3:0.5 G3/2:0.5 B3/1:0.5 | " +
      "A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 | " +
      "F2/5:0.5 C3/3:0.5 F3/2:0.5 A3/1:0.5 F2/5:0.5 C3/3:0.5 F3/2:0.5 A3/1:0.5 | " +
      "G2/5:0.5 D3/3:0.5 G3/2:0.5 B3/1:0.5 G2/5:0.5 D3/3:0.5 G3/2:0.5 B3/1:0.5 | " +
      "A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5",
  },
  {
    id: "study-open-fifths",
    title: "Estudio 2 · Quintas abiertas",
    composer: "Estudio original de Arpeggio",
    level: 6,
    bpm: 66,
    beats: 3,
    beatType: 4,
    sharps: -1,
    tip: "Un bemol en la armadura (SI♭). La izquierda abre la mano hasta la décima: no estires, mueve el brazo entero.",
    startPosition: { right: 74 },
    right:
      "D5/1:2 F5/3:1 | D5/1:3 | C5/3:2 A4/1:1 | A4/1:3 | " +
      "F5/3:2 A5/5:1 | G5/4:3 | E5/2:2 D5/1:1 | D5/1:3",
    left:
      "D2/5:0.5 A2/3:0.5 D3/2:0.5 F3/1:0.5 D3/2:0.5 A2/3:0.5 | " +
      "Bb1/5:0.5 F2/3:0.5 Bb2/2:0.5 D3/1:0.5 Bb2/2:0.5 F2/3:0.5 | " +
      "F2/5:0.5 C3/3:0.5 F3/2:0.5 A3/1:0.5 F3/2:0.5 C3/3:0.5 | " +
      "C2/5:0.5 G2/3:0.5 C3/2:0.5 E3/1:0.5 C3/2:0.5 G2/3:0.5 | " +
      "D2/5:0.5 A2/3:0.5 D3/2:0.5 F3/1:0.5 D3/2:0.5 A2/3:0.5 | " +
      "Bb1/5:0.5 F2/3:0.5 Bb2/2:0.5 D3/1:0.5 Bb2/2:0.5 F2/3:0.5 | " +
      "F2/5:0.5 C3/3:0.5 F3/2:0.5 A3/1:0.5 F3/2:0.5 C3/3:0.5 | " +
      "D2/5:0.5 A2/3:0.5 D3/2:0.5 F3/1:0.5 D3/2:0.5 A2/3:0.5",
  },
  {
    id: "study-nocturne",
    title: "Estudio 3 · Nocturno",
    composer: "Estudio original de Arpeggio",
    level: 6,
    bpm: 58,
    beats: 4,
    beatType: 4,
    sharps: 1,
    tip: "Estilo nocturno: izquierda muy ancha y suave, derecha cantando por encima. Prepara el terreno para Chopin de verdad.",
    right:
      "B4/1:2 E5/4:1.5 D5/3:0.5 | E5/2:3 F#5/3:1 | G5/4:2 F#5/3:1 E5/2:1 | F#5/3:4 | " +
      "B4/1:2 E5/4:1.5 D5/3:0.5 | E5/2:3 G5/4:1 | F#5/4:2 D#5/2:1 F#5/4:1 | E5/3:4",
    left:
      "E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 | " +
      "A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 | " +
      "E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 | " +
      "B2/5:0.5 F#3/3:0.5 B3/2:0.5 D#4/1:0.5 B2/5:0.5 F#3/3:0.5 B3/2:0.5 D#4/1:0.5 | " +
      "E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 | " +
      "A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 A2/5:0.5 E3/3:0.5 A3/2:0.5 C4/1:0.5 | " +
      "B2/5:0.5 F#3/3:0.5 B3/2:0.5 D#4/1:0.5 B2/5:0.5 F#3/3:0.5 B3/2:0.5 D#4/1:0.5 | " +
      "E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5 E2/5:0.5 B2/3:0.5 E3/2:0.5 G3/1:0.5",
  },
];

/** Look a song up by its slug. */
export function songById(id: string): Song | undefined {
  return SONGS.find((s) => s.id === id);
}

/** Display names for the difficulty tiers (Spanish UI copy). */
export const LEVEL_NAMES: Record<Level, string> = {
  1: "Primeros pasos",
  2: "Melodías completas",
  3: "Primeras piezas clásicas",
  4: "Repertorio clásico",
  5: "Grandes obras",
  6: "Camino al neoclásico",
};

/** What each tier teaches — shown under its heading so the path is explicit. */
export const LEVEL_GOALS: Record<Level, string> = {
  1: "Cinco dedos sobre DO-RE-MI-FA-SOL, sin teclas negras y sin mover la mano.",
  2: "Cambios de posición, ritmos con puntillo, compás de 3/4 y un bajo sencillo.",
  3: "Las dos manos a la vez, teclas negras y armadura.",
  4: "Bach y Dvořák tal como se escribieron: melodías largas y voces independientes.",
  5: "Arpegios continuos y tresillos. Aquí ya estás tocando piezas de concierto.",
  6: "Arpegios abiertos bajo una melodía lenta: la mecánica del piano neoclásico.",
};
