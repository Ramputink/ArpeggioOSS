# syntax=docker/dockerfile:1
#
# Arpeggio OMR service — x86_64 image for the old Intel MacBook backend.
#
# Multi-stage:
#   1) builder  — JDK 25 + Gradle build of Audiveris 5.10.2 from source.
#   2) runtime  — JRE 25 + Python + Tesseract data + the FastAPI service.
#
# Build this ON the amd64 target (the Intel Mac) to avoid slow qemu emulation:
#   docker compose up -d --build
#
# ---------------------------------------------------------------------------
# Stage 1: build Audiveris from source
# ---------------------------------------------------------------------------
FROM eclipse-temurin:25-jdk AS builder

ARG AUDIVERIS_REF=5.10.2
ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
        git ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /src
# Shallow-clone just the pinned release tag.
RUN git clone --depth 1 --branch "${AUDIVERIS_REF}" \
        https://github.com/Audiveris/audiveris.git .

# Gradle needs a tessdata dir present to finish the build; provide an empty one.
ENV TESSDATA_PREFIX=/src/tessdata
RUN mkdir -p /src/tessdata

# Build the runnable distribution (produces app/build/distributions/app-<ver>.tar).
RUN ./gradlew --no-daemon build -x test

# Unpack the tar into a stable location: /opt/audiveris/<extracted>/bin/Audiveris
RUN mkdir -p /opt/audiveris \
    && tar -xf app/build/distributions/app-*.tar -C /opt/audiveris \
    && ln -s /opt/audiveris/app-*/bin/Audiveris /opt/audiveris/Audiveris

# ---------------------------------------------------------------------------
# Stage 2: runtime
# ---------------------------------------------------------------------------
FROM eclipse-temurin:25-jre AS runtime

ENV DEBIAN_FRONTEND=noninteractive

# Python + OpenCV/PyMuPDF runtime libs + Tesseract English language data.
# Audiveris embeds the Tesseract native libraries via javacpp, so we only need
# the traineddata files here (not the tesseract binary itself).
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        libglib2.0-0 \
        tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Point Audiveris/Tesseract at the English traineddata shipped by the distro.
# Debian installs it under /usr/share/tesseract-ocr/<ver>/tessdata.
RUN mkdir -p /opt/tessdata \
    && cp "$(find /usr/share -name 'eng.traineddata' | head -1)" /opt/tessdata/
ENV TESSDATA_PREFIX=/opt/tessdata

# Bring in the built Audiveris distribution from stage 1.
COPY --from=builder /opt/audiveris /opt/audiveris
ENV AUDIVERIS_CMD=/opt/audiveris/Audiveris
ENV AUDIVERIS_VERSION=5.10.2

# Python virtualenv for the service (keeps it off the system interpreter).
ENV VENV=/opt/venv
RUN python3 -m venv "$VENV"
ENV PATH="$VENV/bin:$PATH"

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY app ./app

# Heap cap + working dir defaults (overridable via compose/env).
ENV OMR_JVM_HEAP=2g \
    OMR_WORK_DIR=/tmp/omr-work \
    OMR_HOST=0.0.0.0 \
    OMR_PORT=8000

EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
