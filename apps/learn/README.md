# Arpeggio Learn

The mobile app for someone who has never played the piano. A curriculum of
public-domain pieces from "three fingers on DO" to Bach and Beethoven, with the
notation scrolling under a fixed playhead — and an on-screen keyboard, so the
whole thing works with nothing but a phone.

The six tiers are a path, not a rating; each exists to teach what the next one
assumes:

| Tier | Teaches | Pieces |
|---|---|---|
| 1 · Primeros pasos | Five fingers on C, no black keys | Twinkle, Mary Had a Little Lamb, Ode to Joy, Jingle Bells |
| 2 · Melodías completas | Hand shifts, dotted rhythms, 3/4, a simple bass | Au clair de la lune, Frère Jacques, London Bridge, Silent Night |
| 3 · Primeras piezas clásicas | Two hands, black keys, key signatures | Für Elise, Canon in D |
| 4 · Repertorio clásico | Long melodies, independent voices | Dvořák's Largo, Bach's Minuet in G |
| 5 · Grandes obras | Continuous arpeggios, triplets | Bach's Prelude in C, Moonlight Sonata (opening) |
| 6 · Camino al neoclásico | Wide broken-chord left hand under a sung melody | Three original studies |

Level 6 is written for this app rather than transcribed: modern neoclassical
piano is under copyright, so instead of shipping someone else's piece we teach
its machinery. Where a left hand is a simplification of the original (Bach's
Minuet), the song's tip says so.

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
anyway**. Then use *Share → Add to Home Screen* to install it; it launches full
screen and keeps working offline.

HTTPS is not a nicety here: browsers only grant microphone access and only allow
home-screen installation in a secure context, and `http://192.168.x.x` is not
one. For quick desktop iteration `npm run dev -w @arpeggio/learn` serves plain
HTTP on `:5174` (screen-keyboard practice works; the microphone does not).

## How to practise

Pick a piece, then pick how you will play it:

| Mode | What it does |
|------|--------------|
| **En la pantalla** | Tap the on-screen keys. They sound, and they are judged exactly like a real performance. |
| **Mi piano** | Listens through the microphone (MOTOR 1 = YIN; MOTOR 2 = Basic Pitch when the part has chords). |
| **Escuchar** | The app plays the piece so you can hear it and follow the notation. |

The score **waits for you**. Play the right note and it glides forward; play a
wrong one and the cursor stays put and tells you which key to press. That is the
"follow-you" follower from `@arpeggio/practice-engine` — the same engine the
desktop app and the future iOS build use.

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
a triplet eighth, `r:2` is a rest, `C3+E3+G3:4` is a chord, and `|` closes a
bar. **Every bar is checked against the time signature at parse time**, so a
mistyped duration fails `npm test` instead of quietly desynchronising the
follower.

Only public-domain music, please: traditional tunes, or composers dead more than
a century.
