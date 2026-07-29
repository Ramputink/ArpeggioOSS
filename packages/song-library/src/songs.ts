/**
 * The built-in starter library: ten public-domain pieces ordered so a complete
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
 */
import type { Level, Song } from "./types.js";

export const SONGS: Song[] = [
  // --- Level 1 — five-finger C position, right hand -------------------------
  {
    id: "twinkle",
    title: "Estrellita, ¿dónde estás?",
    composer: "Tradicional",
    level: 1,
    bpm: 84,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "Pon los cinco dedos de la mano derecha sobre DO-RE-MI-FA-SOL y no muevas la mano en toda la canción.",
    right:
      "C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2 | " +
      "G4 G4 F4 F4 | E4 E4 D4:2 | G4 G4 F4 F4 | E4 E4 D4:2 | " +
      "C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2",
    left:
      "C3:4 | F3:2 C3:2 | F3:2 C3:2 | G3:2 C3:2 | " +
      "C3:2 F3:2 | C3:2 G3:2 | C3:2 F3:2 | C3:2 G3:2 | " +
      "C3:4 | F3:2 C3:2 | F3:2 C3:2 | G3:2 C3:2",
  },
  {
    id: "mary-lamb",
    title: "María tenía un corderito",
    composer: "Tradicional",
    level: 1,
    bpm: 88,
    beats: 4,
    beatType: 4,
    sharps: 0,
    tip: "Solo usa tres dedos: pulgar en DO, índice en RE y corazón en MI. Es la mejor primera canción.",
    right:
      "E4 D4 C4 D4 | E4 E4 E4:2 | D4 D4 D4:2 | E4 G4 G4:2 | " +
      "E4 D4 C4 D4 | E4 E4 E4 E4 | D4 D4 E4 D4 | C4:4",
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
    tip: "Todo cabe en la posición de cinco dedos salvo el SOL grave del compás 12: baja el meñique un momento y vuelve.",
    right:
      "E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4:1.5 D4:0.5 D4:2 | " +
      "E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2 | " +
      "D4 D4 E4 C4 | D4 E4:0.5 F4:0.5 E4 C4 | D4 E4:0.5 F4:0.5 E4 D4 | C4 D4 G3:2 | " +
      "E4 E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4:1.5 C4:0.5 C4:2",
    left:
      "C3:4 | C3:2 G3:2 | C3:2 G3:2 | C3:2 G3:2 | " +
      "C3:4 | C3:2 G3:2 | C3:2 G3:2 | G3:2 C3:2 | " +
      "G3:2 C3:2 | G3:2 C3:2 | G3:4 | C3:2 G3:2 | " +
      "C3:4 | C3:2 G3:2 | C3:2 G3:2 | G3:2 C3:2",
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
    tip: "Casi todo es MI repetido. Cuidado con el salto MI-SOL-DO del tercer compás: es el único momento en que la mano se abre.",
    right:
      "E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4 D4 | E4:4 | " +
      "F4 F4 F4 F4 | F4 E4 E4 E4:0.5 E4:0.5 | E4 D4 D4 E4 | D4:2 G4:2 | " +
      "E4 E4 E4:2 | E4 E4 E4:2 | E4 G4 C4 D4 | E4:4 | " +
      "F4 F4 F4 F4 | F4 E4 E4 E4:0.5 E4:0.5 | G4 G4 F4 D4 | C4:4",
    left:
      "C3:4 | C3:4 | C3:4 | C3:4 | F3:4 | C3:4 | G3:4 | G3:2 G3:2 | " +
      "C3:4 | C3:4 | C3:4 | C3:4 | F3:4 | C3:4 | G3:4 | C3:4",
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
    tip: "La parte central baja hasta el SOL grave. Practica primero solo esa frase (compases 9 a 12) hasta que salga sin mirar.",
    right:
      "C4 C4 C4 D4 | E4:2 D4:2 | C4 E4 D4 D4 | C4:4 | " +
      "C4 C4 C4 D4 | E4:2 D4:2 | C4 E4 D4 D4 | C4:4 | " +
      "D4 D4 D4 D4 | A3:2 A3:2 | D4 C4 B3 A3 | G3:4 | " +
      "C4 C4 C4 D4 | E4:2 D4:2 | C4 E4 D4 D4 | C4:4",
    left:
      "C3:4 | G2:4 | G2:4 | C3:4 | C3:4 | G2:4 | G2:4 | C3:4 | " +
      "G2:4 | D3:4 | G2:4 | G2:4 | C3:4 | G2:4 | G2:4 | C3:4",
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
    tip: "El compás 5 lleva corcheas: cuenta «1 y 2 y» en voz alta. Es un canon, así que cada frase se repite igual dos veces.",
    right:
      "C4 D4 E4 C4 | C4 D4 E4 C4 | E4 F4 G4:2 | E4 F4 G4:2 | " +
      "G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4 | G4:0.5 A4:0.5 G4:0.5 F4:0.5 E4 C4 | " +
      "C4 G3 C4:2 | C4 G3 C4:2",
    left:
      "C3:4 | C3:4 | C3:2 G2:2 | C3:2 G2:2 | C3:4 | C3:4 | " +
      "C3:1 G2:1 C3:2 | C3:1 G2:1 C3:2",
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
    tip: "La melodía llega al LA, un dedo más allá de la posición de cinco dedos. Deja el pulgar quieto en DO y estira el meñique.",
    right:
      "G4 A4 G4 F4 | E4 F4 G4:2 | D4 E4 F4:2 | E4 F4 G4:2 | " +
      "G4 A4 G4 F4 | E4 F4 G4:2 | D4:2 G4:2 | E4:2 C4:2",
    left: "C3:4 | C3:2 G3:2 | G3:4 | C3:4 | C3:4 | C3:2 G3:2 | G3:4 | C3:4",
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
    tip: "Compás de 3/4: cuenta «1-2-3» lento. El ritmo largo-corto (negra con puntito + corchea) es el alma de esta canción.",
    right:
      "G4:1.5 A4:0.5 G4:1 | E4:3 | G4:1.5 A4:0.5 G4:1 | E4:3 | " +
      "D5:2 D5:1 | B4:3 | C5:2 C5:1 | G4:3 | " +
      "A4:2 A4:1 | C5:1.5 B4:0.5 A4:1 | G4:1.5 A4:0.5 G4:1 | E4:3 | " +
      "A4:2 A4:1 | C5:1.5 B4:0.5 A4:1 | G4:1.5 A4:0.5 G4:1 | E4:3 | " +
      "D5:2 D5:1 | F5:1.5 D5:0.5 B4:1 | C5:3 | E5:3 | " +
      "C5:1 G4:1 E4:1 | G4:1.5 F4:0.5 D4:1 | C4:3",
    left:
      "C3:3 | C3:3 | C3:3 | C3:3 | G2:3 | G2:3 | C3:3 | C3:3 | " +
      "F2:3 | F2:3 | C3:3 | C3:3 | F2:3 | F2:3 | C3:3 | C3:3 | " +
      "G2:3 | G2:3 | C3:3 | C3:3 | C3:3 | G2:3 | C3:3",
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
    tip: "El RE♯ es una tecla negra: usa el dedo 3 y no dejes caer la muñeca. La mano izquierda entra sola, en arpegios de tres notas.",
    right:
      "E5:0.5 D#5:0.5 | " +
      "E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | " +
      "A4:1 r:2 | B4:1 r:2 | C5:1 r:1 E5:0.5 D#5:0.5 | " +
      "E5:0.5 D#5:0.5 E5:0.5 B4:0.5 D5:0.5 C5:0.5 | " +
      "A4:1 r:2 | B4:1 r:0.5 C5:0.5 B4:0.5 A4:0.5 | A4:3",
    left:
      "r:1 | r:3 | A2:0.5 E3:0.5 A3:0.5 r:1.5 | E2:0.5 E3:0.5 G#3:0.5 r:1.5 | " +
      "A2:0.5 E3:0.5 A3:0.5 r:1.5 | r:3 | A2:0.5 E3:0.5 A3:0.5 r:1.5 | " +
      "E2:0.5 E3:0.5 G#3:0.5 r:1.5 | A2:0.5 E3:0.5 A3:0.5 r:1.5",
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
    tip: "Dos sostenidos en la armadura: FA♯ y DO♯ siempre son teclas negras. Todo son blancas (dos tiempos), así que es ideal para coordinar las dos manos.",
    right:
      "F#5:2 E5:2 | D5:2 C#5:2 | B4:2 A4:2 | B4:2 C#5:2 | " +
      "D5:2 C#5:2 | B4:2 A4:2 | G4:2 F#4:2 | G4:2 E4:2",
    left:
      "D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2 | " +
      "D3:2 A2:2 | B2:2 F#2:2 | G2:2 D2:2 | G2:2 A2:2",
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
    tip: "Muy lento y ligado: cada nota tiene que durar hasta que empiece la siguiente. Es la melodía más cantable de todo el repertorio.",
    right:
      "E4:1.5 G4:0.5 G4:2 | E4:1.5 D4:0.5 C4:2 | D4 E4 D4 C4 | A3:2 G3:2 | " +
      "E4:1.5 G4:0.5 G4:2 | E4:1.5 D4:0.5 C4:2 | D4 E4 D4 C4 | C4:4",
    left: "C3:4 | C3:4 | G2:4 | G2:4 | C3:4 | C3:4 | G2:4 | C3:4",
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
    right:
      "D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | " +
      "E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 | " +
      "C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | " +
      "F#4:1 G4:0.5 A4:0.5 B4:0.5 G4:0.5 | A4:3 | " +
      "D5:1 G4:0.5 A4:0.5 B4:0.5 C5:0.5 | D5:1 G4:1 G4:1 | " +
      "E5:1 C5:0.5 D5:0.5 E5:0.5 F#5:0.5 | G5:1 G4:1 G4:1 | " +
      "C5:1 D5:0.5 C5:0.5 B4:0.5 A4:0.5 | B4:1 C5:0.5 B4:0.5 A4:0.5 G4:0.5 | " +
      "A4:1 B4:0.5 A4:0.5 G4:0.5 F#4:0.5 | G4:3",
    left:
      "G2:3 | G2:1.5 D3:1.5 | C3:3 | B2:1.5 G2:1.5 | " +
      "A2:3 | G2:1.5 D3:1.5 | D3:3 | D3:1.5 A2:1.5 | " +
      "G2:3 | G2:1.5 D3:1.5 | C3:3 | B2:1.5 G2:1.5 | " +
      "A2:3 | G2:1.5 D3:1.5 | D3:3 | G2:3",
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
    // Each half bar is one figure: two low notes, then the right hand's six
    // sixteenths. Written out rather than repeated so the follower sees every note.
    right:
      "r:0.5 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25 " +
      "r:0.5 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25 | " +
      "r:0.5 A4:0.25 D5:0.25 F5:0.25 A4:0.25 D5:0.25 F5:0.25 " +
      "r:0.5 A4:0.25 D5:0.25 F5:0.25 A4:0.25 D5:0.25 F5:0.25 | " +
      "r:0.5 G4:0.25 D5:0.25 F5:0.25 G4:0.25 D5:0.25 F5:0.25 " +
      "r:0.5 G4:0.25 D5:0.25 F5:0.25 G4:0.25 D5:0.25 F5:0.25 | " +
      "r:0.5 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25 " +
      "r:0.5 G4:0.25 C5:0.25 E5:0.25 G4:0.25 C5:0.25 E5:0.25",
    left:
      "C3:0.25 E3:0.25 r:1.5 C3:0.25 E3:0.25 r:1.5 | " +
      "C3:0.25 D3:0.25 r:1.5 C3:0.25 D3:0.25 r:1.5 | " +
      "B2:0.25 D3:0.25 r:1.5 B2:0.25 D3:0.25 r:1.5 | " +
      "C3:0.25 E3:0.25 r:1.5 C3:0.25 E3:0.25 r:1.5",
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
    tip: "Cuatro compases de tresillos: tres notas por pulso, sin acentuar ninguna. Cuatro sostenidos en la armadura. Toca muy despacio y muy suave.",
    right:
      "G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 | " +
      "G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3 | " +
      "A3:1/3 C#4:1/3 E4:1/3 A3:1/3 C#4:1/3 E4:1/3 A3:1/3 D4:1/3 F#4:1/3 A3:1/3 D4:1/3 F#4:1/3 | " +
      "G#3:1/3 C4:1/3 F#4:1/3 G#3:1/3 C4:1/3 F#4:1/3 G#3:1/3 C#4:1/3 E4:1/3 G#3:1/3 C#4:1/3 E4:1/3",
    left:
      "C#2+C#3:4 | C#2+C#3:4 | A1+A2:2 F#1+F#2:2 | G#1+G#2:4",
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
    tip: "La izquierda repite un arpegio de cuatro notas mientras la derecha canta notas largas. Es el motor de casi todo el piano neoclásico.",
    right:
      "E5:4 | F5:2 E5:2 | E5:2 G5:2 | D5:4 | " +
      "C5:4 | A4:2 C5:2 | B4:2 D5:2 | A4:4",
    left:
      "A2:0.5 E3:0.5 A3:0.5 C4:0.5 A2:0.5 E3:0.5 A3:0.5 C4:0.5 | " +
      "F2:0.5 C3:0.5 F3:0.5 A3:0.5 F2:0.5 C3:0.5 F3:0.5 A3:0.5 | " +
      "C3:0.5 G3:0.5 C4:0.5 E4:0.5 C3:0.5 G3:0.5 C4:0.5 E4:0.5 | " +
      "G2:0.5 D3:0.5 G3:0.5 B3:0.5 G2:0.5 D3:0.5 G3:0.5 B3:0.5 | " +
      "A2:0.5 E3:0.5 A3:0.5 C4:0.5 A2:0.5 E3:0.5 A3:0.5 C4:0.5 | " +
      "F2:0.5 C3:0.5 F3:0.5 A3:0.5 F2:0.5 C3:0.5 F3:0.5 A3:0.5 | " +
      "G2:0.5 D3:0.5 G3:0.5 B3:0.5 G2:0.5 D3:0.5 G3:0.5 B3:0.5 | " +
      "A2:0.5 E3:0.5 A3:0.5 C4:0.5 A2:0.5 E3:0.5 A3:0.5 C4:0.5",
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
    right:
      "D5:2 F5:1 | D5:3 | C5:2 A4:1 | A4:3 | " +
      "F5:2 A5:1 | G5:3 | E5:2 D5:1 | D5:3",
    left:
      "D2:0.5 A2:0.5 D3:0.5 F3:0.5 D3:0.5 A2:0.5 | " +
      "Bb1:0.5 F2:0.5 Bb2:0.5 D3:0.5 Bb2:0.5 F2:0.5 | " +
      "F2:0.5 C3:0.5 F3:0.5 A3:0.5 F3:0.5 C3:0.5 | " +
      "C2:0.5 G2:0.5 C3:0.5 E3:0.5 C3:0.5 G2:0.5 | " +
      "D2:0.5 A2:0.5 D3:0.5 F3:0.5 D3:0.5 A2:0.5 | " +
      "Bb1:0.5 F2:0.5 Bb2:0.5 D3:0.5 Bb2:0.5 F2:0.5 | " +
      "F2:0.5 C3:0.5 F3:0.5 A3:0.5 F3:0.5 C3:0.5 | " +
      "D2:0.5 A2:0.5 D3:0.5 F3:0.5 D3:0.5 A2:0.5",
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
      "B4:2 E5:1.5 D5:0.5 | E5:3 F#5:1 | G5:2 F#5:1 E5:1 | F#5:4 | " +
      "B4:2 E5:1.5 D5:0.5 | E5:3 G5:1 | F#5:2 D#5:1 F#5:1 | E5:4",
    left:
      "E2:0.5 B2:0.5 E3:0.5 G3:0.5 E2:0.5 B2:0.5 E3:0.5 G3:0.5 | " +
      "A2:0.5 E3:0.5 A3:0.5 C4:0.5 A2:0.5 E3:0.5 A3:0.5 C4:0.5 | " +
      "E2:0.5 B2:0.5 E3:0.5 G3:0.5 E2:0.5 B2:0.5 E3:0.5 G3:0.5 | " +
      "B2:0.5 F#3:0.5 B3:0.5 D#4:0.5 B2:0.5 F#3:0.5 B3:0.5 D#4:0.5 | " +
      "E2:0.5 B2:0.5 E3:0.5 G3:0.5 E2:0.5 B2:0.5 E3:0.5 G3:0.5 | " +
      "A2:0.5 E3:0.5 A3:0.5 C4:0.5 A2:0.5 E3:0.5 A3:0.5 C4:0.5 | " +
      "B2:0.5 F#3:0.5 B3:0.5 D#4:0.5 B2:0.5 F#3:0.5 B3:0.5 D#4:0.5 | " +
      "E2:0.5 B2:0.5 E3:0.5 G3:0.5 E2:0.5 B2:0.5 E3:0.5 G3:0.5",
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
