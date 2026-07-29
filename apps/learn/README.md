# Arpeggio Learn

The mobile app for someone who has never played the piano. Ten public-domain
pieces, ordered from easiest to hardest, with the notation scrolling under a
fixed playhead — and an on-screen keyboard, so the whole thing works with
nothing but a phone.

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

TensorFlow.js (1.9 MB) is behind a dynamic import: it is fetched only when you
start a microphone session on a piece that actually has chords.

## Adding a song

Songs live in `packages/song-library/src/songs.ts`, written in a compact text
notation — one line per hand:

```
C4 C4 G4 G4 | A4 A4 G4:2 | F4 F4 E4 E4 | D4 D4 C4:2
```

`C4` is a quarter note, `:2` sets the duration in quarter-note beats, `r:2` is a
rest, `C3+E3+G3:4` is a chord, and `|` closes a bar. **Every bar is checked
against the time signature at parse time**, so a mistyped duration fails
`npm test` instead of quietly desynchronising the follower.

Only public-domain music, please: traditional tunes, or composers dead more than
a century.
