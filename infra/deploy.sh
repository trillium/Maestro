#!/usr/bin/env bash
#
# infra/deploy.sh — mini2 deploy script for Maestro headless server.
#
# Runs on mini2. Pulls latest from origin/main, installs deps, builds the
# server bundle (`dist/server/index.js`), and bootout+bootstrap the launchd
# LaunchAgent at `com.maestro.server`. Health-probes the listening port and
# tails the error log on failure.
#
# Pre-conditions (see infra/DEPLOY_SPIKE.md):
#   - Tailscale running and joined to the tailnet.
#   - Node 22.x installed (via fnm or system). This script assumes fnm.
#   - Repo cloned at $HOME/code/maestro (working directory = repo root).
#   - infra/com.maestro.server.plist's NODE_PATH placeholder verified
#     against the actual node binary on mini2 (see runbook §Prerequisites).
#
# Idempotent: re-running after a no-op `git pull` still rebuilds and reloads.
# Exit code 0 = server responding on the configured port; non-zero = inspect
# logs.
#
# Modes:
#   ./infra/deploy.sh              — full deploy + basic curl health check
#                                    (default; original behavior).
#   ./infra/deploy.sh --probe      — SKIP deploy; only run the falsification
#                                    probe against the on-disk scrollback
#                                    layer. Use to verify L6.3 persistence
#                                    on the running mini2 without touching
#                                    the launchd service or the running
#                                    server.
#   ./infra/deploy.sh --auto-probe — full deploy + curl health check, then
#                                    run infra/probe-pty-survival.sh to
#                                    confirm PTY scrollback survives a
#                                    simulated kill -9 + restart.
#
# MAESTRO_HEADLESS=1 is exported automatically by this script so the
# postinstall hook in package.json skips `electron-rebuild` (broken on a
# headless host because the Electron Node ABI is not the same as the
# system Node ABI used by `node dist/server/index.js`). Desktop dev
# workflows that invoke `npm install` outside this script keep the
# original behavior because the env var is unset.

set -euo pipefail

# ─── Mode parsing ────────────────────────────────────────────────────────
MODE="deploy"
case "${1:-}" in
  --probe)
    MODE="probe-only"
    ;;
  --auto-probe)
    MODE="deploy-and-probe"
    ;;
  "")
    MODE="deploy"
    ;;
  *)
    echo "[deploy] unknown argument: $1"
    echo "[deploy] usage: $0 [--probe | --auto-probe]"
    exit 2
    ;;
esac

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

echo "[deploy] repo root: $REPO_ROOT"
echo "[deploy] user: $(id -un) (uid=$(id -u))"
echo "[deploy] mode: $MODE"

# Headless gate: this script targets the mini2 headless server, so we skip
# the electron-rebuild postinstall hook. The guard lives in package.json's
# `postinstall` script and triggers on MAESTRO_HEADLESS=1.
export MAESTRO_HEADLESS=1

# ─── --probe shortcut: skip deploy, just run the falsification probe ────
if [ "$MODE" = "probe-only" ]; then
  echo "[deploy] --probe: skipping pull/install/build/launchctl"
  echo "[deploy] running infra/probe-pty-survival.sh"
  exec bash "$REPO_ROOT/infra/probe-pty-survival.sh"
fi

# ─── Pin Node version ────────────────────────────────────────────────────
# fnm is the assumed Node manager on mini2. If a different manager is in
# use, replace this block. Pinning to 22.22.1 matches the version used to
# verify Layer 0a/0b on the laptop (see ISA.md Verification section).
if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env --shell bash)"
  fnm use 22.22.1 || {
    echo "[deploy] fnm could not switch to 22.22.1 — install it with: fnm install 22.22.1"
    exit 1
  }
elif ! command -v node >/dev/null 2>&1; then
  echo "[deploy] no node on PATH and no fnm available — install Node 22.x first"
  exit 1
fi

echo "[deploy] node: $(node --version) at $(command -v node)"

# ─── Pull latest from origin ─────────────────────────────────────────────
echo "[deploy] git pull origin main"
git pull origin main

CURRENT_SHA="$(git rev-parse --short HEAD)"
echo "[deploy] HEAD now at $CURRENT_SHA"

# ─── Install dependencies ────────────────────────────────────────────────
# Prefer `npm ci` (lock-file-deterministic). Fall back to `npm install`
# when the lock file is out of sync (e.g. first run after a rebase).
echo "[deploy] npm ci (fallback to npm install)"
if ! npm ci; then
  echo "[deploy] npm ci failed — falling back to npm install"
  npm install
fi

# ─── Build the server bundle ─────────────────────────────────────────────
# `build:server` compiles `src/server/` + the electron-free `src/main/`
# subsets currently included by `tsconfig.server.json` (process-manager,
# parsers, web-server). Output lands in `dist/server/`.
echo "[deploy] npm run build:server"
npm run build:server

if [ ! -f "dist/server/index.js" ]; then
  echo "[deploy] FAIL: dist/server/index.js not produced by build:server"
  exit 1
fi

# ─── Wire (or re-wire) the launchd LaunchAgent ───────────────────────────
PLIST_SRC="$REPO_ROOT/infra/com.maestro.server.plist"
PLIST_DST="$HOME/Library/LaunchAgents/com.maestro.server.plist"

mkdir -p "$HOME/Library/LaunchAgents"

if [ ! -e "$PLIST_DST" ]; then
  echo "[deploy] first-time setup: linking $PLIST_SRC → $PLIST_DST"
  ln -sf "$PLIST_SRC" "$PLIST_DST"
elif [ -L "$PLIST_DST" ] && [ "$(readlink "$PLIST_DST")" != "$PLIST_SRC" ]; then
  echo "[deploy] re-linking $PLIST_DST → $PLIST_SRC (was pointing elsewhere)"
  ln -sf "$PLIST_SRC" "$PLIST_DST"
fi

# Bootout (ignore failure — service may not be loaded yet) then bootstrap.
DOMAIN="gui/$(id -u)"
SERVICE_TARGET="$DOMAIN/com.maestro.server"

echo "[deploy] launchctl bootout $SERVICE_TARGET (best effort)"
launchctl bootout "$SERVICE_TARGET" 2>/dev/null || true

echo "[deploy] launchctl bootstrap $DOMAIN $PLIST_DST"
launchctl bootstrap "$DOMAIN" "$PLIST_DST"

# ─── Health probe ────────────────────────────────────────────────────────
# Wait briefly for launchd to spawn node, then probe localhost. We expect
# either:
#   - HTTP 200/302/404 (server up; depending on path)
#   - HTTP 401 (token-protected; server up)
# We tolerate curl exit code 22 (HTTP >= 400) because the root path
# without a token returns 404 by design.
PORT="${MAESTRO_WEB_PORT:-45678}"

echo "[deploy] waiting 3s for launchd to spawn server on :${PORT}"
sleep 3

PROBE_URL="http://localhost:${PORT}/"
echo "[deploy] probe: curl -sS -o /dev/null -w '%{http_code}' $PROBE_URL"

HTTP_CODE="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 5 "$PROBE_URL" || echo "000")"
echo "[deploy] http_code=$HTTP_CODE"

case "$HTTP_CODE" in
  2*|3*|4*)
    echo "[deploy] OK: server listening on :${PORT} (HTTP $HTTP_CODE)"
    echo "[deploy] HEAD=$CURRENT_SHA"
    echo "[deploy] next: verify Tailscale-reachable URL from another host on the tailnet"

    # ─── --auto-probe: run the PTY survival probe after a green deploy ────
    if [ "$MODE" = "deploy-and-probe" ]; then
      echo "[deploy] --auto-probe: running infra/probe-pty-survival.sh"
      if bash "$REPO_ROOT/infra/probe-pty-survival.sh"; then
        echo "[deploy] OK: PTY survival probe PASSED"
      else
        PROBE_EXIT=$?
        echo "[deploy] FAIL: PTY survival probe exited $PROBE_EXIT"
        exit "$PROBE_EXIT"
      fi
    fi

    exit 0
    ;;
  *)
    echo "[deploy] FAIL: server not responding on :${PORT} (got '$HTTP_CODE')"
    echo "[deploy] tailing $HOME/Library/Logs/maestro/server.err.log:"
    tail -40 "$HOME/Library/Logs/maestro/server.err.log" 2>/dev/null || echo "(no error log yet)"
    echo "[deploy] tailing $HOME/Library/Logs/maestro/server.out.log:"
    tail -40 "$HOME/Library/Logs/maestro/server.out.log" 2>/dev/null || echo "(no stdout log yet)"
    exit 1
    ;;
esac
