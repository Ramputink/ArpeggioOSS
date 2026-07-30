# What to improve next

Ordered by honest expected value, not by how interesting the work is.

The first item is not one of several priorities. It dominates the list, and until
it is done the rest of the ordering is guesswork.

---

## 0. One hour at a real piano

**Every claim the app makes about its core feature is still unverified.**

What has been proven: the engine follows a score, the combiner escalates to
MOTOR 2 on a scored chord, Basic Pitch transcribes a synthetic triad, multi-touch
chords work on the on-screen keyboard, ~148 tests pass. What has never happened:
two keys struck on real strings, in a room with reverberation, with the sustain
pedal down, through a phone microphone a metre away.

Four unknowns, all measurable in one sitting, all with the instrumentation
already in the app:

| Measure                                | With                                             | Decides                                                                     |
| -------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------- |
| Latency p50/p95, single notes          | Ajustes → Comprobar el micrófono, then a mic run | Whether a-tempo over the microphone is honest at all (`docs/NATIVE-IOS.md`) |
| The same with a chord piece            | Canon in D, both hands                           | Whether Basic Pitch keeps up in real time in Safari                         |
| Chord recall with the pedal down       | Canon, pedal held through a bar                  | Whether presence-based dedup survives a smeared decay                       |
| Whether `chordFraction: 1` is playable | Any chord piece                                  | Whether every tone of a chord can be required (item 1.1)                    |

**Each outcome implies different work**, which is exactly why guessing is a bad
idea:

- Latency fine, chords recognised → the app is fundamentally done for its purpose;
  spend everything on repertoire and pedagogy.
- Latency fine, chords missed → tune MOTOR 2 (`onsetThresh`, `frameThresh`,
  `chordFraction`), which is cheap.
- Latency bad and jittery → a-tempo over the microphone cannot be honest on the
  web, and the native audio bridge becomes real work rather than a hypothesis.

---

## 1. Still open

**1.1 `chordFraction` is 1 — every tone of a chord is required.** Exactly right for
the on-screen keyboard, possibly brittle through a microphone where Basic Pitch
may miss an inner voice of a three-note chord and park the cursor for ever. It is
already a `FollowYouOptions` knob that `PracticeSession` never exposes. Decide it
with the measurement in item 0, not from an armchair; if it needs relaxing, do it
for microphone input only, since a tapped chord has no excuse.

**1.2 `main.ts` is 1112 lines.** Down from 1292 while gaining pause,
accompaniment, hand placement, `.mxl` import, practice time and session tracking
— roughly 600 lines were extracted into `libraryView`, `resultView`,
`micCheckView`, `copy` and `dom` — but it is still the largest file in the app and
still the place the next bug will hide. Of the remaining seams, the play screen is
genuinely coupled to the run state; the setup sheet is not.

**1.3 The app cannot play the other hand over a microphone.** By construction: the
speaker feeds straight back into the microphone and the detector cannot tell the
app's notes from the piano's. That is the one place accompaniment would be most
useful, and it needs either echo cancellation that does not also destroy the piano
signal, or the native audio bridge.

---

## 2. Notation fidelity — needed before levels 5–6 mean anything

- **Dynamics and pedal are absent from the model.** The Moonlight opening without
  _pianissimo_ and without the pedal is not the Moonlight opening.
- **Ties and slurs are not drawn.** The parser merges tied notes into one event, so
  a tied note renders as a single long one — correct for playing, wrong for
  reading, and confusing next to a printed score.
- **Page view turns pages by jumping.** No animation, and the cursor teleports at
  the boundary. A page turn should be visible and anticipated.
- **One system at a time.** Real reading practice wants two or three lines of music
  on screen at once, which is the difference between following and reading ahead.

---

## 3. Repertoire

**3.1 The library is 19 pieces and 10 generated exercises.** Levels 1–4 are now
fingered throughout and the two worst jumps have bridges (the Minuet's first
phrase at level 3, the Prelude's first two bars at level 4). What it still lacks
is _volume_ at levels 1–2: a beginner exhausts eight pieces in a fortnight.

**3.2 Real Chopin still arrives only through import.** That is the honest path — a
verified public-domain edition beats notes transcribed from memory — and `.mxl`
now works, so it is one file away. What would help is a short list of known-good
sources in the README.

**3.3 The exercises could go further.** The generators cover five-finger patterns,
contrary motion, broken chords and one-octave scales. Two-octave scales, arpeggio
inversions and the remaining keys are each a line in `EXERCISE_SPECS` — except that
every new key needs its fingering checked, which is exactly why F major has no
scale.

---

## 4. Reach

**4.1 The UI is Spanish only.** The dynamic half now lives in `copy.ts`, which is
the seam a translation goes through; the static half is still inline in
`index.html`, and the song titles and tips are in the library data. An English
translation would multiply the potential contributors.

**4.2 Accessibility is a start, not a story.** The canvas has a text alternative
that names the piece and the current bar, and the cue line is `aria-live`. A blind
learner could in principle use this app entirely through those two — but nobody has
tried it, and "in principle" is doing a lot of work in that sentence.

---

## Recommended next milestone

1. **One hour at the piano** with the numbers written down (item 0), because it
   decides 1.1 and 1.3 and re-orders everything else.
2. **More level 1–2 repertoire** — the shallowest part of the library, and the part
   a beginner hits first.
3. **Ties and slurs**, the notation error most likely to confuse someone comparing
   the screen with a printed score.

Then re-read this list, because item 0 will have changed the order.

---

## Done since the last revision

Kept because the reasoning is the useful part, not the tick.

- **Fingering on every note of every piece**, plus a `startPosition` for pieces
  whose hand stays put — and deliberately none for the ones where it does not.
  Both enforced by the test suite.
- **Generated technique exercises**: no copyright question, fingering derived from
  the shape, and a new key is one line.
- **Bridges at the two cliffs** (level 3→4 and 4→5), built from music already in
  the repo rather than transcribed.
- **The app plays the other hand**, driven by the cursor rather than a clock so it
  waits with the learner in wait mode. Not over a microphone; see 1.3.
- **Practice minutes**, counted only while the practice screen is in front of the
  learner, capped per segment, and paused with the tab.
- **The guided session tracks itself** and reports back — including when it was
  abandoned, which it no longer calls "complete".
- **Pause**, in every mode, including re-scheduling a paused demo from the beat it
  had reached.
- **Loop reachable outside music-stand mode**, in a transport bar that is always on
  screen.
- **`.mxl` import** (what MuseScore exports by default), with a ~150-line zip
  reader instead of a dependency.
- **Imported scores can be deleted on a phone** — the old `contextmenu` handler was
  unreachable on iOS, so they could not be removed at all.
- **Key signatures survive import**, carried through the parser rather than assumed
  to be C major.
- **ESLint and Prettier**, enforced in CI alongside the build and the tests.
- **Staff geometry is a pure function** with tests, including one that pins down
  where the key-signature squeeze deliberately gives up.
- **Two stale prototypes moved to `archive/`**, with a note saying what each one
  answered.
