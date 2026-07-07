#!/usr/bin/env bash
#
# Install the Arpeggio OMR service as a macOS LaunchDaemon (system domain).
#
# Use this on a HEADLESS backend reached over SSH: unlike a LaunchAgent, a
# LaunchDaemon starts at BOOT with no GUI login and can be (un)loaded over SSH.
# It requires root, but runs the service as the normal user (via UserName in the
# plist) so the userland install under ~/arpeggio is used.
#
# Usage (on the Mac, over SSH is fine):
#   sudo bash scripts/install-launchdaemon.sh            # install + load
#   sudo bash scripts/install-launchdaemon.sh uninstall  # unload + remove
#
set -euo pipefail

LABEL="com.arpeggio.omr"
DEST="/Library/LaunchDaemons/${LABEL}.plist"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SRC="${SCRIPT_DIR}/com.arpeggio.omr.daemon.plist"

if [ "$(id -u)" != "0" ]; then
  echo "ERROR: must run as root. Try: sudo bash scripts/install-launchdaemon.sh" >&2
  exit 1
fi

# The service runs as the invoking (non-root) user; SUDO_USER is that user.
TARGET_USER="${SUDO_USER:-matveypro}"
TARGET_HOME="$(eval echo "~${TARGET_USER}")"

unload() {
  # Modern bootout, then legacy unload; both tolerant of "not loaded".
  launchctl bootout "system/${LABEL}" 2>/dev/null || true
  launchctl unload -w "${DEST}" 2>/dev/null || true
}

if [ "${1:-}" = "uninstall" ]; then
  echo "==> Uninstalling ${LABEL}"
  unload
  rm -f "${DEST}"
  echo "==> Removed ${DEST}"
  exit 0
fi

# Sanity: the native install must have run (generates .native/env.sh).
if [ ! -f "${TARGET_HOME}/arpeggio/omr/.native/env.sh" ]; then
  echo "ERROR: ${TARGET_HOME}/arpeggio/omr/.native/env.sh not found." >&2
  echo "       Run scripts/install-native-nobrew.sh first." >&2
  exit 1
fi

echo "==> Installing LaunchDaemon for user '${TARGET_USER}' (home ${TARGET_HOME})"
sed -e "s|__USER__|${TARGET_USER}|g" -e "s|__HOME__|${TARGET_HOME}|g" "${SRC}" > "${DEST}"
chown root:wheel "${DEST}"
chmod 644 "${DEST}"

# Free port 8000 if a manual `nohup run-native.sh` instance is still running,
# so the daemon's uvicorn can bind cleanly.
pkill -f "uvicorn app.main" 2>/dev/null || true

echo "==> (Re)loading ${LABEL}"
unload
launchctl bootstrap system "${DEST}"
launchctl enable "system/${LABEL}" 2>/dev/null || true

# Remove the per-user LaunchAgent variant if present: keeping both would make the
# agent (on GUI login) and this daemon fight over port 8000.
AGENT_PLIST="${TARGET_HOME}/Library/LaunchAgents/${LABEL}.plist"
if [ -f "${AGENT_PLIST}" ]; then
  sudo -u "${TARGET_USER}" launchctl bootout "gui/$(id -u "${TARGET_USER}")/${LABEL}" 2>/dev/null || true
  rm -f "${AGENT_PLIST}"
  echo "==> Removed the redundant LaunchAgent (${AGENT_PLIST})"
fi

echo "==> Done. The service now starts at boot and restarts on crash."
echo "    Status:  sudo launchctl print system/${LABEL}"
echo "    Log:     tail -f ${TARGET_HOME}/arpeggio/service.log"
echo "    Stop:    sudo bash scripts/install-launchdaemon.sh uninstall"
