"""Thin wrapper around the Audiveris OMR engine, run in headless batch mode.

Audiveris (https://github.com/Audiveris/audiveris, v5.10.2, JDK 21) is a Java
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
import os
import subprocess
import zipfile
from typing import Optional

from . import config


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
    cmd = [
        config.AUDIVERIS_CMD,
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
