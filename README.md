# Arpeggio OSS — OMR backend demo

Optical Music Recognition pipeline for a future iOS piano tutor. This first demo
covers **only the backend OMR path**: an HTTP service that receives a sheet-music
image/PDF, runs [Audiveris](https://github.com/Audiveris/audiveris) on it, and
returns MusicXML — plus a TypeScript library that parses MusicXML into a
canonical internal note-event model with a quality report, and a CLI client that
exercises the whole thing end-to-end.

> Out of scope for this demo: iOS, audio, microphone, rendering, score
> following. See `ROADMAP` for the full product vision.

```
┌────────────┐   image/PDF    ┌─────────────────────────────┐   MusicXML   ┌──────────────┐
│ omr-client │ ─────────────► │  OMR service (Intel Mac)    │ ───────────► │  omr-client  │
│ (dev mac)  │   POST /omr    │  OpenCV → Audiveris 5.10.2  │              │  parse+report│
└────────────┘                └─────────────────────────────┘              └──────────────┘
```

## Repository layout

| Path | What it is | Language |
|------|-----------|----------|
| `services/omr/` | HTTP OMR service: preprocessing + Audiveris wrapper. Deploys to the Intel Mac. | Python (FastAPI, OpenCV) |
| `services/omr/Dockerfile` · `docker-compose.yml` | Containerized deployment (x86_64). | — |
| `services/omr/scripts/` | Native (no-Docker) install/run scripts for macOS. | Bash |
| `packages/musicxml-parser/` | MusicXML → internal model + quality report. | TypeScript |
| `packages/omr-client/` | CLI test client (upload, save, parse, report). | TypeScript |
| `samples/demo.musicxml` | Tiny score for offline parser testing. | — |

## Component versions (verified July 2026)

- **Audiveris 5.10.2** — needs **JDK 25**, built with Gradle 8.5. Batch CLI:
  `Audiveris -batch -export -output <dir> <input>` → compressed MusicXML (`.mxl`).
- **Tesseract** — bundled by Audiveris via javacpp bindings; only the `eng`
  `tessdata` language file is provided at runtime.
- Target backend architecture: **linux/amd64** (the Intel MacBook).

---

## 1. Deploy the OMR service to the Intel Mac (`192.168.0.23`)

Copy the repo (or just `services/omr`) to the backend over SSH:

```bash
# From the dev machine, in the repo root:
rsync -av --exclude node_modules --exclude dist --exclude .native \
  ./services/omr/ matveypro@192.168.0.23:~/arpeggio/omr/
```

Then bring it up **on the Mac**, either with Docker or natively.

### Option A — Docker (recommended when Docker Desktop is available)

Build **on the Intel Mac itself** so the image is native amd64 (no slow qemu):

```bash
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && docker compose up -d --build'
```

The first build clones and compiles Audiveris from source (several minutes; the
layer is cached afterwards). Check it:

```bash
ssh matveypro@192.168.0.23 'docker compose -f ~/arpeggio/omr/docker-compose.yml logs --tail 20'
curl http://192.168.0.23:8000/health
```

### Option B — Native (when Docker Desktop is too heavy for the machine)

Requires [Homebrew](https://brew.sh). The installer pulls JDK 25 + Tesseract,
builds Audiveris, and creates a Python virtualenv:

```bash
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && bash scripts/install-native.sh'
# Start it (foreground). For background use nohup/tmux, e.g.:
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && nohup bash scripts/run-native.sh > omr.log 2>&1 &'
curl http://192.168.0.23:8000/health
```

A healthy service responds:

```json
{ "status": "ok", "service": "arpeggio-omr", "audiveris_version": "5.10.2" }
```

### Service configuration (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `OMR_PORT` | `8000` | Listen port. |
| `OMR_JVM_HEAP` | `2g` | JVM heap cap for Audiveris (bound RAM on the old Mac). |
| `OMR_TARGET_DPI` | `300` | DPI after preprocessing normalization. |
| `OMR_MAX_PAGES` | `12` | Warn/guard threshold for long PDFs. |
| `AUDIVERIS_CMD` | (set by Docker/native) | Path to the Audiveris launcher. |
| `TESSDATA_PREFIX` | (set by Docker/native) | Tesseract language-data dir. |

---

## 2. HTTP API

### `GET /health`
Liveness probe. Returns `{status, service, audiveris_version}`.

### `POST /omr`
Multipart upload of a score; returns MusicXML as `text`
(`application/vnd.recordare.musicxml+xml`).

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `file` | file (form field) | — | PNG/JPG/TIFF/BMP or PDF. |
| `preprocess` | query bool | `true` | OpenCV deskew/crop/binarize/300dpi before OMR. |

Errors: `415` unsupported type, `400` empty/bad input, `422` Audiveris failed or
score unrecognizable.

Preprocessing (`services/omr/app/preprocess.py`): grayscale → deskew (±15° via
min-area rect) → autocrop to content bbox → adaptive binarization → normalize to
~300 dpi, recombined into a clean PDF so Audiveris treats multipage input as one
coherent "book". Long PDFs (> `OMR_MAX_PAGES`) still process but return a
`X-OMR-Warning` header; per-page MusicXML merging is a documented demo
limitation (see below).

---

## 3. Test it end-to-end from the dev machine

Build the TypeScript workspace once:

```bash
npm install
npm run build
```

Run the client against a real score (the C-major Minuet BWV Anh. 114 by Petzold
is public domain — export it from MuseScore/IMSLP as PDF, or photograph your own):

```bash
node packages/omr-client/dist/cli.js ./samples/minueto.pdf \
  --server http://192.168.0.23:8000 \
  --out ./minueto.musicxml
```

It POSTs the file, saves the MusicXML, parses it locally and prints a quality
report:

```
→ POST http://192.168.0.23:8000/omr  (742.0 KiB, preprocess=true)
✓ received MusicXML in 18.4s (36.1 KiB)
✓ saved ./minueto.musicxml

Parse quality report
─────────────────────
  Parts:      1
  Staves:     2
  Voices:     2
  Measures:   32
  Notes:      196
  Pitch range: MIDI 43–84
  Duration:   96.0 quarter-beats
  Repeats flattened: yes
  Warnings:   none 🎉
```

Other client modes:

```bash
node packages/omr-client/dist/cli.js --health --server http://192.168.0.23:8000
node packages/omr-client/dist/cli.js --parse ./samples/demo.musicxml   # offline, no server
node packages/omr-client/dist/cli.js ./scan.jpg --no-preprocess        # skip OpenCV
```

Set a default server without `--server`:

```bash
export OMR_SERVER=http://192.168.0.23:8000
```

---

## 4. Internal model & parser

`@arpeggio/musicxml-parser` turns MusicXML into the canonical `Score`
(`packages/musicxml-parser/src/model.ts`): a flat list of `NoteEvent`
`{onset, offset, pitchMidi, voice, staff, hand, measure, position, tied}`, with
timing in **quarter-note beats** and **repeats/voltas flattened** into a linear
timeline. Ties are merged into single events; the quality report flags empty
results, out-of-range pitches, zero-length notes, voice overlaps and measures
that disagree with their time signature.

Run the parser tests:

```bash
npm test -w @arpeggio/musicxml-parser
```

### Known limitations (demo scope)
- `score-timewise` MusicXML is not supported (convert to `score-partwise`).
- Grace notes are skipped (they carry no `<duration>`).
- Repeat expansion handles forward/backward repeats and first/second endings;
  da capo / dal segno are **not** expanded.
- Multi-page PDF MusicXML merging is not performed — Audiveris processes the whole
  book, but per-page split/merge (for very long scores) is left as future work.

---

## Exact command block (build → deploy → start → test)

```bash
# ── On the dev machine (repo root) ─────────────────────────────────────────
npm install && npm run build                       # build parser + client
npm test -w @arpeggio/musicxml-parser              # sanity-check the parser

rsync -av --exclude node_modules --exclude dist --exclude .native \
  ./services/omr/ matveypro@192.168.0.23:~/arpeggio/omr/   # deploy service

# ── On the Intel Mac — pick ONE ────────────────────────────────────────────
# (A) Docker:
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && docker compose up -d --build'
# (B) Native:
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && bash scripts/install-native.sh \
  && nohup bash scripts/run-native.sh > omr.log 2>&1 &'

# ── Back on the dev machine — verify + run ─────────────────────────────────
curl http://192.168.0.23:8000/health
node packages/omr-client/dist/cli.js ./samples/minueto.pdf \
  --server http://192.168.0.23:8000 --out ./minueto.musicxml
```

## License

AGPL-3.0-or-later — consistent with Audiveris, on which the OMR service depends.
