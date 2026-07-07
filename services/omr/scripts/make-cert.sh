#!/usr/bin/env bash
#
# Generate a self-signed TLS cert (key.pem + cert.pem) under ~/arpeggio/certs/,
# so the OMR service can serve HTTPS. A secure context (https or localhost) is
# required for the browser microphone (getUserMedia).
#
# The cert carries a SAN for the LAN IP (192.168.0.23) and localhost, so browsers
# accept it after a one-time "proceed anyway" warning (self-signed CA).
#
# Idempotent: skips generation if the certs already exist, unless --force.
#
set -euo pipefail

LAN_IP="${OMR_LAN_IP:-192.168.0.23}"
CERT_DIR="${HOME}/arpeggio/certs"
KEY_FILE="${CERT_DIR}/key.pem"
CERT_FILE="${CERT_DIR}/cert.pem"
DAYS="${OMR_CERT_DAYS:-825}"

FORCE=0
if [ "${1:-}" = "--force" ]; then
  FORCE=1
fi

if [ "${FORCE}" -eq 0 ] && [ -f "${KEY_FILE}" ] && [ -f "${CERT_FILE}" ]; then
  echo "==> Certs already exist: ${CERT_FILE}"
  echo "    (use --force to regenerate)"
  exit 0
fi

mkdir -p "${CERT_DIR}"

echo "==> Generating self-signed TLS cert for ${LAN_IP} + localhost"
# macOS ships LibreSSL, whose `openssl req` has no `-addext`. Use a temp config
# with the SAN in [v3_req] and `-extensions` — portable across LibreSSL/OpenSSL.
CONF="$(mktemp -t arpeggio-cert)"
trap 'rm -f "${CONF}"' EXIT
cat > "${CONF}" <<EOF
[req]
distinguished_name = dn
x509_extensions = v3_req
prompt = no
[dn]
CN = ${LAN_IP}
[v3_req]
subjectAltName = IP:${LAN_IP},IP:127.0.0.1,DNS:localhost
EOF
set -x
openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "${KEY_FILE}" \
  -out "${CERT_FILE}" \
  -days "${DAYS}" \
  -config "${CONF}" -extensions v3_req
set +x

echo "==> Wrote:"
echo "    ${KEY_FILE}"
echo "    ${CERT_FILE}"
echo "==> Enable HTTPS by starting the service with OMR_TLS=1 (see run-native.sh)."
