# Should this be a native iOS app?

Short answer: **not yet, and probably never for the whole app — but the listening
half has a real case, and there is a measurement that decides it.**

This is the honest version, including the parts that argue against the web.

## What a native app would actually buy

The claim is always "lower latency". It is worth being precise about where the
milliseconds are, because most of them are not where people assume.

| Stage | Web today | Native (AVAudioEngine + Core ML) |
|---|---|---|
| Hardware input buffer | Whatever iOS gives Safari; not settable | `preferredIOBufferDuration` down to ~5 ms |
| Capture callback | `ScriptProcessorNode`, 2048 samples = 46 ms | Render callback, 256 samples = 5.8 ms |
| Windowing before judging | 2 frames = 93 ms (was 186) | Freely chosen; 3 × 256 = 17 ms |
| Monophonic pitch (YIN) | ~1 ms in JS | ~0.2 ms |
| Polyphonic (Basic Pitch) | TF.js, main thread or worker | Core ML on the ANE, ~2–5 ms |
| **Realistic total** | **~110–200 ms** | **~25–40 ms** |

So the gap is real and it is roughly **an order of magnitude**, and almost all of
it comes from two things a browser will not give up: the frame size of the capture
callback, and running inference on the same thread as the UI.

Whether that gap *matters* depends on the mode:

- **Wait mode** (the cursor waits for you): 150 ms of lag is invisible. You play,
  the score glides forward; nothing is being timed.
- **A tempo** (the cursor grades your timing): 150 ms of lag is fatal. The
  tolerance is ±150 ms, so the entire error budget is consumed by the pipeline
  before the learner has done anything wrong. Either the lag is subtracted as a
  constant — which only works if it is *stable* — or the mode is dishonest.

That is the decision point, and it is measurable rather than arguable.

## The measurement that decides it

The app now measures its own software latency (`latency.ts`, surfaced in the
microphone check and on the result sheet for a mic run). What is needed is a
session on a real piano, on the target phone:

1. Play twenty single notes in wait mode; read p50 and p95.
2. Repeat with a chord piece, so Basic Pitch is in the path.
3. Compare p95 − p50. **The spread matters more than the median**: a stable 140 ms
   can be compensated by subtracting a constant, while a jittery 90–250 ms cannot
   be compensated by anything.

Decision rule:

- **p95 under ~120 ms and spread under ~40 ms** → stay on the web. Compensate the
  constant, ship a-tempo mode, and spend the effort on teaching instead.
- **p95 over ~200 ms, or a spread over ~80 ms** → a-tempo mode over the microphone
  is not honest on the web. Then the native path is worth it *for listening*.

## What "going native" would actually cost

Not a rewrite, if it is done in the right order. The project is already split so
that the expensive part is portable:

- `@arpeggio/musicxml-parser`, `@arpeggio/practice-engine` (YIN, the combiner,
  both followers, the feedback loops) and `@arpeggio/song-library` are pure
  TypeScript with no DOM. That is the bulk of the thinking.
- `@arpeggio/practice-web`, `apps/learn` (canvas notation, keyboard, animation)
  are browser-specific, and are the parts a native app would replace.

Three paths, in increasing cost:

1. **Web app + a native audio bridge.** Keep everything; replace only capture and
   MOTOR 2 with a small native module, feeding detections back into the same
   engine. On iOS this means a WKWebView host app with a native audio unit — which
   is no longer a website, so it inherits App Store review, provisioning and a
   release cycle, for one subsystem.
2. **Native listening, web everything else** — the same as (1) but shipped as two
   products. Not worth the split for one learner.
3. **Full native app.** SwiftUI, a Core Graphics or Metal renderer for the
   notation, Core ML for Basic Pitch, and the engine ported (or run through
   JavaScriptCore, which is a genuine option: it is pure TS with no DOM). Best
   latency, best feel, and it gives up what the web gives for free — one URL, no
   review, no signing, works on the desktop and on Android, and installs from a
   link.

## The recommendation

**Stay on the web, and make the web version honest about its own limits** — which
is what this milestone did: the window is halved for monophonic lines, inference
is pushed off the main thread where the browser allows it, and the latency is
measured and shown rather than assumed.

Then take the measurement on a real piano. Only if a-tempo mode over the
microphone turns out to be unusable does the native question become real — and at
that point the answer is path 1 for the audio, not a rewrite, because the parts
worth keeping were deliberately kept portable.

One caveat about this milestone, recorded because it changes the calculus:
**TensorFlow.js could not be confirmed to run inside a module worker.** The worker
is implemented, and every request is time-bounded so that a hang retires it and
inference continues in-page — but if that turns out to be a permanent TF.js
limitation on iOS Safari, then chord detection competes with the animation loop on
the main thread for good, and that is an argument for the native path that has
nothing to do with latency.
