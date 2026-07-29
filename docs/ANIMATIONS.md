# Animation and progression design — matching (and beating) Simply Piano

What makes Simply Piano feel alive is not one big effect; it is a handful of
small, *musically motivated* ones that all agree with each other. This document
records the principles Arpeggio Learn follows, what is implemented today, and
the ordered plan for the rest.

## Principles

1. **Every animation answers a question the learner is asking.**
   "Where am I?" (playhead), "what next?" (glowing key), "did I get it?"
   (spark), "am I on a roll?" (streak), "how much is left?" (progress bar).
   An animation that answers nothing is noise, and noise on a small screen is
   worse than nothing.
2. **The music drives the clock, not the other way round.** The score scrolls
   because the follower advanced, the count-in ticks at the piece's tempo, the
   waterfall falls at the piece's tempo. Nothing animates at an arbitrary
   duration picked to "feel nice".
3. **Never animate the thing you must read.** Note heads do not bounce or
   scale; they change *colour* and gain a halo. The eye needs a stable target.
4. **60 fps on a five-year-old phone.** One canvas, one `requestAnimationFrame`
   loop, no layout thrash, no per-frame allocation in the hot path. DOM
   animations are reserved for things outside that loop (sheets, confetti).
5. **Respect `prefers-reduced-motion`.** Decorative motion is dropped; the
   scroll and the highlight — which carry information — stay.

## Implemented

| Effect | Where | Why it earns its place |
|---|---|---|
| Fixed playhead, music glides under it | `staff.ts` | The note to play is always in the same place on screen. Position is eased toward the follower's beat (`beatNow += Δ × 0.16`), so a correct note produces a glide, not a jump. |
| Halo + amber on the current note | `staff.ts` | One unmistakable target, even mid-scroll. |
| Teal fade for played notes, rose flash for a miss | `staff.ts` | Colour, not motion, so the notation stays readable. |
| Spark burst on a correct note | `effects.ts` (`Particles`) | Fires from the note head the learner was looking at, inside the same canvas loop, ~12 particles with eased outward motion. |
| Key glow + hit/miss key flash | `keyboard.ts` + CSS | Answers "which finger, right now" without reading notation. |
| Musical count-in (3·2·1 at the piece's tempo, with a click) | `main.ts` + `synth.ts` | Establishes the pulse before the first note — the single most useful "animation" for a beginner. |
| Streak counter with a pop | `main.ts` + CSS | Appears at 3 in a row; resets on a wrong note. |
| Stars landing one by one, confetti at 3 stars | `effects.ts` + CSS | Reward at the end of the run, off the hot path. |
| XP bar filling, level badge, achievement toasts | `gamification.ts` + `main.ts` | Progression the learner can see between sessions, not just within one. |
| Beamed short notes | `staff.ts` | Not an animation, but it is what makes a scrolling bar of sixteenths readable at all. |

## Progression: levels, XP and achievements

The reward loop lives in `apps/learn/src/gamification.ts` and is deliberately
**pure** — `Stats` in, numbers and unlocked ids out. No DOM, no storage, no
clock. That is what lets the whole thing be unit-tested (20 tests) and retuned
without any risk to the practice loop.

**XP rewards playing, not winning.** A run pays 1 XP per correct note, +25 for
reaching the end, +15 per star and +10 for a run with no wrong notes. The notes
dominate on purpose: what deserves reinforcement in the first weeks is finishing
a piece, not finishing it cleanly. A demo listen-through pays nothing, because
the app played it.

**Levels are linear, not exponential** (`100 + (n-1)·60` XP each). An
exponential curve makes the number meaningless by level four for someone
practising ten minutes a day. Bands carry a title — Principiante, Aprendiz,
Intérprete, Músico, Maestro.

**Achievements are computed, never stored.** Unlocks are derived by diffing two
`Stats` snapshots (`newlyUnlocked(before, after)`), so adding an achievement or
retuning a goal awards it correctly on the next run instead of leaving a stale
list behind. Seventeen of them, covering volume (100 / 1.000 / 10.000 notes),
breadth (1 / 5 / 10 / all pieces), quality (a clean run, five clean runs),
nerve (20- and 50-note streaks), range (both hands, a real piano through the
microphone, three classical pieces) and consistency (3 and 7 distinct days).

Presentation, all animated: the level badge and XP bar on the library header, a
staggered slide-in toast per unlock (which can fire mid-piece), the XP bar
filling from zero on the result sheet, and a "next achievement" hint that always
names the closest one so the goal is never abstract.

## Next, in priority order

1. **Waterfall ("cascada") mode.** Falling bars from the top of the staff area
   onto the exact key they belong to, Synthesia-style, as an alternative view
   for learners who cannot read notation yet. Needs `KeyboardView` to expose key
   rectangles (`left`/`width` per MIDI note, in scroller coordinates) so a bar
   can be drawn in the same column as its key; the note list, timing and hit
   logic are already shared with the staff view. Toggle stored in prefs.
2. **Hand colouring.** Right hand amber, left hand violet, consistently across
   staff, waterfall and keys — the fastest way to make two-hand pieces legible.
3. **Sustain trails.** A long note keeps a fading tail behind the playhead while
   it should still be held, which is currently invisible: the learner has no cue
   to keep a key down.
4. **Bar-by-bar progress.** Segment the progress bar per bar and tick each
   segment as it completes, so "how much is left" is answered in musical units.
5. **Tempo ramp between takes.** After a clean run, offer the same piece 10 %
   faster with an animated dial. This is the mechanic that actually builds speed,
   and it is where the `StudentModel` (already in `practice-engine`) plugs in:
   it knows which bars are weak.
6. **Section loops.** Highlight a range of bars and loop it, with the scroll
   wrapping smoothly rather than jumping — the single most requested practice
   feature in every app of this kind.
7. **Page-flip transition between screens.** Cosmetic, last.

## Costs to watch

- Particles are capped at 240 live items; a fast player could otherwise queue
  hundreds of sparks.
- `hasGlyph` rasterises to probe font support, so it is cached per (font, char)
  — never call it per frame.
- The waterfall must read key rectangles from cached layout, not from
  `getBoundingClientRect` per frame per note; that is the one change most likely
  to cost frames on a phone.
