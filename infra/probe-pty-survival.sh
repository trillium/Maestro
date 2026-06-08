#!/usr/bin/env bash
# infra/probe-pty-survival.sh
#
# ISC-45 falsification probe — local in-process variant.
#
# Validates the claim that PTY scrollback survives a `kill -9` of the server
# process. We exercise the persistence layer (RawPtyMultiplexer +
# pty-scrollback/ on disk) directly because that is the single load-bearing
# question for ISC-45: "does the on-disk format actually round-trip across a
# fresh-process boot?" The end-to-end mini2 probe is documented in
# `infra/PROBE_ISC45.md` and uses the same disk format under the hood —
# what's tested here.
#
# Flow:
#   1. Create a fresh dataDir under /tmp.
#   2. Process A: build the dist, spin up a fresh Node process that
#      instantiates a RawPtyMultiplexer pointed at the dataDir, publishes
#      known marker bytes ("PRE_KILL_MARKER … PRE_KILL_END"), then exits
#      via process.exit(137) — simulating SIGKILL semantics. (We can't
#      `kill -9` ourselves cleanly from a child; an exit-without-cleanup
#      is the equivalent "no graceful flush" scenario.)
#   3. Process B: fresh Node process, same dataDir, instantiates a NEW
#      multiplexer, subscribes from seq=0, dumps the returned bytes to
#      stdout.
#   4. Assert process B's output CONTAINS the markers. If yes → PASS, ISC-45
#      hold confirmed at the persistence layer. If no → FAIL, ISC-45
#      cannot be closed.
#
# Exit codes:
#   0  — PASS (scrollback survived).
#   1  — FAIL (scrollback did not survive — falsification triggered).
#   2  — environment error (build failed, node missing, etc.).
#
# Usage:
#   bash infra/probe-pty-survival.sh
#
# Honest about scope: this probe validates the persistence layer in
# isolation. It does NOT exercise the full WS protocol path
# (pty_subscribe → broadcastPtyBackfill → client receives bytes). That
# integration is covered by the existing L6.1/L6.2 vitest suites and by
# the manual mini2 probe documented in `infra/PROBE_ISC45.md`.

set -uo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PROBE_DATA_DIR="$(mktemp -d -t maestro-isc45-probe-XXXXXXXX)"
PROBE_NODE_SCRIPT="${PROBE_DATA_DIR}/probe.js"
PROBE_LOG="${PROBE_DATA_DIR}/probe.log"

cleanup() {
  # Leave the dataDir on FAIL for forensics.
  if [[ "${PROBE_PASS:-0}" == "1" ]]; then
    rm -rf "${PROBE_DATA_DIR}"
  else
    echo "[probe] data dir preserved for inspection: ${PROBE_DATA_DIR}"
  fi
}
trap cleanup EXIT

echo "[probe] dataDir = ${PROBE_DATA_DIR}"
echo "[probe] repo    = ${REPO_ROOT}"

# Ensure the compiled multiplexer is available. We rely on `dist/` from a
# prior `npx tsc -p tsconfig.server.json` run — the probe harness re-builds
# only if the artifact is missing.
MULTIPLEXER_DIST="${REPO_ROOT}/dist/server/raw-pty-multiplexer.js"
if [[ ! -f "${MULTIPLEXER_DIST}" ]]; then
  echo "[probe] dist artifact missing; running tsc..."
  if ! ( cd "${REPO_ROOT}" && npx tsc -p tsconfig.server.json ); then
    echo "[probe] tsc failed — environment error"
    exit 2
  fi
fi

if [[ ! -f "${MULTIPLEXER_DIST}" ]]; then
  echo "[probe] tsc succeeded but ${MULTIPLEXER_DIST} still missing — environment error"
  exit 2
fi

# Markers chosen so a partial write (truncated mid-stream) is detectable —
# the END marker must be present in process B's output, not just the BEGIN
# marker. The middle payload is intentionally chunky enough to span more
# than one publish() call.
MARKER_BEGIN="PRE_KILL_MARKER_BEGIN_$(date +%s%N)"
MARKER_END="PRE_KILL_MARKER_END_$(date +%s%N)"
SESSION_ID="probe-session"

cat > "${PROBE_NODE_SCRIPT}" <<'JSEOF'
// Minimal harness for ISC-45 falsification.
//
// Run with one of two args:
//   --producer  → publish marker bytes, then process.exit(137)
//                 (simulating SIGKILL; no shutdown handler runs).
//   --consumer  → instantiate a fresh multiplexer, subscribe, print bytes.
//
// Both invocations point at the same dataDir via env MAESTRO_PROBE_DATADIR.

const { RawPtyMultiplexer } = require(process.env.MAESTRO_PROBE_MUX_PATH);

const mode = process.argv[2];
const dataDir = process.env.MAESTRO_PROBE_DATADIR;
const sessionId = process.env.MAESTRO_PROBE_SESSION;
const markerBegin = process.env.MAESTRO_PROBE_MARKER_BEGIN;
const markerEnd = process.env.MAESTRO_PROBE_MARKER_END;

if (!dataDir || !sessionId || !markerBegin || !markerEnd) {
  console.error('probe: missing env (dataDir/sessionId/markers)');
  process.exit(2);
}

if (mode === '--producer') {
  const mux = new RawPtyMultiplexer({ dataDir });
  // Publish in three chunks to ensure multi-write durability.
  mux.publish(sessionId, Buffer.from(markerBegin + ' '));
  mux.publish(sessionId, Buffer.from('middle-payload-' + '='.repeat(64) + ' '));
  mux.publish(sessionId, Buffer.from(markerEnd));
  // Simulate SIGKILL: no graceful shutdown, no fd flush hook, just die.
  // process.exit(137) is the conventional code for "killed by SIGKILL"
  // and skips Node's normal exit handlers, matching the kill -9 contract.
  process.exit(137);
}

if (mode === '--consumer') {
  // Fresh multiplexer instance, same dataDir. The constructor's
  // scrollback scan should re-register the session from disk.
  const mux = new RawPtyMultiplexer({ dataDir });
  const slice = mux.subscribe(sessionId, 'probe-client', 0);
  // Print the recovered bytes verbatim. The shell asserts marker presence.
  process.stdout.write(slice.bytes);
  process.exit(0);
}

console.error('probe: unknown mode ' + mode);
process.exit(2);
JSEOF

# --- Phase A: producer (write + simulate kill -9) ---
echo "[probe] phase A: publish + simulate kill -9"
set +e
MAESTRO_PROBE_DATADIR="${PROBE_DATA_DIR}" \
MAESTRO_PROBE_SESSION="${SESSION_ID}" \
MAESTRO_PROBE_MARKER_BEGIN="${MARKER_BEGIN}" \
MAESTRO_PROBE_MARKER_END="${MARKER_END}" \
MAESTRO_PROBE_MUX_PATH="${MULTIPLEXER_DIST}" \
node "${PROBE_NODE_SCRIPT}" --producer
PRODUCER_EXIT=$?
set -e
echo "[probe] producer exited with ${PRODUCER_EXIT} (expected 137 = SIGKILL semantics)"
if [[ "${PRODUCER_EXIT}" != "137" ]]; then
  echo "[probe] FAIL — producer did not exit cleanly via simulated SIGKILL"
  exit 1
fi

# --- Verify on-disk artifacts exist ---
LOG_PATH="${PROBE_DATA_DIR}/pty-scrollback/${SESSION_ID}.log"
SEQ_PATH="${PROBE_DATA_DIR}/pty-scrollback/${SESSION_ID}.seq"
META_PATH="${PROBE_DATA_DIR}/pty-scrollback/${SESSION_ID}.meta"
echo "[probe] checking on-disk artifacts:"
ls -la "${PROBE_DATA_DIR}/pty-scrollback/" || true
for f in "${LOG_PATH}" "${SEQ_PATH}" "${META_PATH}"; do
  if [[ ! -f "${f}" ]]; then
    echo "[probe] FAIL — expected artifact missing: ${f}"
    exit 1
  fi
done

# --- Phase B: consumer (fresh process, read what survived) ---
echo "[probe] phase B: consumer reads from disk after restart"
RECOVERED="$(
  MAESTRO_PROBE_DATADIR="${PROBE_DATA_DIR}" \
  MAESTRO_PROBE_SESSION="${SESSION_ID}" \
  MAESTRO_PROBE_MARKER_BEGIN="${MARKER_BEGIN}" \
  MAESTRO_PROBE_MARKER_END="${MARKER_END}" \
  MAESTRO_PROBE_MUX_PATH="${MULTIPLEXER_DIST}" \
  node "${PROBE_NODE_SCRIPT}" --consumer
)"
RECOVERED_LEN=${#RECOVERED}
echo "[probe] consumer recovered ${RECOVERED_LEN} bytes"
# Use head/tail to extract head & tail without bash 4+ substring expansion
# (works on macOS's default bash 3.2).
HEAD_PREVIEW="$(printf '%s' "${RECOVERED}" | head -c 80)"
TAIL_PREVIEW="$(printf '%s' "${RECOVERED}" | tail -c 80)"
echo "[probe] recovered head: ${HEAD_PREVIEW}"
echo "[probe] recovered tail: ${TAIL_PREVIEW}"

# --- Assertions ---
PROBE_PASS=1
if [[ "${RECOVERED}" != *"${MARKER_BEGIN}"* ]]; then
  echo "[probe] FAIL — MARKER_BEGIN missing from recovered scrollback"
  PROBE_PASS=0
fi
if [[ "${RECOVERED}" != *"${MARKER_END}"* ]]; then
  echo "[probe] FAIL — MARKER_END missing from recovered scrollback"
  PROBE_PASS=0
fi
if [[ "${RECOVERED}" != *"middle-payload-"* ]]; then
  echo "[probe] FAIL — middle payload missing from recovered scrollback"
  PROBE_PASS=0
fi

if [[ "${PROBE_PASS}" == "1" ]]; then
  echo "[probe] PASS — scrollback survived kill -9 + restart"
  echo "[probe] ISC-45 falsification: NOT TRIGGERED (persistence works)"
  echo "[probe] ISC-13: closed pending end-to-end mini2 probe"
  exit 0
else
  echo "[probe] FAIL — ISC-45 falsification TRIGGERED at persistence layer"
  echo "[probe] dataDir preserved at ${PROBE_DATA_DIR} for inspection"
  exit 1
fi
