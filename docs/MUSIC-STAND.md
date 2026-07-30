# Practising at a real piano — what has to change

Everything shipped so far assumes a phone **in your hands**: you tap the
on-screen keyboard, you look at the screen from 30 cm, you have both thumbs
free. Put the same phone on a piano's music desk and almost every one of those
assumptions breaks:

| Held in the hand                         | Propped on the music desk                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| 30 cm reading distance                   | 50–70 cm — everything needs to be roughly twice the size                                     |
| Both thumbs free                         | **Hands are on the keys.** Two taps before, one after. That is the entire interaction budget |
| The on-screen keyboard is the instrument | It is 152 px of dead weight — and a feedback path into the microphone                        |
| A short session, screen awake            | Twenty minutes, and the screen locks itself                                                  |
| Judging a tap is exact and instant       | Judging audio has latency, octave errors, pedal smear and room noise                         |

This document is the plan for closing that gap. It is ordered by whether the app
is _broken_, _uncomfortable_, or _not yet teaching enough_ — not by how
interesting the work is.

Current state, verified in the code rather than assumed:

- `MicSource` already requests the raw signal (`echoCancellation`,
  `noiseSuppression` and `autoGainControl` all off). That part is right.
- `ThresholdCalibrator` exists and runs **inside** `PracticeSession`, but neither
  app surfaces it: there is no level meter, no noise-floor check, no "did we hear
  that?" step.
- `DtwFollower` is fully built in `packages/practice-engine/src/follower/dtw.ts`
  and **is not referenced anywhere** — not by `PracticeSession`, not by either app.
- There is no Wake Lock anywhere.
- Fingering does not exist in the data model at all.
- `Runner.press()` calls `synth.noteOn()` _before_ checking the mode, so the
  on-screen keyboard sounds in microphone mode too.

---

## Phase 0 — Blockers: it does not work at a piano today

**1. The screen goes to sleep.** Nothing requests a wake lock, so the phone locks
mid-piece and the session is over. `navigator.wakeLock.request("screen")` on
entering the play screen, released on leaving, and re-acquired on
`visibilitychange` (iOS drops the lock when the tab is backgrounded). Small fix,
total blocker.

**2. The on-screen keyboard is worse than useless in microphone mode.** It takes
152 px that the notation needs, and tapping it makes sound that the microphone
will hear and try to transcribe. Fix both halves: hide the keyboard when the mode
is `mic` (and give the space to the staff), and make `Runner.press()` refuse to
sound the synth outside `keys` mode.

**3. There is no microphone setup step.** Before the first note the learner needs
to know the app can hear the piano _at all_. A short calibration screen:

- a live input-level meter, with "too quiet" and "clipping" states;
- "toca un DO" → we confirm we heard C, and at which octave, which simultaneously
  verifies the mic, the room and that the piano is roughly in tune;
- noise-floor capture with the room silent, feeding `silenceEnergy`;
- remember the result per device.

`ThresholdCalibrator` already computes this — it just needs a screen. Without it
a failed session is indistinguishable from "this app does not work".

**4. Latency is unmeasured, and probably visible.** The chain today is: mic →
2048-sample frames (46 ms at 44.1 kHz) → 4-frame windows (186 ms) → YIN per
frame; and for chords, Basic Pitch over a **2-second rolling buffer with
inference on the main thread**. Nobody has measured what that adds up to on a
phone. Work: measure it against a click track, set a budget (target under 120 ms
from key to cursor), then attack it — a 2-frame window for the monophonic path,
MOTOR 2 moved to a Web Worker, and advancing the cursor on the _onset_ rather
than on the combiner's settled decision.

**5. Nothing recovers when the player is lost.** Real practice means stopping,
restarting from the middle, repeating one bar. The follow-you cursor waits
forever on the note you skipped, so the session is dead until you press stop.
`DtwFollower` is built and idle: wire it as a recovery path — after N seconds
with no match, re-align the last few seconds of audio against a window of the
score and jump the cursor to wherever the player actually is.

**6. Octave errors are reported as plain mistakes.** Playing the right note in the
wrong octave is the most common beginner error at a real keyboard, and today it
counts as "wrong" with no explanation. It should say _"correcto, pero una octava
más abajo"_, and be gradeable separately.

---

## Phase 1 — Comfort: the music-desk layout

**7. A distinct "modo atril".** Not a tweak of the current screen: no keyboard,
notation at roughly twice the size, one very large cue, and exactly three
controls — empezar, parar, repetir — as thumb-sized targets in the corners where
a hand can reach without leaving the keys. Landscape first.

**8. Notation has to get much bigger.** The staff-space cap is 22 px, chosen for a
393 px phone in the hand. In music-stand mode it should go to ~34 px, and
landscape — which today leaves the staff only **166 px** of height, measured —
gets around 300 px once the keyboard is gone.

**9. An audible metronome during the piece.** The count-in exists; the click
during play does not. At a real piano the click is the thing that fixes rhythm,
and it is a handful of lines given `Synth.click()`.

**10. Section loop and tempo ramp.** The two mechanics that actually build a
piece: mark bars 5–8, loop them until clean, then take the whole thing 10 %
faster. `StudentModel.recommendPractice()` already knows which bars are weak — at
the moment we only print them as a sentence on the result sheet.

**11. Two honest practice modes.** _Espera_: the cursor waits for you (what we
have, and right for a beginner). _Tempo_: the cursor keeps going and grades you
against the clock. Only the second one tells the truth about rhythm, and a
learner needs to graduate to it.

**12. Page view as an alternative to scrolling.** Two to four bars as a static
system with a moving cursor, turning like a page. Scrolling is the right choice
for someone who cannot read yet; a fixed system is how you learn to read _ahead_,
which is the actual skill.

**13. Let the app play the other hand.** "Left hand only" exists, but the
accompaniment stays silent. Having the app play the part you are not practising
is both motivating and nearly free — the synth and the timeline are already there.

---

## Phase 2 — Teaching value

**14. Fingering.** Absent from the model entirely, and arguably the single most
valuable missing thing for a beginner at a real piano: without a finger number,
"play a G" is ambiguous and builds bad habits. Extend the notation (`C4/1`), add
it to `NoteEvent`, and draw the digit above the head.

**15. A hand-position guide per piece.** Where the hand starts, which finger on
which key, as a diagram — shown before the first attempt, not buried in a tip
string.

**16. Dynamics and pedal.** The canonical model has neither. Needed before levels
5–6 mean anything musically: the Moonlight opening without _pianissimo_ and
without the pedal is not the Moonlight opening.

**17. Timing feedback that is already being thrown away.** The follower computes
`timingErrorSec` on every correct note and nothing consumes it. A subtle
early/late indicator, and a per-bar timing score, cost almost nothing.

**18. Session structure.** Warm-up → the bars the student model says are weak →
the whole piece, in ten minutes. And count **minutes practised**, which is what
actually correlates with progress, alongside notes played.

**19. Import verified scores.** The path to real Chopin: a MusicXML file from a
public-domain edition, rather than notes transcribed from memory.

---

## What to measure before committing to any of it

These are unknowns, not decisions — and the first three need a real piano and a
real device, which no amount of desk work replaces:

- **End-to-end latency** on an iPhone, against a click track.
- **Whether Basic Pitch keeps up in real time in Safari.** The model is tiny
  (17 k parameters) and runs comfortably through Core ML; through WASM/WebGL in a
  mobile browser it is an open question. If it does not, chord detection needs
  either a Worker, a smaller hop, or the native path.
- **Sustain pedal.** Held pedal smears note offsets and blurs onsets. The
  presence-based dedup in `BasicPitchDetector` was designed for clean synthetic
  chords; a pedalled arpeggio may look like one long chord.
- **Room and instrument.** Reverb, a piano that is 20 cents flat, and a phone
  microphone 60 cm from the strings.
- **Whether the device is big enough at all.** Reading notation at 60 cm may
  simply want an iPad, in which case the tablet layout stops being optional.

## Suggested order

| Phase | Work                                                                                      | Why first                                                     |
| ----- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| A     | Wake lock · hide keyboard + mute synth in mic mode · music-stand layout · bigger notation | Cheap, and without them nothing else can be tested at a piano |
| B     | Microphone calibration screen · octave-tolerant feedback                                  | Makes microphone mode diagnosable instead of mysterious       |
| C     | Measure latency · MOTOR 2 in a Worker · advance on onset                                  | Decides whether real-time chord following is viable at all    |
| D     | Metronome · section loop · tempo ramp · tempo mode                                        | The mechanics that turn playing into practising               |
| E     | Fingering in the model and on the staff                                                   | The biggest teaching gap                                      |
| F     | DTW re-sync · page view · session structure · MusicXML import                             | Depth, once the fundamentals hold                             |
