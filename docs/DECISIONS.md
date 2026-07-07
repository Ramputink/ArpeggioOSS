# Design decisions & process log

Record of the choices behind this demo (the backend OMR pipeline) and how the
component versions were verified. Scope is deliberately narrow: sheet music →
MusicXML → internal model. No iOS/audio/render.

## Decisions

### D1 — Audiveris runs on a backend, never on-device
Audiveris is a heavy Java (JDK 25) application and cannot run on an iPhone. It
lives in an HTTP service on the LAN backend (the old Intel MacBook at
`192.168.0.23`); clients upload a file and receive MusicXML.

### D2 — Mixed language split
- **Python** (FastAPI + OpenCV) for the HTTP service and image preprocessing:
  OpenCV/Pillow are first-class in Python and the service only needs to shell out
  to the Audiveris CLI.
- **TypeScript** for the MusicXML parser and CLI client, so the parser and the
  canonical model can be **reused later in the hybrid (Camino A) iOS app**.

### D3 — Two deployment paths, equal weight
Docker (reproducible, x86_64 image built on the target Mac) **and** a native
Homebrew-based script, because Docker Desktop may be too heavy for the old
machine. Both are documented and scripted.

### D4 — Preprocess before OMR
Deskew + autocrop + adaptive binarization + 300 dpi normalization is the single
biggest lever on OMR accuracy. Implemented with OpenCV/PyMuPDF and always
re-emitted as a clean PDF so multipage input stays one coherent Audiveris "book".

### D5 — Canonical internal model in quarter-note beats
All timing normalized to quarter-note beats (independent of MusicXML
`<divisions>`), repeats/voltas flattened to a linear timeline, ties merged. The
rest of the future app consumes `Score`, not raw MusicXML. See
`packages/musicxml-parser/src/model.ts`.

### D6 — Bound the JVM heap
`JAVA_TOOL_OPTIONS=-Xmx<heap> -Djava.awt.headless=true` caps memory on the modest
backend and avoids requiring a display in batch mode.

### D7 — Backend runs macOS 11 (Big Sur): provision in userland, no Homebrew
The Intel Mac runs macOS 11; Homebrew is unsupported and Docker Desktop won't
install. `scripts/install-native-nobrew.sh` installs everything under `~/arpeggio`
without sudo: Temurin JDK 25 tarball, Python 3.12 via `uv`, Tesseract `eng` data,
Audiveris built from source. The agent cannot run persistent sudo (blocked by the
harness), so the one-time `xcodebuild -license accept` is done by the user.

### D8 — Preprocessing with Pillow + NumPy, not OpenCV
OpenCV's x86_64 wheels ≥4.10 need macOS 12+, and 4.9's bundled `libvmaf` is built
for macOS 12 (fails to `dlopen` on 11). Reimplemented deskew (projection profile),
autocrop, and adaptive-mean binarization with Pillow + NumPy, which have portable
macOS 11 wheels. PyMuPDF handles PDF raster + rebuild.

### D9 — Disable Audiveris OCR on macOS 11
Audiveris' bundled javacpp Tesseract 5.5.1 native lib is built for macOS 13 and
aborts the engine on macOS 11. `OMR_DISABLE_OCR=true` passes
`-constant …TesseractOCR.useOCR=false`, so `isAvailable()` is false and the native
lib is never loaded. Notes/clefs/keys/times still recognized and exported; only
text OCR (title/lyrics) is skipped — irrelevant to the note-event model.

## Version verification (July 2026)

| Component | Version | How verified | Requirement |
|-----------|---------|--------------|-------------|
| Audiveris | 5.10.2  | GitHub releases page | Compiles at Java **source release 25** |
| JDK       | 25 (Temurin 25.0.3) | Build failed under 21 ("invalid source release: 25") | JDK 25 (Docker `eclipse-temurin:25`, native tarball) |
| Tesseract | bundled (javacpp 5.5.1) | Runtime | OCR works on Linux; disabled on macOS 11 (native lib built for macOS 13) |
| Python    | 3.12 (via `uv`) | System 3.8 too old for deps | 3.11+ |
| Batch CLI | — | Verified on backend | `Audiveris -batch -export -output <dir> <input>` → `.mxl` |

The built distribution lands at `app/build/distributions/app-<ver>.tar`; the
launcher inside is `bin/Audiveris`.

## Build/verify status of this demo

- `npm test -w @arpeggio/musicxml-parser` — 6 passing tests (repeat flattening,
  tie merging, pitch/onset correctness, quality warnings, overfull-measure
  detection, repeat-safe measure length).
- `npm run build` — parser + client compile with `tsc`.
- Offline parser check: `omr-client --parse samples/demo.musicxml` → clean report.
- **Deployed and verified end-to-end (2026-07-07)** on the Intel Mac backend:
  `/health` returns `{status:ok, audiveris_version:5.10.2}`; `omr-client
  samples/minueto.pdf` (Minuet BWV Anh.114, Mutopia engraving) → MusicXML in ~25s
  → parsed to **1 part / 2 staves / 32 measures / 408 notes**, pitch range MIDI
  43–83, repeats flattened, 2 quality warnings (a voice overlap and one overfull
  measure — real OMR slips the report is meant to surface).

## Open follow-ups (out of this demo)
- Multi-page MusicXML merge for very long PDFs.
- Correction editor for OMR mistakes (Roadmap Phase 1).
- Da capo / dal segno expansion in the parser.
