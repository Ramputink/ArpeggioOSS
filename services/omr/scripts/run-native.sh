#!/usr/bin/env bash
#
# Start the Arpeggio OMR service in native mode (no Docker).
# Run scripts/install-native.sh once first; it generates .native/env.sh.
#
set -euo pipefail

SERVICE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # services/omr
ENV_FILE="${SERVICE_DIR}/.native/env.sh"

if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found. Run scripts/install-native.sh first." >&2
  exit 1
fi

# shellcheck source=/dev/null
source "${ENV_FILE}"

export OMR_HOST="${OMR_HOST:-0.0.0.0}"
export OMR_PORT="${OMR_PORT:-8000}"
export OMR_JVM_HEAP="${OMR_JVM_HEAP:-2g}"

# Honor OMR_STATIC_DIR if already exported (path to the built web app,
# apps/web/dist); leave it untouched so the service serves the frontend too.
export OMR_STATIC_DIR="${OMR_STATIC_DIR:-}"

# Optional TLS: serve HTTPS when OMR_TLS is 1/true AND the certs exist. HTTPS is
# what makes the browser microphone (getUserMedia) work off localhost. Generate
# the certs once with scripts/make-cert.sh.
CERT_DIR="${HOME}/arpeggio/certs"
SSL_ARGS=()
SCHEME="http"
case "${OMR_TLS:-0}" in
  1|true|TRUE|yes|YES)
    if [ -f "${CERT_DIR}/cert.pem" ] && [ -f "${CERT_DIR}/key.pem" ]; then
      SSL_ARGS=(--ssl-keyfile "${CERT_DIR}/key.pem" --ssl-certfile "${CERT_DIR}/cert.pem")
      SCHEME="https"
    else
      echo "WARNING: OMR_TLS set but certs missing in ${CERT_DIR}; run scripts/make-cert.sh. Falling back to http." >&2
    fi
    ;;
esac

echo "==> Audiveris:  ${AUDIVERIS_CMD}"
if [ -n "${OMR_STATIC_DIR}" ]; then
  echo "==> Serving web app from ${OMR_STATIC_DIR}"
fi
echo "==> Listening on ${SCHEME}://${OMR_HOST}:${OMR_PORT} (LAN-reachable)"

cd "${SERVICE_DIR}"
exec "${VENV_DIR}/bin/uvicorn" app.main:app \
  --host "${OMR_HOST}" --port "${OMR_PORT}" "${SSL_ARGS[@]+"${SSL_ARGS[@]}"}"
