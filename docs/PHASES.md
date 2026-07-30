# Roadmap phases — status & integration map

Where each roadmap phase stands in this repo, what is **built and verified**, what
is **scaffold/interface only**, and how the pieces connect. Everything algorithmic
runs and is unit-tested headless; the device/app layers (iOS audio, native shell)
are interface + design only, since they can't be built or run in this environment.

| Phase | Scope                                                                | Status                                                                                             | Where                                                             |
| ----- | -------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **0** | Canonical internal model `{onset,offset,midi,voice,staff,measure,…}` | ✅ built                                                                                           | `packages/musicxml-parser/src/model.ts`                           |
| **1** | OMR: image/PDF → MusicXML → model, quality report                    | ✅ built **& deployed** on the Intel Mac                                                           | `services/omr`, `packages/musicxml-parser`, `packages/omr-client` |
| **2** | Render + viewer (cursor, tempo, hands, synth playback)               | ✅ core built & browser-verified (piano-roll). Staff render (OSMD/Verovio in a WebView) = scaffold | `archive/viewer`                                                  |
| **3** | Low-latency mic capture → audio frames                               | 🟡 **interface only** (`AudioFrame`); native iOS `AVAudioEngine` not buildable here                | `packages/practice-engine/src/types.ts`                           |
| **4** | Two detection engines + combiner                                     | ✅ built & tested. MOTOR 1 (YIN) real; MOTOR 2 = stub seam (real = Basic Pitch/ONNX/Core ML)       | `packages/practice-engine/src/detection`                          |
| **5** | Score following (follow-you v1 + DTW v2)                             | ✅ built & tested                                                                                  | `packages/practice-engine/src/follower`                           |
| **6** | Feedback loops 1 (calibration) & 2 (student model)                   | ✅ built & tested. Loop 3 (model retraining) intentionally out of scope                            | `packages/practice-engine/src/feedback`                           |
| **—** | Practice loop joining Phases 4→5→6                                   | ✅ built & tested (`PracticeSession`)                                                              | `packages/practice-engine/src/session.ts`                         |
| **7** | Product: onboarding, library, stats, iOS packaging                   | 🟡 design/scaffold                                                                                 | this doc + `ROADMAP`                                              |

**Tests:** `npm test` → 9 parser + 23 practice-engine = **32 passing**, headless.

## How it all connects (the on-device practice loop)

```
 mic (Phase 3, native) ──frames──► PracticeSession.listen(frames)   [packages/practice-engine]
                                        │
                     MOTOR 1 (YIN) ─────┤ Combiner picks engine, escalates to MOTOR 2
                     MOTOR 2 (poly) ────┘ on chords / low-confidence / disagreement
                                        │  → DetectedNote[]
                     follow-you / DTW ──┤  is this the expected note? advance / wait
                                        │  → PlayerEvent[]  (correct / wrong / hesitation / early / late)
                     feedback ──────────┤  StudentModel logs it; ThresholdCalibrator adapts
                                        ▼
                              session.progress  → UI (cursor, score, what to drill)
```

The whole loop consumes the canonical `Score` produced by Phase 1. A UI (the
the archived piano-roll prototype, a native/OSMD view later) reads `session.progress`
to move the cursor and show feedback.

## The integration contract (what the app must provide)

The algorithmic core is engine-agnostic and platform-agnostic. To ship on iOS,
the app supplies the two things that can't be built here:

1. **Audio frames** (Phase 3). Implement capture that emits `AudioFrame`
   (`{ samples: Float32Array, sampleRate, timeSec }`) from `AVAudioEngine`
   (Camino B native) or a JS bridge over the native tap (Camino A hybrid), then
   call `session.listen(frames)` per window.
2. **MOTOR 2** (Phase 4). Provide a real `PolyphonicDetector`
   (`detect(frames) => Promise<DetectedNote[]>`) backed by Basic Pitch via ONNX
   Runtime / Core ML, and pass it as `new PracticeSession(score, { poly })`.
   Until then, `StubPolyphonicDetector` keeps the combiner and tests exercisable.

A UI layer renders `Score` + `session.progress` (Phase 2/7).

## Honest limitations

- **MOTOR 2 is a stub.** Real polyphonic transcription (chords by mic) is the
  hardest part of the whole project and needs the ML model on-device.
- **Detection tested on synthetic sines**, not real piano timbre (harmonics,
  inharmonicity, decay). Thresholds will need per-room calibration (Phase 6 loop 1).
- **No beat↔seconds clock bridge yet**: follow-you runs in tolerant learning mode
  (no rhythm scoring); DTW's onset term is off until a shared tempo clock is wired.
- **iOS audio capture, native render, and packaging** (Phases 3, 7) are not built
  — they require Xcode/device and are specified here as interfaces, not code.
- **Render**: the piano-roll is a self-contained stand-in; a real staff view needs
  OSMD/Verovio inside a WebView (external assets), out of the headless demo.

## Suggested next steps (in order)

1. Decide **Camino A (hybrid TS) vs B (native Swift)** using the Phase-0 spikes —
   Camino A can reuse `practice-engine` almost verbatim.
2. Wire a **real MOTOR 2** (Basic Pitch ONNX) behind the `PolyphonicDetector`
   interface and re-run the combiner against real chord audio.
3. Add the **beat↔seconds clock** so follow-you v2 (DTW) can score rhythm.
4. Build the **audio capture** module (Phase 3) for the chosen path and feed
   `PracticeSession`.
5. Swap the piano-roll for an **OSMD staff view** with the live cursor (Phase 2/7).
