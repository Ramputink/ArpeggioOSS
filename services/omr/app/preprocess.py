"""Image preprocessing performed before handing pages to Audiveris.

This is what improves optical music recognition the most: deskewing, cropping
away margins (autocrop), binarizing, and normalizing resolution to ~300 dpi.

Implemented with Pillow + NumPy (and PyMuPDF for PDF I/O) rather than OpenCV:
the OpenCV x86_64 wheels bundle native libs built for newer macOS and fail to
load on the Big Sur (macOS 11) backend. Pillow/NumPy have no such issue.

Supported inputs: a single image (PNG/JPG/TIFF/BMP) or a PDF. In both cases the
output is a clean one-or-many-page PDF, so Audiveris treats it as a coherent
"book".
"""
from __future__ import annotations

import io
import os
from typing import List

import fitz  # PyMuPDF
import numpy as np
from PIL import Image

from . import config


# ---------------------------------------------------------------------------
# Single-page operations (grayscale uint8 numpy arrays)
# ---------------------------------------------------------------------------
def _otsu_threshold(gray: np.ndarray) -> int:
    """Classic Otsu global threshold on an 8-bit grayscale image."""
    hist = np.bincount(gray.ravel(), minlength=256).astype(np.float64)
    total = gray.size
    sum_all = float(np.dot(np.arange(256), hist))
    w_b = 0.0
    sum_b = 0.0
    max_var = -1.0
    threshold = 127
    for t in range(256):
        w_b += hist[t]
        if w_b == 0:
            continue
        w_f = total - w_b
        if w_f == 0:
            break
        sum_b += t * hist[t]
        m_b = sum_b / w_b
        m_f = (sum_all - sum_b) / w_f
        between = w_b * w_f * (m_b - m_f) ** 2
        # `>=` so a perfectly bimodal image (a clean black/white scan, where every
        # threshold in [0, 254] scores equally) resolves to the highest usable
        # threshold rather than 0 — otherwise the ink mask would come out empty.
        if between >= max_var:
            max_var = between
            threshold = t
    return threshold


def _deskew(gray: np.ndarray) -> np.ndarray:
    """Straighten the page via a projection-profile search.

    Music staves are strongly horizontal, so the rotation whose row-sum profile
    has the highest variance (sharpest lines) is the one that levels them. The
    search runs on a downscaled ink mask for speed and is clamped to +/-8 deg.
    """
    thr = _otsu_threshold(gray)
    ink = (gray < thr).astype(np.uint8) * 255
    if int(ink.sum()) < 50 * 255:  # essentially blank
        return gray

    mask = Image.fromarray(ink)
    # Downscale the search image so 33 rotations stay cheap on 300-dpi pages.
    longest = max(mask.size)
    if longest > 900:
        s = 900.0 / longest
        mask = mask.resize((max(1, int(mask.size[0] * s)), max(1, int(mask.size[1] * s))))

    best_angle = 0.0
    best_score = -1.0
    for angle in np.arange(-8.0, 8.0001, 0.5):
        rot = mask.rotate(float(angle), resample=Image.BILINEAR, fillcolor=0)
        rows = np.asarray(rot, dtype=np.float32).sum(axis=1)
        score = float(np.var(rows))
        if score > best_score:
            best_score = score
            best_angle = float(angle)

    if abs(best_angle) < 0.25:
        return gray  # already straight
    rotated = Image.fromarray(gray).rotate(
        best_angle, resample=Image.BICUBIC, fillcolor=255
    )
    return np.asarray(rotated)


def _autocrop(gray: np.ndarray, margin: int = 40) -> np.ndarray:
    """Crop to the content bounding box, leaving a small white margin."""
    thr = _otsu_threshold(gray)
    # Bounding box of the ink (dark) pixels.
    ink = Image.fromarray((gray < thr).astype(np.uint8) * 255)
    bbox = ink.getbbox()
    if bbox is None:
        return gray
    x0, y0, x1, y1 = bbox
    h, w = gray.shape
    x0 = max(0, x0 - margin)
    y0 = max(0, y0 - margin)
    x1 = min(w, x1 + margin)
    y1 = min(h, y1 + margin)
    return gray[y0:y1, x0:x1]


def _binarize_adaptive(gray: np.ndarray, block: int = 31, c: int = 15) -> np.ndarray:
    """Adaptive mean threshold (like OpenCV's ADAPTIVE_THRESH_MEAN_C).

    Uses an integral image so each pixel's local mean is an O(1) lookup; copes
    with the uneven lighting typical of phone photos better than a global Otsu.
    """
    g = gray.astype(np.float64)
    h, w = g.shape
    integral = np.pad(g, ((1, 0), (1, 0)), mode="constant").cumsum(0).cumsum(1)
    r = block // 2

    ys = np.arange(h)
    xs = np.arange(w)
    y0 = np.clip(ys - r, 0, h)[:, None]
    y1 = np.clip(ys + r + 1, 0, h)[:, None]
    x0 = np.clip(xs - r, 0, w)[None, :]
    x1 = np.clip(xs + r + 1, 0, w)[None, :]

    area = (y1 - y0) * (x1 - x0)
    total = integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]
    local_mean = total / area
    out = np.where(g < (local_mean - c), 0, 255).astype(np.uint8)
    return out


def preprocess_page(gray: np.ndarray) -> np.ndarray:
    """Full per-page pipeline on a grayscale array: deskew -> autocrop -> binarize."""
    gray = _deskew(gray)
    gray = _autocrop(gray)
    return _binarize_adaptive(gray)


# ---------------------------------------------------------------------------
# Loading pages from the different input formats (always -> grayscale arrays)
# ---------------------------------------------------------------------------
def _load_image_pages(path: str) -> List[np.ndarray]:
    with Image.open(path) as img:
        return [np.asarray(img.convert("L"))]


def _load_pdf_pages(path: str, dpi: int) -> List[np.ndarray]:
    """Rasterize every PDF page to a grayscale numpy array at the target DPI."""
    pages: List[np.ndarray] = []
    zoom = dpi / 72.0  # PDF user space is 72 dpi
    doc = fitz.open(path)
    try:
        for page in doc:
            pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), colorspace=fitz.csGRAY)
            arr = np.frombuffer(pix.samples, dtype=np.uint8).reshape(pix.height, pix.width)
            pages.append(arr.copy())
    finally:
        doc.close()
    return pages


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------
def _pages_to_pdf(pages: List[np.ndarray], out_pdf: str, dpi: int) -> None:
    """Save a list of binarized pages as a single PDF at `dpi`.

    Uses PyMuPDF so we avoid extra PDF-writing dependencies. Each page is sized
    so its pixels resolve at exactly `dpi`, keeping the physical scale correct
    for Audiveris.
    """
    doc = fitz.open()
    try:
        for page in pages:
            buf = io.BytesIO()
            Image.fromarray(page).save(buf, format="PNG")
            png = buf.getvalue()
            h_px, w_px = page.shape[:2]
            w_pt = w_px * 72.0 / dpi
            h_pt = h_px * 72.0 / dpi
            pdf_page = doc.new_page(width=w_pt, height=h_pt)
            pdf_page.insert_image(fitz.Rect(0, 0, w_pt, h_pt), stream=png)
        doc.save(out_pdf)
    finally:
        doc.close()


def preprocess_to_pdf(input_path: str, out_pdf: str, dpi: int | None = None) -> int:
    """Preprocess `input_path` (image or PDF) and write a clean PDF to `out_pdf`.

    Returns the number of processed pages.
    """
    dpi = dpi or config.TARGET_DPI
    ext = os.path.splitext(input_path)[1].lower()
    if ext == ".pdf":
        raw_pages = _load_pdf_pages(input_path, dpi)
    else:
        raw_pages = _load_image_pages(input_path)

    processed = [preprocess_page(p) for p in raw_pages]
    _pages_to_pdf(processed, out_pdf, dpi)
    return len(processed)
