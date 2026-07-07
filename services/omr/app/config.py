"""OMR service configuration, driven entirely by environment variables.

Designed to behave identically under Docker and in native mode: the only things
that differ between the two are AUDIVERIS_CMD (path to the Audiveris launcher)
and TESSDATA_PREFIX (path to the Tesseract language data).
"""
from __future__ import annotations

import os

# ---- Networking ------------------------------------------------------------
# Bind to 0.0.0.0 so the dev machine (and later the iPhone) can reach the
# service across the LAN.
HOST: str = os.environ.get("OMR_HOST", "0.0.0.0")
PORT: int = int(os.environ.get("OMR_PORT", "8000"))

# ---- Audiveris -------------------------------------------------------------
# Path to the Audiveris executable/launcher. The Dockerfile and run-native.sh
# export this pointing at the built distribution (bin/Audiveris).
AUDIVERIS_CMD: str = os.environ.get("AUDIVERIS_CMD", "Audiveris")

# Expected Audiveris version (informational only; reported by /health).
AUDIVERIS_VERSION: str = os.environ.get("AUDIVERIS_VERSION", "5.10.2")

# JVM heap cap. The old Intel MacBook may have modest RAM, so we bound it.
JVM_HEAP: str = os.environ.get("OMR_JVM_HEAP", "2g")

# Timeout (seconds) for a single Audiveris run on one input file.
AUDIVERIS_TIMEOUT: int = int(os.environ.get("OMR_AUDIVERIS_TIMEOUT", "600"))

# Disable Audiveris' OCR (text recognition) when the bundled Tesseract native
# library can't load — e.g. on macOS 11 (Big Sur), whose libc++ is too old for
# the 2026 javacpp Tesseract build. With OCR off, Audiveris still recognizes
# notes/clefs/keys/time signatures and exports MusicXML; only textual items
# (title, lyrics, tempo words) are skipped, which the note model doesn't use.
DISABLE_OCR: bool = os.environ.get("OMR_DISABLE_OCR", "false").lower() in ("1", "true", "yes")

# ---- Preprocessing / PDF ---------------------------------------------------
# Target DPI after normalization. ~300 dpi is what Audiveris digests best.
TARGET_DPI: int = int(os.environ.get("OMR_TARGET_DPI", "300"))

# If a PDF exceeds this page count, it is processed page by page to bound
# memory usage on the modest machine (see pdfutil.split_if_large).
MAX_PAGES: int = int(os.environ.get("OMR_MAX_PAGES", "12"))

# Temporary working directory (uploads, Audiveris output).
WORK_DIR: str = os.environ.get("OMR_WORK_DIR", "/tmp/omr-work")

# Accepted input file types.
ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".pdf", ".tif", ".tiff", ".bmp"}
