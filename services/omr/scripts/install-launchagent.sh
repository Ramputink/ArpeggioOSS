#!/usr/bin/env bash
#
# Install (or remove) the launchd LaunchAgent that auto-starts the Arpeggio OMR
# service and keeps it alive across crashes, logout and reboot — all in userland,
# no sudo. Run this ON THE MAC after install-native-nobrew.sh has provisioned
# everything under ~/arpeggio.
#
# Usage:
#   bash scripts/install-launchagent.sh            # install + load
#   bash scripts/install-launchagent.sh uninstall  # stop + remove
#
set -euo pipefail

LABEL="com.arpeggio.omr"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"   # services/omr/scripts
SRC_PLIST="${SCRIPT_DIR}/${LABEL}.plist"
AGENTS_DIR="${HOME}/Library/LaunchAgents"
DEST_PLIST="${AGENTS_DIR}/${LABEL}.plist"
UID_NUM="$(id -u)"
DOMAIN="gui/${UID_NUM}"

# Best-effort unload, tolerant of "not loaded". Tries modern bootout first,
# then legacy unload. Used both by uninstall and before a reinstall (idempotency).
unload_agent() {
  launchctl bootout "${DOMAIN}/${LABEL}" 2>/dev/null || true
  launchctl unload -w "${DEST_PLIST}" 2>/dev/null || true
}

if [ "${1:-}" = "uninstall" ]; then
  echo "==> Unloading ${LABEL}"
  unload_agent
  rm -f "${DEST_PLIST}"
  echo "==> Removed ${DEST_PLIST}"
  echo "==> Done. The service will no longer auto-start."
  exit 0
fi

# Guard: the native env must exist, i.e. install-native-nobrew.sh has run.
ENV_FILE="${HOME}/arpeggio/omr/.native/env.sh"
if [ ! -f "${ENV_FILE}" ]; then
  echo "ERROR: ${ENV_FILE} not found." >&2
  echo "       Run 'bash scripts/install-native-nobrew.sh' first, then retry." >&2
  exit 1
fi

# Copy the plist into LaunchAgents, substituting __HOME__ -> real absolute $HOME.
# launchd does not expand ~ or $HOME, so paths must be fully resolved on disk.
echo "==> Installing LaunchAgent to ${DEST_PLIST}"
mkdir -p "${AGENTS_DIR}"
sed "s|__HOME__|${HOME}|g" "${SRC_PLIST}" > "${DEST_PLIST}"

# Idempotent (re)load: unload any previous instance, then load fresh. Prefer the
# modern bootstrap syntax; fall back to legacy load -w on older launchctl.
echo "==> (Re)loading ${LABEL}"
unload_agent
if ! launchctl bootstrap "${DOMAIN}" "${DEST_PLIST}" 2>/dev/null; then
  echo "    bootstrap unavailable, falling back to legacy load -w"
  launchctl load -w "${DEST_PLIST}"
fi

cat <<EOF

==> Installed. The OMR service now starts at login and restarts if it crashes.

Check status:
  launchctl print ${DOMAIN}/${LABEL}
  launchctl list | grep arpeggio

Tail the log:
  tail -f ${HOME}/arpeggio/service.log

Stop / uninstall:
  bash scripts/install-launchagent.sh uninstall
  # or manually:  launchctl bootout ${DOMAIN}/${LABEL}
EOF
