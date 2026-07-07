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

## Version verification (July 2026)

| Component | Version | How verified | Requirement |
|-----------|---------|--------------|-------------|
| Audiveris | 5.10.2  | GitHub releases page | JDK 25, Gradle 8.5 |
| JDK       | 21      | Audiveris build docs | Temurin 21 (Docker) / `openjdk@21` (brew) |
| Tesseract | bundled (javacpp) | Audiveris handbook | `eng` `tessdata` provided at runtime |
| Batch CLI | — | Audiveris docs | `Audiveris -batch -export -output <dir> <input>` → `.mxl` |

The built distribution lands at `app/build/distributions/app-<ver>.tar`; the
launcher inside is `bin/Audiveris`.

## Build/verify status of this demo

- `npm test -w @arpeggio/musicxml-parser` — 6 passing tests (repeat flattening,
  tie merging, pitch/onset correctness, quality warnings, overfull-measure
  detection, repeat-safe measure length).
- `npm run build` — parser + client compile with `tsc`.
- Offline parser check: `omr-client --parse samples/demo.musicxml` → clean report.
- The OMR service itself requires the Audiveris build, which happens on the Intel
  Mac at deploy time (Docker layer or native script); not run from the dev machine.

## Open follow-ups (out of this demo)
- Multi-page MusicXML merge for very long PDFs.
- Correction editor for OMR mistakes (Roadmap Phase 1).
- Da capo / dal segno expansion in the parser.
