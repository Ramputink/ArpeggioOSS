"""Image preprocessing performed before handing pages to Audiveris.

This is what improves optical music recognition the most: deskewing, cropping
away margins (autocrop), binarizing, and normalizing resolution to ~300 dpi.

Supported inputs: a single image (PNG/JPG/TIFF/BMP) or a PDF. In both cases the
output is a clean one-or-many-page PDF, so Audiveris treats it as a coherent
"book".
"""
from __future__ import annotations

import os
from typing import List

import cv2
import fitz  # PyMuPDF
import numpy as np

from . import config


# ---------------------------------------------------------------------------
# Single-page operations (numpy BGR/GRAY arrays)
# ---------------------------------------------------------------------------
def _to_gray(img: np.ndarray) -> np.ndarray:
    if img.ndim == 3:
        return cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    return img


def _deskew(gray: np.ndarray) -> np.ndarray:
    """Straighten the page by estimating the dominant angle of the dark content.

    Uses the minimum-area rectangle over the ink pixels. The correction is
    clamped to +/-15 degrees so we never over-rotate pages that are already
    straight or too noisy to estimate reliably.
    """
    # Ink = dark pixels. Invert so the content becomes the foreground.
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = np.column_stack(np.where(thresh > 0))
    if coords.shape[0] < 50:  # essentially blank: leave untouched
        return gray
    angle = cv2.minAreaRect(coords)[-1]
    # minAreaRect returns an angle in (-90, 0]; normalize to a small rotation.
    if angle < -45:
        angle = 90 + angle
    if abs(angle) < 0.2 or abs(angle) > 15:
        return gray  # already straight, or estimate not trustworthy
    h, w = gray.shape
    m = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    return cv2.warpAffine(
        gray, m, (w, h), flags=cv2.INTER_CUBIC,
        borderMode=cv2.BORDER_REPLICATE,
    )


def _autocrop(gray: np.ndarray, margin: int = 40) -> np.ndarray:
    """Crop to the content bounding box, leaving a small white margin."""
    thresh = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)[1]
    coords = cv2.findNonZero(thresh)
    if coords is None:
        return gray
    x, y, w, h = cv2.boundingRect(coords)
    H, W = gray.shape
    x0 = max(0, x - margin)
    y0 = max(0, y - margin)
    x1 = min(W, x + w + margin)
    y1 = min(H, y + h + margin)
    return gray[y0:y1, x0:x1]


def _binarize(gray: np.ndarray) -> np.ndarray:
    """Binarize. Adaptive thresholding copes better with uneven photo lighting."""
    return cv2.adaptiveThreshold(
        gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY,
        blockSize=31, C=15,
    )


def preprocess_page(img: np.ndarray) -> np.ndarray:
    """Full per-page pipeline: gray -> deskew -> autocrop -> binarize."""
    gray = _to_gray(img)
    gray = _deskew(gray)
    gray = _autocrop(gray)
    return _binarize(gray)


# ---------------------------------------------------------------------------
# Loading pages from the different input formats
# ---------------------------------------------------------------------------
def _load_image_pages(path: str) -> List[np.ndarray]:
    img = cv2.imread(path, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError(f"Could not read image: {path}")
    return [img]


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

    Uses PyMuPDF (already a dependency for rasterization) rather than img2pdf, so
    we avoid the pikepdf/qpdf build chain that has no wheel on the macOS 11
    backend. Each page is sized so its pixels resolve at exactly `dpi`, keeping
    the physical scale correct for Audiveris.
    """
    doc = fitz.open()
    try:
        for page in pages:
            ok, buf = cv2.imencode(".png", page)
            if not ok:
                raise RuntimeError("Failed to encode page to PNG")
            png = buf.tobytes()
            h_px, w_px = page.shape[:2]
            # Convert pixel dimensions to PDF points (72 pt/inch) at target DPI.
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
