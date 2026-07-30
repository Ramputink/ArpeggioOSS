# Contributing to Arpeggio OSS

The most useful contribution is a **song**, and it is a ten-line diff. Start
there.

## Adding a song (the easy, high-value one)

Songs live in `packages/song-library/src/songs.ts`, written in a compact text
notation — one line per hand — so a whole piece is readable in a pull request.

```ts
{
  id: "my-piece",                 // stable slug; also the progress key
  title: "Mi pieza",
  composer: "Tradicional",
  level: 2,                       // 1–6, see LEVEL_GOALS at the bottom of the file
  bpm: 96,
  beats: 4, beatType: 4,          // time signature
  sharps: 0,                      // key signature: +sharps, −flats
  tip: "Una frase que le diga al alumno qué es lo difícil de esta pieza.",
  startPosition: { right: 60, left: 48 },   // lowest key under each hand, if it stays put
  right: "C4/1 D4/2 E4/3 C4/1 | C4/1:4",
  left:  "C3/5:4 | C3/5:4",       // optional
}
```

The notation:

| Token        | Meaning                                       |
| ------------ | --------------------------------------------- |
| `C4`         | crotchet (the default duration is one beat)   |
| `F#4:0.5`    | quaver — the duration is in crotchet beats    |
| `Bb3:1.5`    | dotted crotchet                               |
| `E5:1/3`     | triplet quaver (fractions keep tuplets exact) |
| `C4/1`       | with a finger, 1 (thumb) to 5 (little finger) |
| `r:2`        | a two-beat rest                               |
| `C3+E3+G3:2` | a chord — notes sharing one onset             |
| `\|`         | bar line                                      |

**Bar lines are checked.** Every bar must add up to the time signature, so a
mistyped duration fails `npm test` instead of quietly desynchronising the score
follower at runtime. Write them.

**Fingering is not optional.** "Play a G" is not an instruction a hand can
follow, and a beginner who picks the wrong finger has to unlearn it before the
passage can ever go up to speed. The test suite requires a finger on every note.

**`startPosition` only if it is true.** It is the lowest key each hand covers —
the thumb on the right, the little finger on the left. If the hand moves around,
leave it out: a learner who plants their hand where the app said and finds the
music somewhere else trusts it less next time.

**Copyright.** Only public domain: traditional music, or a composer who died more
than 100 years ago. If you want to teach a modern idiom, write an original study
for it — that is what level 6 is.

Then:

```bash
npm test -w @arpeggio/song-library
```

## Adding a technique exercise

Exercises in `packages/song-library/src/exercises.ts` are **generated** from a
few parameters rather than written out, so a new key is one line in
`EXERCISE_SPECS`. A new _kind_ of exercise is a generator function plus an entry
in `KIND_META`. Fingering comes from the shape, so it cannot drift out of step
with the notes.

## Working on the app

```bash
npm install
npm run build          # every package + the two apps
npm test               # ~120 headless tests, no browser needed
npm run lint
npm run dev -w @arpeggio/learn     # http://localhost:5174
npm run share -w @arpeggio/learn   # HTTPS on the LAN, for a real phone
```

The layout:

|                              |                                                     |
| ---------------------------- | --------------------------------------------------- |
| `packages/musicxml-parser`   | MusicXML → the canonical `Score` model              |
| `packages/song-library`      | the built-in repertoire and generated exercises     |
| `packages/practice-engine`   | score following, chord detection, the student model |
| `packages/motor2-basicpitch` | polyphonic transcription (Basic Pitch / TF.js)      |
| `packages/practice-web`      | microphone capture and the live practice loop       |
| `apps/learn`                 | **the product**: the learner PWA                    |
| `apps/web`                   | the lab: OMR import, the MOTOR 2 bench              |
| `archive/`                   | superseded prototypes; nothing builds them          |

## House rules

- **Code and comments in English.** User-facing copy is Spanish and lives in
  `copy.ts`, `index.html` and the song data — grouped that way so a translation
  is one pass rather than a search.
- **Comments say _why_.** What the code does is already there in the code.
- **No emoji in the UI.** The icon set is in `apps/learn/src/icons.ts`.
- **A pure function beats a tested one beats an untested one.** The reason the
  reward layer, the session planner, the a-tempo judge, the practice clock and
  the staff geometry are all pure is that they are the parts where a quiet
  mistake is invisible on screen.
- **Do not claim what has not been verified.** If something has only been tested
  headlessly, say so — `docs/CHORDS.md` is the model for this.

## What needs doing

`docs/ROADMAP.md`, ordered by honest expected value. The first item needs a real
piano and an hour, and it decides the ordering of everything below it.
