# Arpeggio Learn

The mobile app for someone who has never played the piano. A curriculum of
public-domain pieces from "three fingers on DO" to Bach and Beethoven, with the
notation scrolling under a fixed playhead — and an on-screen keyboard, so the
whole thing works with nothing but a phone.

The six tiers are a path, not a rating; each exists to teach what the next one
assumes:

| Tier                         | Teaches                                         | Pieces                                                          |
| ---------------------------- | ----------------------------------------------- | --------------------------------------------------------------- |
| 1 · Primeros pasos           | Five fingers on C, no black keys                | Twinkle, Mary Had a Little Lamb, Ode to Joy, Jingle Bells       |
| 2 · Melodías completas       | Hand shifts, dotted rhythms, 3/4, a simple bass | Au clair de la lune, Frère Jacques, London Bridge, Silent Night |
| 3 · Primeras piezas clásicas | Two hands, black keys, key signatures           | Für Elise, Canon in D, Bach's Minuet (first phrase)             |
| 4 · Repertorio clásico       | Long melodies, independent voices               | Dvořák's Largo, Bach's Minuet in G, the Prelude's opening       |
| 5 · Grandes obras            | Continuous arpeggios, triplets                  | Bach's Prelude in C, Moonlight Sonata (opening)                 |
| 6 · Camino al neoclásico     | Wide broken-chord left hand under a sung melody | Three original studies                                          |

Level 6 is written for this app rather than transcribed: modern neoclassical
piano is under copyright, so instead of shipping someone else's piece we teach
its machinery. Where a left hand is a simplification of the original (Bach's
Minuet), the song's tip says so.

Two of the tiers open with a **bridge**: the Minuet's first phrase at level 3 and
the Prelude's first two bars at level 4, slower and half the length. They are the
same notes with the same fingering as the full pieces that follow, so nothing has
to be unlearnt — they exist because those were the two steepest steps in the
curriculum.

**Every note carries a fingering**, and pieces whose hand stays put also say where
to put it before the first note ("pulgar derecho en DO4"), lighting the five keys
on the on-screen keyboard. Pieces whose hand moves say nothing rather than
inventing a position.

Alongside the repertoire there are **generated technique exercises** — five-finger
patterns, contrary motion, broken chords and one-octave scales, in several keys.
They are computed from a few parameters rather than written out, so the fingering
cannot drift out of step with the notes and a new key is one line.

It is a static PWA: no account, no backend, no network after the first load.

## Run it on your phone

```bash
npm install                       # from the repo root, once
npm run build                     # builds every workspace
npm run share -w @arpeggio/learn  # serves dist/ over HTTPS on your LAN
```

The command prints a `https://192.168.x.x:5174` URL — open it on a phone on the
same Wi-Fi. The certificate is self-signed and generated into `.cert/` on first
run, so the phone shows a "not private" warning once: **Advanced → Visit
anyway**. Then use _Share → Add to Home Screen_ to install it; it launches full
screen and keeps working offline.

HTTPS is not a nicety here: browsers only grant microphone access and only allow
home-screen installation in a secure context, and `http://192.168.x.x` is not
one. For quick desktop iteration `npm run dev -w @arpeggio/learn` serves plain
HTTP on `:5174` (screen-keyboard practice works; the microphone does not).

## How to practise

Two independent choices. **Input:**

| Mode               | What it does                                                                                    |
| ------------------ | ----------------------------------------------------------------------------------------------- |
| **En la pantalla** | Tap the on-screen keys. They sound, and they are judged exactly like a real performance.        |
| **Mi piano**       | Listens through the microphone (MOTOR 1 = YIN; MOTOR 2 = Basic Pitch when the part has chords). |
| **Escuchar**       | The app plays the piece so you can hear it and follow the notation.                             |

**Judging:**

| Mode          | What it does                                                                                                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ |
| **Te espera** | The cursor waits on every note. Forgiving, and says nothing about rhythm — right for reading a piece for the first time. |
| **A tempo**   | The cursor keeps going at the tempo and grades you early/late/missed. The honest mode, and the one to graduate to.       |

Wait mode is the "follow-you" follower from `@arpeggio/practice-engine`; a-tempo
grading is `aTempo.ts`, and a learner who restarts from the middle is found again
by the DTW aligner rather than leaving the cursor stuck.

## At a real piano — "modo atril"

Put the phone on the music desk and turn on **Modo atril** (the ⏶ button on the
play screen, or Ajustes). It changes the assumptions rather than the styling:

- **no on-screen keyboard** — it is dead weight when your hands are on the keys,
  and a path from the speaker back into the microphone;
- **notation about twice the size** (staff space 34 px instead of 22), because you
  are reading from 60 cm, not 30;
- **four controls big enough to hit without looking** — Pausa, Repetir, Bucle,
  Parar (the same transport is on screen in the hand, just compact);
- **the screen stays awake** (`wakeLock.ts`), which is a total blocker otherwise:
  the phone locks mid-piece and you cannot tap to wake it;
- **landscape first**, which is how a music desk holds a phone and where the staff
  gets its width.

Also for a real instrument: **Comprobar el micrófono** in Ajustes shows a live
input meter, asks you to play a DO to confirm what it hears, measures the room's
noise floor, and reports the measured latency — so a session that fails is
diagnosable instead of mysterious. See
[`docs/MUSIC-STAND.md`](../../docs/MUSIC-STAND.md) for the reasoning and
[`docs/NATIVE-IOS.md`](../../docs/NATIVE-IOS.md) for when a native app would be
worth it (and the measurement that decides).

## Practice tools

- **Metrónomo** — clicks on every beat, scheduled on the audio clock so it does
  not drift. Deliberately pitched at 1976/2637 Hz, above YIN's 1500 Hz search
  range, so a click leaving the speaker is not transcribed as a note.
- **Bucle** — drill the bars the student model rates weakest (or the bar you are
  on). A loop is run as a piece in its own right, so the follower, the staff and
  the progress bar need no special cases.
- **Pausa** — in every mode. At a piano you stop constantly, and before this the
  only way out threw the run away. A paused demo is re-scheduled from the beat it
  had reached, because Web Audio cannot un-schedule a note.
- **La app toca la otra mano** — practise one hand and hear the piece. Driven by
  the cursor rather than a clock, so in "te espera" mode it waits with you. Off
  over a microphone by construction: the speaker feeds back into the mic and the
  detector cannot tell the app's notes from the piano's.
- **Rampa de tempo** — after a clean run, take the same piece 10 % faster.
- **Vista de página** — a static system with a moving cursor instead of continuous
  scrolling: how you learn to read _ahead_.
- **Sesión de 10 min** — warm up, fix what is failing, then something new, in that
  order, planned from your own history (`session.ts`).
- **Importar partitura** — a `.musicxml` **or `.mxl`** file from a public-domain
  edition appears under "Mis partituras" and plays like any built-in piece.
  Compressed `.mxl` is what MuseScore, Sibelius and Finale export by default, and
  it is read with a small zip reader rather than a dependency (`mxl.ts`).
- **Minutos de práctica** — counted only while the practice screen is actually in
  front of you: paused with the tab, paused with the piece, and capped per
  unbroken stretch, so the one number that means effort is not inflated by a phone
  left face-up on the piano.

## Target device

The layout is designed against an **iPhone 15 Pro**: a 393 × 852 CSS viewport,
with a 59 px Dynamic Island inset at the top and a 34 px home-indicator inset at
the bottom when installed to the home screen. Everything else scales from there.

Safe areas go through four custom properties (`--safe-top` and friends) rather
than `env()` at each use site, which is what makes that budget checkable — set
them by hand and the layout can be inspected at any device's insets:

```js
document.documentElement.style.setProperty("--safe-top", "59px");
document.documentElement.style.setProperty("--safe-bottom", "34px");
```

On that screen the play column comes out as 59 inset + 58 bar + 3 progress +
**500 staff** + 46 cue + 152 keys + 34 inset. The staff getting the largest share
is the point: it is the thing being read.

Two consequences worth knowing about:

- **White keys have a 32 px floor**, not the 44 px Apple suggests for discrete
  controls. A piano key is 150 px tall and flush with its neighbours, so it is
  aimed at like a letter on the iOS keyboard. At 32 px the phone shows twelve
  keys instead of nine, which is the difference between seeing both hands' next
  keys and not.
- **Horizontal scale follows the shortest note in the piece**, so a bar of
  sixteenths scrolls faster rather than overlapping its own note heads, and a
  piece of quarter notes stays spacious. Likewise the clef/key-signature gutter is
  sized from its contents: a fixed gutter wide enough for four sharps would eat a
  third of the screen on a piece in C major.

When a piece genuinely cannot fit — Für Elise spans three and a half octaves —
the setup sheet says so instead of letting the learner discover it mid-bar.

## Architecture

```
song-library ──(Score)──► main.ts ──► StaffView   (canvas notation, scrolling)
                             │      └► KeyboardView (DOM keys, multi-touch)
                             ▼
                          Runner ──► FollowYouFollower      (screen keys / demo)
                                 └─► LivePractice → PracticeSession (microphone)
```

- `staff.ts` draws the notation from the score model — note heads, stems, flags,
  dots, ledger lines, accidentals, key signature, bar lines. No engraving
  library and no music font: only the small subset a beginner meets, which is
  what lets it scroll at 60 fps on a phone.
- `keyboard.ts` is DOM, not canvas, so multi-touch chords come free from pointer
  events.
- `runner.ts` is the only place that knows which input mode is active; the staff
  and keyboard are driven from one progress callback in all three cases.
- `synth.ts` is a three-partial Web Audio voice — enough to hear pitch.
- `effects.ts` holds the rewards: a particle pool that renders inside the staff
  canvas, and DOM confetti for the result sheet.
- `gamification.ts` is levels, XP and the seventeen achievements — pure
  functions over a `Stats` object, so it is fully unit-tested and can be retuned
  without touching the practice loop.
- `icons.ts` is the icon set as inline SVG. No emoji anywhere in the UI: emoji
  render differently on every platform, cannot follow the theme, and read as a
  placeholder rather than as a product.

See [`docs/ANIMATIONS.md`](../../docs/ANIMATIONS.md) for the animation and
progression design, and for what is planned next (waterfall mode, hand
colouring, section loops).

## Tests

```bash
npm test -w @arpeggio/learn
```

Twenty tests over the parts that are pure and worth pinning down: the XP curve
and level thresholds, achievement progress and unlock diffing, note spelling on
the staff (an accidental must sit on its natural letter's line), and beam
grouping (one beam per beat, broken by rests, long notes and chords). The canvas
and audio layers are verified in the browser instead.

TensorFlow.js (1.9 MB) is behind a dynamic import: it is fetched only when you
start a microphone session on a piece that actually has chords.

## Adding a song

Songs live in `packages/song-library/src/songs.ts`, written in a compact text
notation — one line per hand:

```
C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2
```

`C4` is a quarter note, `:2` sets the duration in quarter-note beats, `:1/3` is
a triplet eighth, `C4/1` adds a finger, `r:2` is a rest, `C3+E3+G3:4` is a chord,
and `|` closes a bar. **Every bar is checked against the time signature at parse
time**, so a mistyped duration fails `npm test` instead of quietly
desynchronising the follower — and so does a note with no fingering.

Only public-domain music, please: traditional tunes, or composers dead more than
a century. The full walkthrough is in
[`CONTRIBUTING.md`](../../CONTRIBUTING.md).
