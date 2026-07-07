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

echo "==> Audiveris:  ${AUDIVERIS_CMD}"
echo "==> Listening on ${OMR_HOST}:${OMR_PORT} (LAN-reachable)"

cd "${SERVICE_DIR}"
exec "${VENV_DIR}/bin/uvicorn" app.main:app --host "${OMR_HOST}" --port "${OMR_PORT}"
