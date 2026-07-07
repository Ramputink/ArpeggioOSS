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
| `services/omr/` | HTTP OMR service: preprocessing + Audiveris wrapper. Deploys to the Intel Mac. | Python (FastAPI, Pillow) |
| `services/omr/Dockerfile` · `docker-compose.yml` | Containerized deployment (x86_64). | — |
| `services/omr/scripts/` | Native (no-Docker) install/run scripts for macOS. | Bash |
| `packages/musicxml-parser/` | MusicXML → internal model + quality report. | TypeScript |
| `packages/omr-client/` | CLI test client (upload, save, parse, report). | TypeScript |
| `samples/demo.musicxml` | Tiny score for offline parser testing. | — |

## Component versions (verified July 2026)

- **Audiveris 5.10.2** — needs **JDK 25** (it compiles at Java source release 25),
  built with Gradle 8.5. Batch CLI:
  `Audiveris -batch -export -output <dir> <input>` → compressed MusicXML (`.mxl`).
- **Tesseract** — bundled by Audiveris via javacpp bindings for text OCR. On the
  Docker/Linux path the `eng` `tessdata` file is provided and OCR works. On the
  **macOS 11 backend** the bundled native lib can't load, so OCR is disabled (see
  "Backend on macOS 11" below); notes still export, only text is skipped.
- **Preprocessing** uses **Pillow + NumPy** (not OpenCV), whose macOS 11 wheels load.
- Target backend architecture: **x86_64** (the Intel MacBook, macOS 11 Big Sur).

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

### Option B — Native, no Homebrew (used on the macOS 11 backend)

The actual backend runs **macOS 11 (Big Sur)**, where Homebrew is unsupported and
current Docker Desktop won't install. `install-native-nobrew.sh` provisions
everything under `~/arpeggio` with **no sudo and no Homebrew**: Temurin JDK 25
(tarball), Python 3.12 (via [`uv`](https://astral.sh/uv)), Tesseract `eng` data,
and an Audiveris build from source.

```bash
# One-time prerequisites the user runs on the Mac (need the login password):
#   sudo xcodebuild -license accept          # unblocks system git/python3
# Then, from the dev machine:
rsync -az --exclude node_modules --exclude dist --exclude .native \
  ./services/omr/ matveypro@192.168.0.23:~/arpeggio/omr/
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && nohup bash scripts/install-native-nobrew.sh > ~/arpeggio/provision.log 2>&1 &'
# When provisioning finishes (~/arpeggio/omr/.native/env.sh appears), start it:
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && nohup bash scripts/run-native.sh > ~/arpeggio/service.log 2>&1 &'
curl http://192.168.0.23:8000/health
```

> On newer macOS with Homebrew, `scripts/install-native.sh` is the simpler
> equivalent (`brew install openjdk@25 tesseract python`).

#### Auto-start on boot

The `nohup … &` start above dies on logout and doesn't come back after a reboot.
Two launchd options are bundled; **which one you want depends on how the Mac runs**:

- **Headless backend reached over SSH → LaunchDaemon (recommended here).** A
  LaunchDaemon runs in the `system` domain, starts at **boot with no GUI login**,
  and can be loaded over SSH. It needs sudo once but runs the service as your
  normal user (so it still uses `~/arpeggio`):

  ```bash
  ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && sudo bash scripts/install-launchdaemon.sh'
  ```

- **Mac that logs into the desktop → LaunchAgent (no sudo).** A LaunchAgent loads
  into the user's **GUI (Aqua) session**, so it starts at login — but it **cannot
  be loaded from an SSH session** (`launchctl` reports "Could not find domain for
  port (Aqua)") and won't run on a headless Mac with no one logged in:

  ```bash
  # Run this from a GUI Terminal on the Mac (or Screen Sharing), not over SSH:
  cd ~/arpeggio/omr && bash scripts/install-launchagent.sh
  ```

Both install `com.arpeggio.omr` with `RunAtLoad` + `KeepAlive` (restart on crash),
log to `~/arpeggio/service.log`, and require `install-native-nobrew.sh` to have run
first. The daemon installer also removes the redundant LaunchAgent to avoid a
port-8000 clash. Placeholders `__HOME__`/`__USER__` are substituted at install
time, since launchd does not expand `~`.

Check status / tail the log / stop:

```bash
# LaunchDaemon:
ssh matveypro@192.168.0.23 'sudo launchctl print system/com.arpeggio.omr'
ssh matveypro@192.168.0.23 'tail -f ~/arpeggio/service.log'
ssh matveypro@192.168.0.23 'cd ~/arpeggio/omr && sudo bash scripts/install-launchdaemon.sh uninstall'

# LaunchAgent (from a GUI Terminal):
launchctl print gui/$(id -u)/com.arpeggio.omr
cd ~/arpeggio/omr && bash scripts/install-launchagent.sh uninstall
```

A healthy service responds:

```json
{ "status": "ok", "service": "arpeggio-omr", "audiveris_version": "5.10.2" }
```

### Backend on macOS 11 (Big Sur) — native-binary notes

macOS 11 predates the 2026 prebuilt native binaries, which target macOS 12/13+.
Three consequences, all handled:

- **OpenCV** wheels fail to load (a bundled lib is built for macOS 12) → preprocessing
  uses **Pillow + NumPy** instead.
- **Audiveris' bundled Tesseract** native lib is built for macOS 13 and aborts the
  engine → OCR is disabled with `OMR_DISABLE_OCR=true`
  (passes `-constant …TesseractOCR.useOCR=false`). Note recognition is unaffected;
  only text/lyrics OCR is skipped.
- **JDK/Python**: the system JDK 17 / Python 3.8 are too old, so JDK 25 and
  Python 3.12 are installed in userland.

The Docker path (Debian, linux/amd64) has none of these issues and keeps OCR on.

### Service configuration (env vars)

| Var | Default | Meaning |
|-----|---------|---------|
| `OMR_PORT` | `8000` | Listen port. |
| `OMR_JVM_HEAP` | `2g` | JVM heap cap for Audiveris (bound RAM on the old Mac). |
| `OMR_TARGET_DPI` | `300` | DPI after preprocessing normalization. |
| `OMR_MAX_PAGES` | `12` | Warn/guard threshold for long PDFs. |
| `OMR_DISABLE_OCR` | `false` | Skip Audiveris OCR (set `true` on macOS 11). |
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

Preprocessing (`services/omr/app/preprocess.py`, Pillow + NumPy): grayscale →
deskew (±8° via projection-profile search) → autocrop to content bbox → adaptive
mean binarization → normalize to ~300 dpi, recombined into a clean PDF (PyMuPDF)
so Audiveris treats multipage input as one coherent "book". Long PDFs
(> `OMR_MAX_PAGES`) still process but return a `X-OMR-Warning` header; per-page
MusicXML merging is a documented demo limitation (see below).

---

## 3. Test it end-to-end from the dev machine

Build the TypeScript workspace once:

```bash
npm install
npm run build
```

Run the client against a real score. `samples/minueto.pdf` is included — the
Minuet in G BWV Anh. 114 (Petzold), a clean LilyPond engraving from the
[Mutopia Project](https://www.mutopiaproject.org) (public domain). You can also
photograph your own or export from MuseScore/IMSLP:

```bash
node packages/omr-client/dist/cli.js ./samples/minueto.pdf \
  --server http://192.168.0.23:8000 \
  --out ./minueto.musicxml
```

It POSTs the file, saves the MusicXML, parses it locally and prints a quality
report:

```
→ POST http://192.168.0.23:8000/omr  (176.5 KiB, preprocess=true)
✓ received MusicXML in 24.6s (74.2 KiB)
✓ saved ./minueto.musicxml

Parse quality report
─────────────────────
  Parts:      1
  Staves:     2
  Voices:     4
  Measures:   32
  Notes:      408
  Pitch range: MIDI 43–83
  Duration:   194.0 quarter-beats
  Repeats flattened: yes
  Warnings (2):
    ! [voice-overlap] 4 overlapping note pair(s) within a single voice.
    ! [measure-overfull] Measure 8 spans 4.00 beats but the time signature allows 3.00.
```

(Real output from the deployed backend, OMR-ing the Mutopia engraving of the
Minuet. The two warnings are exactly the kind of OMR slip the report exists to
flag — a good sign the quality check works.)

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
