"""Thin wrapper around the Audiveris OMR engine, run in headless batch mode.

Audiveris (https://github.com/Audiveris/audiveris, v5.10.2, JDK 25) is a Java
application. We drive it via its command-line batch interface:

    Audiveris -batch -export -output <dir> <input>

which recognizes the score and exports compressed MusicXML (`.mxl`). A `.mxl`
file is a ZIP container; we unpack it to the plain `.musicxml` XML text that the
HTTP layer returns to the client.

The JVM heap is capped via JAVA_TOOL_OPTIONS so a large score cannot exhaust
RAM on the modest backend machine.
"""
from __future__ import annotations

import glob
import logging
import os
import subprocess
import zipfile
from typing import List, Optional

from . import config, mxlmerge, pdfutil

log = logging.getLogger(__name__)


class AudiverisError(RuntimeError):
    """Raised when the Audiveris process fails or produces no output."""


def _jvm_env() -> dict:
    """Environment for the Audiveris subprocess, with a bounded JVM heap."""
    env = os.environ.copy()
    # JAVA_TOOL_OPTIONS is honored by any JVM the launcher spawns.
    # -Xmx caps the heap; headless avoids requiring an X display in batch mode.
    opts = f"-Xmx{config.JVM_HEAP} -Djava.awt.headless=true"
    existing = env.get("JAVA_TOOL_OPTIONS", "")
    env["JAVA_TOOL_OPTIONS"] = f"{existing} {opts}".strip()
    return env


def _find_mxl(output_dir: str) -> Optional[str]:
    """Locate the exported MusicXML file under Audiveris' output directory.

    Audiveris writes into a per-book subfolder, so we search recursively and
    prefer compressed `.mxl`, falling back to an uncompressed `.xml`/`.musicxml`.
    """
    for pattern in ("**/*.mxl", "**/*.musicxml", "**/*.xml"):
        matches = sorted(glob.glob(os.path.join(output_dir, pattern), recursive=True))
        # Skip Audiveris' own `.omr` project metadata; only score exports matter.
        matches = [m for m in matches if not m.endswith(".omr.xml")]
        if matches:
            return matches[0]
    return None


def _read_musicxml(path: str) -> str:
    """Return the MusicXML text, transparently unpacking a `.mxl` ZIP if needed."""
    if path.endswith(".mxl"):
        with zipfile.ZipFile(path) as zf:
            # Per the MusicXML spec, META-INF/container.xml points at the root
            # score file. Fall back to the first non-container .xml entry.
            xml_name = None
            try:
                container = zf.read("META-INF/container.xml").decode("utf-8")
                # Minimal extraction: the rootfile full-path attribute.
                import re
                m = re.search(r'full-path="([^"]+)"', container)
                if m:
                    xml_name = m.group(1)
            except KeyError:
                pass
            if xml_name is None:
                candidates = [n for n in zf.namelist()
                              if n.endswith(".xml") and not n.startswith("META-INF")]
                if not candidates:
                    raise AudiverisError("No MusicXML entry found inside .mxl archive")
                xml_name = candidates[0]
            return zf.read(xml_name).decode("utf-8")
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def run_omr(input_path: str, output_dir: str) -> str:
    """Run Audiveris on `input_path` and return the resulting MusicXML text.

    Raises AudiverisError on non-zero exit, timeout, or missing output.
    """
    os.makedirs(output_dir, exist_ok=True)
    cmd = [config.AUDIVERIS_CMD]
    if config.DISABLE_OCR:
        # Prevents Audiveris from touching the (unloadable) Tesseract native lib.
        cmd += ["-constant", "org.audiveris.omr.text.tesseract.TesseractOCR.useOCR=false"]
    cmd += [
        "-batch",
        "-export",
        "-output", output_dir,
        input_path,
    ]
    try:
        proc = subprocess.run(
            cmd,
            env=_jvm_env(),
            capture_output=True,
            text=True,
            timeout=config.AUDIVERIS_TIMEOUT,
        )
    except FileNotFoundError as e:
        raise AudiverisError(
            f"Audiveris launcher not found: {config.AUDIVERIS_CMD}. "
            f"Set AUDIVERIS_CMD to the correct path."
        ) from e
    except subprocess.TimeoutExpired as e:
        raise AudiverisError(
            f"Audiveris timed out after {config.AUDIVERIS_TIMEOUT}s on {input_path}"
        ) from e

    if proc.returncode != 0:
        # Surface the tail of stderr, which usually carries the real cause.
        tail = (proc.stderr or proc.stdout or "").strip()[-1500:]
        raise AudiverisError(f"Audiveris exited with code {proc.returncode}:\n{tail}")

    mxl = _find_mxl(output_dir)
    if mxl is None:
        tail = (proc.stdout or "").strip()[-1500:]
        raise AudiverisError(
            "Audiveris produced no MusicXML output (the score may be "
            f"unrecognizable). Log tail:\n{tail}"
        )
    return _read_musicxml(mxl)


def run_omr_paged(pdf_path: str, output_dir: str) -> "tuple[str, list[int]]":
    """OMR a multi-page PDF one page at a time, then merge the results.

    The PDF is split into single-page PDFs (pdfutil.split_pages) and each page is
    run through Audiveris in its own scratch directory, so the JVM only ever
    holds one page in memory at a time. The per-page MusicXML documents are then
    stitched into one continuous score by mxlmerge.merge_musicxml.

    Use this instead of run_omr for PDFs whose page count exceeds
    config.MAX_PAGES. Raises AudiverisError if no page yields output.

    Returns (musicxml, skipped_pages): a page that Audiveris can't read is skipped
    rather than sinking the whole book, but its 1-based number is returned so the
    caller can warn the user that content is missing (the merge renumbers the
    surviving measures continuously, so the loss is otherwise invisible).
    """
    os.makedirs(output_dir, exist_ok=True)
    pages_dir = os.path.join(output_dir, "pages")
    page_pdfs = pdfutil.split_pages(pdf_path, pages_dir)

    docs: List[str] = []
    skipped: List[int] = []
    errors: List[str] = []
    for i, page_pdf in enumerate(page_pdfs, start=1):
        page_out = os.path.join(output_dir, f"page-{i:03d}-out")
        try:
            docs.append(run_omr(page_pdf, page_out))
        except AudiverisError as e:
            log.warning("run_omr_paged: page %d failed, skipping: %s", i, e)
            skipped.append(i)
            errors.append(f"page {i}: {e}")

    if not docs:
        raise AudiverisError(
            "Audiveris produced no MusicXML output for any of the "
            f"{len(page_pdfs)} pages.\n" + "\n".join(errors)
        )
    return mxlmerge.merge_musicxml(docs), skipped
