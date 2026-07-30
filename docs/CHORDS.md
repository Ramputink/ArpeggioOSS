# Two keys at once: how the app actually detects a chord

This is the hardest thing the app does, and the path is different depending on
where the notes come from. Written out because "it detects chords" is not an
answer — the interesting part is _which component knows what, and when_.

## The two sources are not comparable

|              | On-screen keyboard                                | Microphone                                     |
| ------------ | ------------------------------------------------- | ---------------------------------------------- |
| What arrives | Two `pointerdown` events, exact pitch, exact time | A waveform: the _sum_ of two vibrating strings |
| Ambiguity    | None                                              | Total — the two pitches have to be recovered   |
| Latency      | ~0 ms                                             | 90–200 ms                                      |
| Who decides  | The browser                                       | MOTOR 1 + MOTOR 2 + the combiner               |

Everything below the input layer is shared: both end up as `DetectedNote[]`, and
the follower cannot tell them apart.

## Path 1 — the on-screen keyboard (multi-touch)

Genuinely simple, and worth saying so rather than dressing it up.

`KeyboardView` puts one `pointerdown` listener on the container, not one per key.
Pointer events are already multi-touch: two fingers produce two events with
different `pointerId`s, and the browser tracks them independently. Each becomes a
`DetectedNote` with `confidence: 1` and goes to the follower.

The one subtlety is `setPointerCapture` per finger, so a finger that slides off
its key still counts as holding that key — and it is wrapped in a `try`, because
capture throws for a synthetic pointer id and a key that refuses to sound would
be a worse bug than a key that cannot be slid off.

**Verified in the browser:** two pointers down in the same task on RE2 + FA♯5
(the first chord of the Canon) advance the cursor; one alone does not.

## Path 2 — the microphone

### Why MOTOR 1 cannot do it, ever

YIN estimates _a_ fundamental frequency by autocorrelation. It is monophonic by
construction: given two notes it returns one pitch, or garbage, or nothing. This
is not a tuning problem, so no threshold fixes it. What it does report is
suggestive — a chord smears the autocorrelation, so energy stays high while the
voiced probability sags — and the combiner uses exactly that as a hint.

### Why MOTOR 2 is not simply always on

Basic Pitch is a neural network over ~2 seconds of audio. It is roughly two orders
of magnitude more expensive than YIN and it needs that much context, so running it
on every window would cost both battery and latency on a phone. It is invoked _on
demand_.

### The combiner decides, and one rule is special

`Combiner.combine()` evaluates four rules per frame:

| Rule                  | Trigger                                       | Debounced? |
| --------------------- | --------------------------------------------- | ---------- |
| (a) **structural**    | the score says a chord is due here            | **no**     |
| (b) low confidence    | YIN's voiced probability < `thetaLow`         | yes        |
| (c) disagreement      | YIN's pitch matches none of the expected ones | yes        |
| (d) loud but unstable | high energy, only moderate confidence         | yes        |

Rules (b)–(d) are guesses about a noisy signal, so a single frame must not flip
the engine: they require `hysteresisFrames` (3) consecutive frames before the
decision changes, and again before it relaxes back.

**Rule (a) is the one that matters here, and it does not wait.** The score is
authoritative: if the piece says DO+MI sound together at this position, MOTOR 2 is
called on the very first frame. So for the pieces in the library, chord detection
never depends on inferring that a chord happened — the app already knows one is
coming and listens accordingly. Rules (b)–(d) only exist for the case where the
learner plays something the score did not predict.

### What MOTOR 2 returns, and the two traps in it

`BasicPitchDetector` keeps a rolling 2-second buffer at the microphone's native
rate, resamples it to 22 050 Hz (Basic Pitch is fixed at that rate and does _not_
resample), runs the model, and converts frames to notes. Two things it has to get
right:

- **Idempotence per window.** `PracticeSession.listen` runs the combiner once per
  _frame_, so a four-frame window asks MOTOR 2 four times with the same audio.
  Both real detectors memoise on the frames array identity, which is why running
  the model four times per window never happens. A test fake that ignored this
  modelled something impossible and produced a false failure — the fake was fixed,
  not the code.
- **Presence, not onsets.** A held chord appears in every window while it sounds.
  Deduplicating by onset time breaks once the true onset scrolls out of the
  rolling buffer, and the chord starts re-firing for ever. So a pitch is emitted
  only on the transition into the currently-sounding set.

## What the follower does with two notes

`groupChords()` collapses expected notes whose onsets are within 1e-3 beats into
one **position**. The cursor waits on a position, not on a note.

`FollowYouFollower` keeps a `matched` set for the current position and advances
only when `ceil(group.length × chordFraction)` tones have arrived — with
`chordFraction` defaulting to 1, that means **all of them**.

Three consequences worth being explicit about:

1. **A half-played chord is credited but does not advance.** You get a `correct`
   event for the note you played — the key flashes, the sparks fire — while
   `state.index` does not move, because the index counts _completed_ expected
   notes and a position is all-or-nothing.
2. **The two notes do not have to arrive together.** This is the normal case, not
   the exception: two keys pressed "simultaneously" on a real piano are tens of
   milliseconds apart, and a window is 186 ms, so they may or may not land in the
   same one. `matched` persists across windows until the position clears, so a
   deliberately broken chord completes too. In wait mode there is no time limit on
   this at all — which is the intended forgiveness.
3. **A tone repeated within the same chord counts once.** A sustained note is
   re-reported window after window and must not be able to complete a chord alone.

In **a-tempo** mode none of this applies: `ATempoJudge` gives every expected note
its own deadline and grades each independently, so two notes of a chord are simply
two slots due at the same instant.

## The bug this review found

A-tempo mode over the microphone judged **nothing**. `Runner` was ignoring the
engine's callbacks in a-tempo mode — correctly, since the waiting follower's
verdict is not what a clock-graded mode wants — but nothing was feeding the
detections to `ATempoJudge` instead. The clock ran, every deadline expired, and
the whole piece scored as missed.

The fix is a new `SessionOptions.onDetections` hook: the notes heard in each
window, before the follower judges them. It is the only way for a caller that
grades differently to see them, and it is now covered by a test.

## What is verified, and what is not

Verified headlessly (`packages/practice-engine/test/chords.test.ts`, 9 tests):
structural escalation on the first frame, hysteresis on the soft rules, a loud
smeared frame escalating, a clean single note staying on the cheap engine, a
half chord not advancing, a full chord advancing once, a repeated tone counting
once, `onDetections` firing, and a chord completing across windows.

Verified in a browser: multi-touch chords on the on-screen keyboard; and,
separately, the real Basic Pitch model transcribing a synthetic C–E–G triad.

**Not verified: a real piano.** Two keys struck on real strings, in a real room,
with a sustain pedal down, through a phone microphone. Everything above says the
machinery is right; only that says it works. `docs/MUSIC-STAND.md` lists what to
measure, and the microphone check in the app exists to make that session
diagnosable rather than mysterious.
