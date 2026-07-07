"""PDF helpers: counting pages and splitting long documents.

Long scores are split into single-page PDFs so each page can be OMR'd
independently, keeping the JVM heap footprint bounded on the modest backend
machine. The per-page MusicXML is then stitched back into one continuous score
by mxlmerge.merge_musicxml (wired up in audiveris.run_omr_paged).
"""
from __future__ import annotations

import os
from typing import List

import fitz  # PyMuPDF


def page_count(pdf_path: str) -> int:
    doc = fitz.open(pdf_path)
    try:
        return doc.page_count
    finally:
        doc.close()


def split_pages(pdf_path: str, out_dir: str) -> List[str]:
    """Write each page of `pdf_path` as its own single-page PDF in `out_dir`.

    Returns the list of generated page-PDF paths, in order.
    """
    os.makedirs(out_dir, exist_ok=True)
    out_paths: List[str] = []
    src = fitz.open(pdf_path)
    try:
        for i in range(src.page_count):
            single = fitz.open()
            single.insert_pdf(src, from_page=i, to_page=i)
            out_path = os.path.join(out_dir, f"page_{i + 1:03d}.pdf")
            single.save(out_path)
            single.close()
            out_paths.append(out_path)
    finally:
        src.close()
    return out_paths
