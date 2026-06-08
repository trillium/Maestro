# Maestro mini2 — First-Deploy Brief

> Trillium-facing. This is the **first time** you run `./infra/deploy.sh` on
> mini2. The exhaustive runbook is `infra/DEPLOY_SPIKE.md`. This brief is
> the focused, first-time-only checklist that gets the headless server up
> on mini2 with the highest-probability gotchas guarded.
>
> The companion runbook (`DEPLOY_SPIKE.md`) covers every subsequent deploy,
> rollback, data-dir migration paths, and open questions. Use this brief on
> the first run; switch to the runbook for repeat work.
>
> **Goal:** at the end of this brief, you can open
> `http://mini2.<tailnet>.ts.net:45678/<token>/` from your phone over
> Tailscale, see your sessions, send a command, watch the PTY stream, and
> confirm that a `kill -9` of the server does NOT lose your scrollback.

---

## 0. Prereqs check (≈1 minute on mini2)

Run these from a fresh login shell on mini2. Each must succeed before you
move on.

```bash
# Tailscale up and joined to the tailnet
tailscale status | head -3
tailscale ip -4        # records mini2's tailnet IPv4

# Node 22 via fnm (the launchd plist hardcodes the fnm node path)
fnm use 22.22.1
node --version         # → v22.22.1
command -v node        # records the absolute path

# Python 3.11+ for any residual node-gyp work
python3 --version      # → 3.11.x or 3.12.x

# Git + Xcode CLT
git --version
xcode-select -p        # any path = CLT installed

# Repo cloned
ls ~/code/maestro/package.json && echo "repo present"
```

If `command -v node` resolves to something OTHER than
`/Users/trillium/.local/share/fnm/node-versions/v22.22.1/installation/bin/node`,
**stop and edit `infra/com.maestro.server.plist`** before proceeding — see
§6 below.

---

## 1. First run (one-shot)

```bash
cd ~/code/maestro
git pull origin main

# This export gates package.json's postinstall hook so npm DOES NOT run
# `electron-rebuild`. The hook would rebuild node-pty + better-sqlite3
# against Electron's Node ABI, but the headless server uses system Node's
# ABI — without this guard, `node dist/server/index.js` will crash on
# first boot with "NODE_MODULE_VERSION mismatch" or similar.
#
# `infra/deploy.sh` exports this automatically for every subsequent run;
# you only have to remember it for this first manual `npm ci`.
export MAESTRO_HEADLESS=1

npm ci                  # expect the postinstall line: "[postinstall] MAESTRO_HEADLESS=1; skipping electron-rebuild"
npm run build:server    # produces dist/server/index.js
npm run build:webfull   # produces dist/webfull/ (full UI assets the server serves at /<token>/)
```

### Why `build:webfull` and not just `build:server`?

`src/main/web-server/WebServer.ts:167` looks for static assets in
`dist/web/` (or `dist/webfull/` via the same resolver — it walks several
candidates). Without web assets on disk the server boots but logs:

> Web assets not found. Web interface will not be served.

That isn't a server crash — but the phone Safari tab will show an empty or
default response instead of the Maestro UI. Build the web bundle now so
the first browser load lands on the real UI.

If you only intend to verify the API/WS surface and not load the UI in
this first session, `build:webfull` can be skipped. Default: build it.

---

## 2. Smoke local (from mini2)

Foreground-run the server once before launchd takes over, so a boot crash
is loud:

```bash
cd ~/code/maestro
MAESTRO_WEB_PORT=45678 node dist/server/index.js
```

Expected log lines:

```
[maestro-server] dataDir = /Users/trillium/.config/maestro
[maestro-server] listening at http://<ip>:45678/<token>
[maestro-server] data directory: /Users/trillium/.config/maestro
[maestro-server] sessions visible: 0
```

In another mini2 terminal:

```bash
curl -is http://localhost:45678/
# Expect HTTP headers — any 200/302/401/404 is fine. The literal status
# depends on whether the path is token-protected; what matters is "a real
# response, not connection refused".
```

`Ctrl-C` to stop the foreground server before moving to §3.

---

## 3. Smoke over Tailscale (from your laptop)

From the laptop, NOT mini2:

```bash
curl -is http://mini2.<tailnet>.ts.net:45678/
# Same disposition — any HTTP status proves the tailnet reaches the port.
```

If you get connection refused or DNS failure:

- `tailscale ping mini2` from the laptop — must succeed.
- `tailscale status | grep mini2` — confirm node is online.
- MagicDNS must be enabled on the tailnet; otherwise substitute mini2's
  tailnet IPv4 from §0 in place of the hostname.

The server has to be running for this to succeed — if you killed the
foreground server in §2, restart it briefly: `MAESTRO_WEB_PORT=45678 node
dist/server/index.js`, run the curl, then `Ctrl-C` again.

---

## 4. Falsification probe: PTY scrollback survives a kill

This is the **single most important** verification — it answers ISC-45,
the question whose negative answer would invalidate the entire
decouple-from-Electron investment.

```bash
cd ~/code/maestro
bash infra/probe-pty-survival.sh
```

Expected final line:

```
[probe] PASS — scrollback survived kill -9 + restart
```

If you see `FAIL`, **stop and investigate** before wiring launchd — the
probe preserves its dataDir under `/tmp/maestro-isc45-probe-*` for
forensics. Treat this as a `STOP` in your terminology; do not proceed to
§5 until the probe is green.

---

## 5. launchd registration (the service goes live)

```bash
cd ~/code/maestro

# Verify the node path the plist hardcodes matches your actual node.
# This is the #1 reason launchd can't start the service.
PLIST_NODE="$(grep -A1 ProgramArguments infra/com.maestro.server.plist | grep -o '/Users/.*node')"
ACTUAL_NODE="$(readlink -f "$(command -v node)")"
echo "plist:  $PLIST_NODE"
echo "actual: $ACTUAL_NODE"
# If these differ, edit infra/com.maestro.server.plist ProgramArguments[0]
# AND the PATH entry's prefix before continuing. See §6.

# Create the log directory — launchd silently drops logs if missing.
mkdir -p ~/Library/Logs/maestro

# Symlink the plist and bootstrap.
ln -sf "$(pwd)/infra/com.maestro.server.plist" \
       ~/Library/LaunchAgents/com.maestro.server.plist
launchctl bootstrap "gui/$(id -u)" \
       ~/Library/LaunchAgents/com.maestro.server.plist

# Verify.
launchctl list | grep maestro
launchctl print "gui/$(id -u)/com.maestro.server" | head -40
# Expect: `state = running` and a `pid = <integer>`.
```

If `state = exited` or `state = not running`:

```bash
tail -40 ~/Library/Logs/maestro/server.err.log
tail -40 ~/Library/Logs/maestro/server.out.log
```

`launchctl bootstrap` returning exit code 5 is the most common silent
failure mode — it usually means the plist node path is wrong or the
working directory does not exist. Re-read §6 below.

---

## 6. Likely plist edits before first bootstrap

The plist is checked in with hard-coded paths that assume Trillium's
specific install layout. Verify and edit **before** §5's `bootstrap`.

| Field                                       | Plist default                                                                   | How to verify                                              | If different                               |
| ------------------------------------------- | ------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------------------------ |
| `ProgramArguments[0]`                       | `/Users/trillium/.local/share/fnm/node-versions/v22.22.1/installation/bin/node` | `readlink -f "$(command -v node)"` under `fnm use 22.22.1` | Replace with the resolved path.            |
| `ProgramArguments[1]`                       | `/Users/trillium/code/maestro/dist/server/index.js`                             | `echo "$(pwd)/dist/server/index.js"` from repo root        | Replace if cloned elsewhere.               |
| `WorkingDirectory`                          | `/Users/trillium/code/maestro`                                                  | `pwd` from repo root                                       | Replace if cloned elsewhere.               |
| `EnvironmentVariables → PATH` (first entry) | `/Users/trillium/.local/share/fnm/node-versions/v22.22.1/installation/bin`      | Same prefix as `ProgramArguments[0]`                       | Replace prefix if fnm install differs.     |
| `MAESTRO_DATA_DIR`                          | `/Users/trillium/.config/maestro`                                               | See data-dir migration question below                      | Override if migrating from Electron.       |
| `MAESTRO_WEB_PORT`                          | `45678`                                                                         | none                                                       | Only change if the port is taken on mini2. |

### Data-dir question (read this BEFORE first bootstrap)

If you already have a Maestro Electron install on mini2 with sessions you
care about, the headless server's default `~/.config/maestro` is **empty**
and you'll see "no sessions" on the first browser load. Two options:

- **(a) Point at the Electron data dir.** Edit the plist's
  `MAESTRO_DATA_DIR` to
  `/Users/trillium/Library/Application Support/maestro` (or
  `/Users/.../maestro-dev`). Only safe if Electron Maestro is NOT running
  concurrently — same data dir + two writers = race.
- **(b) Copy then point.** Once, before bootstrap:
  ```bash
  cp -R ~/Library/Application\ Support/maestro ~/.config/maestro
  ```
  Then leave the plist default. Electron's copy diverges from that point.

If you don't care about migrating existing state, do nothing — the
default `~/.config/maestro` is correct for a fresh install.

Also check `customSyncPath` if you've ever set it in Electron:

```bash
jq '.customSyncPath' ~/Library/Application\ Support/maestro/maestro-settings.json 2>/dev/null
```

If the result is a non-null path, set `MAESTRO_DATA_DIR` in the plist to
that path — `src/shared/data-dir.ts` does NOT consult `customSyncPath`,
so the server will read the wrong directory and look like a fresh
install otherwise.

---

## 7. The ISC-45 mini2 manual probe (full phone happy path)

This is the deploy-ground-truth check. The local probe in §4 validates
the on-disk format; this probe validates the **full integration path**
that you, the user, actually experience.

| #   | Step                                                                                                                           | Where        | Expected                                                                                            | If actual differs                                                                                                                     |
| --- | ------------------------------------------------------------------------------------------------------------------------------ | ------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Save bookmark `http://mini2.<tailnet>.ts.net:45678/<token>/`                                                                   | Phone Safari | URL loads; existing sessions list renders (or empty-state message if `~/.config/maestro` is fresh). | If page is blank / "Web assets not found" in `server.err.log` → `npm run build:webfull` on mini2, restart service.                    |
| 2   | Tap an existing session (or create one from the laptop first)                                                                  | Phone Safari | xterm renders, prompt visible.                                                                      | If xterm hangs / no WS frames → check `/<token>/socket.io` reachability; tail `server.err.log`.                                       |
| 3   | Type `echo "PROBE_MARKER_$(date +%s)" && uname -a`                                                                             | Phone Safari | Output renders in xterm. **Screenshot this**.                                                       | If keystrokes don't echo → WS `terminal_input` route broken; check L0b.                                                               |
| 4   | From laptop SSH: `ssh mini2 'pgrep -f dist/server/index.js \| head -1'`                                                        | mini2        | Returns a PID.                                                                                      | If empty → server is not running; `launchctl list \| grep maestro`.                                                                   |
| 5   | From laptop SSH: `ssh mini2 'kill -9 <PID>'`                                                                                   | mini2        | No output; signal sent.                                                                             | If "permission denied" → use `sudo kill -9`.                                                                                          |
| 6   | Wait 3 s; verify launchd respawned: `ssh mini2 'pgrep -f dist/server/index.js \| head -1'`                                     | mini2        | Returns a **different** PID.                                                                        | If empty → launchd `KeepAlive` may not be on; check `launchctl print ...` for ThrottleInterval / state.                               |
| 7   | Phone Safari: pull-to-refresh the tab                                                                                          | Phone        | xterm re-renders.                                                                                   | —                                                                                                                                     |
| 8   | **Critical assertion**: the `PROBE_MARKER_…` line and `uname -a` output from step 3 are **still visible above the new prompt** | Phone        | Screenshot matches step 3 modulo the new prompt at the bottom.                                      | If scrollback is blank / shows only a fresh prompt → **ISC-45 falsified**, decouple delivers no user-felt value, **STOP and report**. |

**Pass criterion:** step 8's screenshot shows the pre-kill output intact.

**Falsification criterion:** step 8 shows a fresh terminal with no
scrollback. Even if every other step is green, this single failure
invalidates the value claim for the decouple-from-Electron work.

---

## 8. Likely failures and fixes

| Symptom                                                                              | Likely cause                                                                                                            | Fix                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `npm ci` aborts with `electron-rebuild` errors                                       | `MAESTRO_HEADLESS=1` was NOT exported before `npm ci`                                                                   | `export MAESTRO_HEADLESS=1 && rm -rf node_modules && npm ci`                                                                                                                                                             |
| `npm ci` warns `"electron-rebuild not found"` even with the guard                    | npm parsed the postinstall line but it didn't run the guard?                                                            | Re-confirm the postinstall line in `package.json` starts with `if [ "${MAESTRO_HEADLESS:-0}" = "1" ]; then`.                                                                                                             |
| Server boots locally but `launchctl bootstrap` exits 5                               | Plist node path is wrong                                                                                                | §6 — replace `ProgramArguments[0]` with `readlink -f "$(command -v node)"`.                                                                                                                                              |
| Server boots foreground but launchd `state = exited` immediately                     | Working directory in plist doesn't exist OR `MAESTRO_DATA_DIR` parent doesn't exist                                     | `mkdir -p ~/.config/maestro` and verify `WorkingDirectory` in the plist.                                                                                                                                                 |
| Boot log says `Web assets not found. Web interface will not be served.`              | `dist/webfull/` (or `dist/web/`) is missing                                                                             | `npm run build:webfull` then restart the service (`launchctl kickstart -k gui/$(id -u)/com.maestro.server`).                                                                                                             |
| Boot crash: `Cannot find module '@sentry/electron'`                                  | Unexpected — `src/server/sentry.ts` uses lazy `require('@sentry/node')` inside a try/catch, so absence should be silent | Check `src/server/sentry.ts` is the file being imported (not a stale dist). Rebuild: `rm -rf dist && npm run build:server`. If reproducible, the lazy guard is broken and needs a follow-up patch.                       |
| `tailscale ping mini2` works but `curl http://mini2.<tailnet>.ts.net:45678/` refuses | Server not actually listening on the tailnet interface                                                                  | `lsof -nP -iTCP:45678 -sTCP:LISTEN` on mini2 — expect `*:45678` (Fastify default `0.0.0.0`). If the line is missing, the server isn't running on that port.                                                              |
| iPhone Safari can't load the URL but laptop curl works                               | MagicDNS not resolved on phone, or tailnet ACL filtering iOS device                                                     | Try the tailnet IPv4 from `tailscale ip -4` instead of the MagicDNS hostname. Verify the iPhone is on the tailnet via the Tailscale iOS app's status screen.                                                             |
| iPhone connects but UI is blank / "missing assets"                                   | `dist/webfull/` not built                                                                                               | `npm run build:webfull` on mini2; service auto-serves on next request.                                                                                                                                                   |
| 401 on first browser load                                                            | Token mismatch                                                                                                          | The token is logged at boot (`[maestro-server] listening at http://<ip>:45678/<token>`) and persisted in `<dataDir>/maestro-settings.json` under `webAuthToken`. Use the logged token; copy from logs once and bookmark. |

---

## 9. After successful first deploy — report back

The audit explicitly noted that the first deploy is the source of truth
for which paths and assumptions in this brief and `DEPLOY_SPIKE.md`
actually hold. After you finish steps 1–7, write a short Decisions entry
in `ISA.md` that names:

- Which step in §0–§7 actually surprised you (took longer / didn't work as
  written / needed an undocumented workaround).
- Whether you used data-dir option (a), (b), or default in §6.
- Whether the plist needed any of the §6 edits and what the actual values
  were on mini2.
- Whether step 8 of §7 passed — `PASS` / `FAIL` + screenshot reference.
- Whether the server survived a full mini2 reboot
  (`sudo shutdown -r now` from laptop SSH, wait, re-verify §3 + §7).

That feedback closes the loop and drives the next plan-reeval. If
something didn't work, the goal is to capture **what** so the brief can
be edited; if everything worked, the goal is to mark the corresponding
open questions in `DEPLOY_SPIKE.md` Q1–Q6 as closed.

---

## Quick-reference command list (mini2, first deploy)

```bash
cd ~/code/maestro
git pull origin main
export MAESTRO_HEADLESS=1
npm ci
npm run build:server
npm run build:webfull
mkdir -p ~/Library/Logs/maestro ~/.config/maestro

# Foreground smoke
MAESTRO_WEB_PORT=45678 node dist/server/index.js   # Ctrl-C after curl OK

# Local probe (must PASS before launchd)
bash infra/probe-pty-survival.sh

# Plist install
ln -sf "$(pwd)/infra/com.maestro.server.plist" \
       ~/Library/LaunchAgents/com.maestro.server.plist
launchctl bootstrap "gui/$(id -u)" \
       ~/Library/LaunchAgents/com.maestro.server.plist
launchctl print "gui/$(id -u)/com.maestro.server" | head -40

# From laptop
curl -is http://mini2.<tailnet>.ts.net:45678/
# Then open the /<token>/ URL on phone Safari and run §7's manual probe.
```

Every deploy after this one is just `./infra/deploy.sh` (or
`./infra/deploy.sh --auto-probe` to re-run the falsification probe after
the deploy lands).
