#!/bin/zsh
set -euo pipefail

REPO_DIR="/Users/brandonduke/Projects/DYOOR"
PLIST_PATH="${REPO_DIR}/launchd/com.dyoor.s2.remaining-airdrop.plist"
LOCK_DIR="${REPO_DIR}/airdrop-manifests/.remaining-airdrop-609.lock"
RUN_ID="$(date +%Y%m%d-%H%M%S)"
LOG_DIR="${REPO_DIR}/airdrop-manifests/logs"
REPORT_PATH="${REPO_DIR}/airdrop-manifests/dyoor-s2-remaining-airdrop-609.execution-${RUN_ID}.json"
NODE_BIN="/Users/brandonduke/.nvm/versions/node/v24.14.1/bin/node"

mkdir -p "${LOG_DIR}"
cd "${REPO_DIR}"

if ! mkdir "${LOCK_DIR}" 2>/dev/null; then
  echo "A remaining-airdrop lock already exists at ${LOCK_DIR}; refusing duplicate execution."
  exit 1
fi

cleanup() {
  rmdir "${LOCK_DIR}" 2>/dev/null || true
  /bin/launchctl bootout "gui/$(id -u)" "${PLIST_PATH}" 2>/dev/null || true
}
trap cleanup EXIT

echo "Starting D.Y.O.O.R S2 remaining airdrop at $(date -Iseconds)"
echo "Report path: ${REPORT_PATH}"

EXECUTE_S2_AIRDROP=1 \
S2_AIRDROP_CONFIRMATION=AIRDROP_609_DYOOR_MAINNET \
"${NODE_BIN}" scripts/execute-s2-airdrop.js \
  --input airdrop-manifests/dyoor-s2-remaining-airdrop-609.csv \
  --batch-size 25 \
  --report "${REPORT_PATH}"

echo "Completed D.Y.O.O.R S2 remaining airdrop at $(date -Iseconds)"
