"""FastAPI application exposing the OMR pipeline over HTTP.

Endpoints
---------
GET  /health  -> liveness probe + reported Audiveris version.
POST /omr     -> accept an image/PDF score, return MusicXML.

The full request flow is:

    upload -> (optional) Pillow preprocessing -> Audiveris batch OMR -> MusicXML

Everything runs on the backend machine (an old Intel MacBook on the LAN); the
service binds 0.0.0.0 so the dev machine and, later, the iPhone can reach it.

When config.STATIC_DIR points at the built web app (apps/web/dist), the service
also serves it at "/", so backend + frontend ship as one deployable unit and the
browser microphone (getUserMedia, needs a secure context) works over HTTPS.
"""
from __future__ import annotations

import os
import shutil
import tempfile
import uuid

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.staticfiles import StaticFiles

from . import audiveris, config, pdfutil, preprocess

app = FastAPI(
    title="Arpeggio OMR service",
    description="Optical Music Recognition: sheet image/PDF -> MusicXML, via Audiveris.",
    version="0.1.0",
)

# Allow the dev web app (e.g. http://localhost:5173) to call the API from a
# different origin. "*" -> allow all; otherwise a comma-separated allowlist.
_cors_origins = ["*"] if config.CORS_ORIGINS.strip() == "*" else [
    o.strip() for o in config.CORS_ORIGINS.split(",") if o.strip()
]
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> JSONResponse:
    """Liveness probe. Reports the Audiveris version this service targets."""
    return JSONResponse(
        {
            "status": "ok",
            "service": "arpeggio-omr",
            "audiveris_version": config.AUDIVERIS_VERSION,
        }
    )


@app.post("/omr", response_class=PlainTextResponse)
async def omr(
    file: UploadFile = File(...),
    do_preprocess: bool = Query(
        True,
        alias="preprocess",
        description="Run image preprocessing (deskew/crop/binarize/300dpi) before OMR.",
    ),
) -> PlainTextResponse:
    """Recognize an uploaded score and return MusicXML as plain text.

    Query params
    ------------
    preprocess : bool (default true)
        When false, the raw upload is fed straight to Audiveris. Useful to A/B
        the effect of preprocessing, or for already-clean scans.
    """
    filename = file.filename or "upload"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in config.ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file type '{ext}'. "
                   f"Allowed: {sorted(config.ALLOWED_EXTENSIONS)}",
        )

    os.makedirs(config.WORK_DIR, exist_ok=True)
    job_dir = tempfile.mkdtemp(prefix=f"job-{uuid.uuid4().hex[:8]}-", dir=config.WORK_DIR)
    upload_path = os.path.join(job_dir, f"input{ext}")

    try:
        # 1. Persist the upload to disk (Audiveris works on files, not streams).
        with open(upload_path, "wb") as out:
            shutil.copyfileobj(file.file, out)
        if os.path.getsize(upload_path) == 0:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")

        # 2. Optional preprocessing -> always yields a clean PDF for Audiveris.
        if do_preprocess:
            omr_input = os.path.join(job_dir, "clean.pdf")
            n_pages = preprocess.preprocess_to_pdf(upload_path, omr_input)
        else:
            omr_input = upload_path
            n_pages = pdfutil.page_count(upload_path) if ext == ".pdf" else 1

        # 3. Run Audiveris. Long PDFs are OMR'd page by page and merged, so the
        #    JVM only ever holds one page at a time; short inputs take the
        #    single-shot path. A PDF is required to split, so paging only applies
        #    when omr_input is actually a PDF (always true after preprocessing).
        output_dir = os.path.join(job_dir, "out")
        is_pdf = os.path.splitext(omr_input)[1].lower() == ".pdf"
        headers: dict[str, str] = {}
        if is_pdf and n_pages > config.MAX_PAGES:
            musicxml, skipped = audiveris.run_omr_paged(omr_input, output_dir)
            if skipped:
                # Surface silently-dropped pages so the caller knows content is
                # missing (the merge renumbers surviving measures continuously).
                headers["X-OMR-Warning"] = (
                    f"pages not recognized and omitted: {skipped}"
                )
        else:
            musicxml = audiveris.run_omr(omr_input, output_dir)

        return PlainTextResponse(
            content=musicxml,
            media_type="application/vnd.recordare.musicxml+xml",
            headers=headers,
        )
    except audiveris.AudiverisError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    finally:
        # Best-effort cleanup of the per-job scratch directory.
        shutil.rmtree(job_dir, ignore_errors=True)


# Serve the built web app at "/" as the very last route so it never shadows the
# API routes above. html=True makes it fall back to index.html (SPA routing).
# Mounted only when OMR_STATIC_DIR is set and actually exists on disk.
if config.STATIC_DIR and os.path.isdir(config.STATIC_DIR):
    app.mount(
        "/",
        StaticFiles(directory=config.STATIC_DIR, html=True),
        name="web",
    )
