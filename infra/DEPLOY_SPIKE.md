# Maestro mini2 Deploy Spike — Runbook

> Pre-staged artifacts for the first end-to-end deploy of the headless Maestro
> server to `mini2`. The 2026-06-08 Architect audit flagged the mini2 deploy
> story as the most underspecified part of the project plan; this runbook
> closes that gap with concrete, executable steps.
>
> This document is the **document-and-prepare** half of the spike. The actual
> deploy is Trillium's task to execute when he's at `mini2`. Findings from
> the first run feed back into a follow-on Decisions entry in `ISA.md`.
>
> **Companion artifacts in this directory:**
>
> - `com.maestro.server.plist` — launchd LaunchAgent definition.
> - `deploy.sh` — git pull + build + bootout/bootstrap + health probe.

---

## Vision recap (why this exists)

One Maestro instance runs on `mini2` (the always-on Mac on Trillium's tailnet).
Trillium opens `http://mini2.<tailnet>.ts.net:45678/<token>/` from his laptop,
phone, or any borrowed machine that's joined to the tailnet, and gets the
same Maestro UI. No installs. No "which copy has my work in it." Tailscale
handles network reachability and identity. See `ISA.md` → Vision.

The headless server (`src/server/index.ts`, shipped via Layer 0a/0b) is the
runtime. This runbook is how it gets onto `mini2`.

---

## Prerequisites on mini2

Run all of these as Trillium's normal user (do not deploy this under `root`).

### Tailscale

- Tailscale daemon running and `mini2` joined to the tailnet.
- `tailscale status` shows `mini2.<tailnet>.ts.net` as a node.
- Tailscale MagicDNS enabled (so the hostname resolves from the laptop
  without a literal IP).
- Verify from the laptop: `tailscale ping mini2` should show < 50ms RTT.

### Node 22.x

- Either `fnm` or `nvm` installed with Node `22.22.1` pinned.
  - `fnm install 22.22.1 && fnm default 22.22.1`
  - or `nvm install 22.22.1 && nvm alias default 22.22.1`
- `node --version` from a fresh login shell prints `v22.22.1`.
- The deploy script assumes `fnm`; if Trillium uses `nvm`, edit `deploy.sh`'s
  pin block. The launchd plist hard-codes the absolute path to the node
  binary (see §Verify-and-edit plist below).

### Python 3.11 (host-side only)

- `python3 --version` returns `3.11.x` or `3.12.x`.
- Reason: `node-gyp` / `electron-rebuild` will reach for Python during
  `npm install` when native modules (`better-sqlite3`, `node-pty`) need to
  build. Even though the headless server does not run Electron, the
  `postinstall` hook in `package.json` still runs `electron-rebuild`. If
  this becomes painful, the future fix is to gate `postinstall` behind a
  `MAESTRO_HEADLESS=1` env var — captured below in Open Questions.

### Git, Xcode CLT

- `git --version` returns 2.x or newer.
- `xcode-select -p` returns a path (Command Line Tools installed) — required
  for compiling native modules.

### Filesystem layout

| Path                                | Purpose                                            |
|-------------------------------------|----------------------------------------------------|
| `~/code/maestro`                    | Repo clone (working tree).                         |
| `~/.config/maestro/`                | Headless data dir (per `src/shared/data-dir.ts`).  |
| `~/Library/Logs/maestro/`           | launchd stdout/stderr logs.                        |
| `~/Library/LaunchAgents/`           | Symlink to `infra/com.maestro.server.plist`.       |

Create the log directory before the first bootstrap:

```bash
mkdir -p ~/Library/Logs/maestro
```

(launchd silently drops log output if the parent directory does not exist.)

---

## One-time setup on mini2

```bash
# 1. Clone the fork. Use the SSH remote if Trillium has his GitHub SSH key
#    on mini2; otherwise HTTPS works fine for read access.
cd ~/code
git clone git@github.com:trillium/Maestro.git maestro
cd maestro

# 2. Pin Node and install deps.
fnm use 22.22.1
npm install   # first run is slower because better-sqlite3 + node-pty compile.

# 3. Build the server bundle.
npm run build:server

# 4. Smoke-test the server in the foreground (no launchd yet).
MAESTRO_WEB_PORT=45678 node dist/server/index.js
# Expect log lines:
#   [maestro-server] dataDir = /Users/trillium/.config/maestro
#   [maestro-server] listening at http://<ip>:45678/<token>
#   [maestro-server] data directory: /Users/trillium/.config/maestro
#   [maestro-server] sessions visible: 0
# Ctrl-C to stop.

# 5. Verify-and-edit infra/com.maestro.server.plist:
#    - ProgramArguments[0] should match `command -v node` AFTER fnm use 22.22.1.
#      Resolve any symlinks: `readlink -f "$(command -v node)"`.
#    - WorkingDirectory should match `pwd` from inside ~/code/maestro.
#    - MAESTRO_DATA_DIR: ~/.config/maestro for fresh install, or
#      ~/Library/Application Support/maestro (or maestro-dev) to migrate
#      from an existing Electron install. See Open Question §1.

# 6. Wire the launchd plist and bootstrap.
mkdir -p ~/Library/Logs/maestro
ln -sf "$(pwd)/infra/com.maestro.server.plist" \
       ~/Library/LaunchAgents/com.maestro.server.plist
launchctl bootstrap "gui/$(id -u)" \
       ~/Library/LaunchAgents/com.maestro.server.plist

# 7. Verify the service is running.
launchctl print "gui/$(id -u)/com.maestro.server" | head -40
# Look for `state = running` and `pid = <some-number>`.

# 8. Loopback probe from mini2.
curl -is http://localhost:45678/
# A 404 here is FINE — the root path without a token returns 404 by
# design. What matters: a response is produced (server is up). Expect a
# `Server: ...` header.

# 9. Tailscale-reachable probe from Trillium's laptop:
curl -is http://mini2.<tailnet>.ts.net:45678/
# Same disposition — non-empty response with HTTP headers proves the port
# is reachable over the tailnet.

# 10. Open the token-protected UI in a real browser:
#     http://mini2.<tailnet>.ts.net:45678/<token>/
#     where <token> is whatever the server logged at boot. Persistent token
#     lives in MAESTRO_DATA_DIR/maestro-settings.json under `webAuthToken`
#     once written; on a fresh data dir the boot uses an ephemeral UUID.
```

---

## The deploy sequence (every subsequent deploy)

After one-time setup, deploys are one command:

```bash
cd ~/code/maestro
./infra/deploy.sh
```

That script:

1. `eval "$(fnm env --shell bash)" && fnm use 22.22.1` — pin Node.
2. `git pull origin main` — fetch latest.
3. `npm ci || npm install` — sync dependencies.
4. `npm run build:server` — rebuild the dist bundle.
5. `launchctl bootout gui/$(id -u)/com.maestro.server` — unload the running
   service (best-effort; non-fatal if not loaded).
6. `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.maestro.server.plist` —
   reload from the plist.
7. `sleep 3 && curl -sS http://localhost:45678/` — health probe.
8. On non-2xx/3xx/4xx response: tail `~/Library/Logs/maestro/server.err.log`
   and exit 1.

The script is idempotent. Re-running after a no-op `git pull` still rebuilds
and reloads — that's deliberate; it surfaces "the build broke even though
nothing seemed to change" failures fast.

---

## Post-deploy verification

After every deploy, run all four checks.

### 1. Service state

```bash
launchctl print "gui/$(id -u)/com.maestro.server" | head -40
```

Expect `state = running` and a recent `pid`. If `state = exited` or the
service is missing, jump to Rollback.

### 2. Loopback HTTP (proves server is up)

```bash
curl -is http://localhost:45678/
```

Expect HTTP headers (any status 200/302/401/404 is acceptable — the literal
status depends on token presence and the route).

### 3. Tailscale HTTP (proves Tailscale-reachable)

From Trillium's **laptop**, not mini2:

```bash
curl -is http://mini2.<tailnet>.ts.net:45678/
```

Same disposition — any HTTP response proves the tailnet reaches the port.

### 4. Browser load (proves the UI mounts)

From the laptop, open the URL the server logged at boot:

```
http://mini2.<tailnet>.ts.net:45678/<token>/
```

The page should render the existing `src/web/` mobile/companion UI. This is
Tier-1 UX — list sessions, see state. Full webFull desktop UI is later
layers (see `WEB_PORT_ORDER.md`).

---

## Where the data dir lives

Default: `~/.config/maestro/` per `src/shared/data-dir.ts`. The directory
contains:

| File                          | Source                            |
|-------------------------------|-----------------------------------|
| `maestro-settings.json`       | electron-store-shape JSON; holds `webAuthToken`, `activeThemeId`, etc. |
| `maestro-sessions.json`       | persisted session list.           |
| `maestro-groups.json`         | session groups.                   |

**Backup before any risky deploy:**

```bash
tar czf ~/maestro-backup-$(date +%Y%m%d-%H%M%S).tar.gz -C ~ .config/maestro
```

**Restore from backup:**

```bash
tar xzf ~/maestro-backup-<timestamp>.tar.gz -C ~
launchctl kickstart -k "gui/$(id -u)/com.maestro.server"
```

---

## Log location

| Stream | Path                                        |
|--------|---------------------------------------------|
| stdout | `~/Library/Logs/maestro/server.out.log`     |
| stderr | `~/Library/Logs/maestro/server.err.log`     |

```bash
tail -f ~/Library/Logs/maestro/server.err.log
```

launchd does not rotate these. If they grow large, append a rotation cron
or use `newsyslog`. Captured as a follow-on chore — not blocking for v1.

---

## Rollback procedure

If a deploy leaves the server in a bad state, roll back to the previous
HEAD:

```bash
cd ~/code/maestro

# 1. Find the previous-known-good commit.
git log --oneline -10

# 2. Reset to it. PREFER a tag if Trillium has been tagging deploys
#    (e.g. `deploy-2026-06-08`); otherwise use the commit sha.
git checkout <previous-sha-or-tag>

# 3. Rebuild against the rolled-back tree.
npm install
npm run build:server

# 4. Reload the service.
launchctl bootout "gui/$(id -u)/com.maestro.server" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" ~/Library/LaunchAgents/com.maestro.server.plist

# 5. Re-run post-deploy verification.
```

Recommendation surfaced as Open Question §4: tag every successful deploy
with `git tag deploy-$(date +%Y%m%d-%H%M%S)` at the end of `deploy.sh`, so
rollback targets are explicit. Not in the v0 script — first real spike
should validate the tag-on-success strategy.

---

## Open questions / unknowns to be answered during the first real spike

These are the things the runbook author (this agent) cannot answer without
being on `mini2`. The first spike run should produce evidence for each;
findings flow back into a follow-on `ISA.md` Decisions entry per the brief.

### Q1. Data-dir migration from an existing Electron `maestro-dev/` install

If Trillium already has Maestro Electron running on mini2 (likely — it's
how he discovered he wanted this), there's an existing data dir at
`~/Library/Application Support/maestro` (prod) or
`~/Library/Application Support/maestro-dev` (dev). The headless server
defaults to `~/.config/maestro`, which is **empty on first boot** — no
sessions, no history, no auth token.

Two paths:

- **(a) Point `MAESTRO_DATA_DIR` at the Electron data dir.** Set
  `MAESTRO_DATA_DIR=/Users/trillium/Library/Application Support/maestro`
  in `com.maestro.server.plist`. Trade-off: the Electron app and the
  headless server now read/write the SAME data dir. If both are running
  simultaneously, last-writer-wins on `maestro-sessions.json` could
  corrupt state. Mitigation: do NOT run Electron and the headless server
  concurrently against the same data dir.
- **(b) Copy then point.** `cp -R "~/Library/Application Support/maestro" ~/.config/maestro`
  once, then leave the plist default. Trade-off: state diverges from
  Electron immediately. Existing Electron install is effectively
  read-only-source from that point.

**Untested today.** The Architect audit specifically flagged this. First
spike should manually try path (b) and document whether the headless server
can read an Electron-written `maestro-settings.json` without corruption.

### Q2. `customSyncPath` (Architect audit finding 3)

The Electron app exposes a `customSyncPath` setting that lets Trillium move
his data dir to a non-default location (e.g. an iCloud-synced folder).
`src/shared/data-dir.ts` does **not** consult this setting — it goes
directly to either `app.getPath('userData')` (Electron) or
`MAESTRO_DATA_DIR ?? ~/.config/maestro` (headless).

If Trillium has set `customSyncPath` in his Electron install, the headless
server will silently read from the wrong directory and look like a fresh
install. First spike should check whether `customSyncPath` is set in the
existing Electron `maestro-settings.json`. If so, the plist's
`MAESTRO_DATA_DIR` must be set to that custom path, not the default.

**Action for first spike:**

```bash
# On mini2:
jq '.customSyncPath' "/Users/trillium/Library/Application Support/maestro/maestro-settings.json"
# If non-null, set MAESTRO_DATA_DIR in the plist to match.
```

### Q3. Node binary absolute path under fnm on mini2

The launchd plist hard-codes
`/Users/trillium/.local/share/fnm/node-versions/v22.22.1/installation/bin/node`.
fnm's installation prefix is configurable and varies by macOS version
(`~/.local/share/fnm/` is the modern default; older installs use
`~/Library/Application Support/fnm/`). First spike must verify:

```bash
fnm use 22.22.1
readlink -f "$(command -v node)"
```

If the resolved path differs from the plist default, edit
`infra/com.maestro.server.plist`'s `ProgramArguments[0]` **and** the `PATH`
entry in `EnvironmentVariables` (the prefix directory).

Captured as TODO in the plist's XML comment block.

### Q4. Deploy-tag convention for rollback

The runbook recommends `git tag deploy-$(date +%Y%m%d-%H%M%S)` on every
successful deploy, but `deploy.sh` does not currently do this. First spike
should decide:

- Tag automatically in `deploy.sh` and push the tag (or keep tags local).
- Or keep deploys un-tagged and rely on `git reflog`.

If tagging is the answer, a one-line addition to `deploy.sh` after the
health probe success block:

```bash
git tag "deploy-$(date +%Y%m%d-%H%M%S)" "$CURRENT_SHA"
```

### Q5. `postinstall` electron-rebuild on a headless host

`package.json`'s `postinstall` runs `electron-rebuild -f -w node-pty,better-sqlite3`.
This requires Electron's binary to be present (it pulls Electron's headers
to rebuild native modules against Electron's Node ABI). On a headless host
that never runs Electron, this is wasted work — and could fail if Electron
isn't installed.

First spike should report:

- Did `npm install` on mini2 succeed without manual intervention?
- If `electron-rebuild` failed, what was the workaround? (Likely:
  `npm install --ignore-scripts && npm rebuild better-sqlite3 node-pty`.)

Long-term fix candidate: gate `postinstall` behind `if [ -z "$MAESTRO_HEADLESS" ]`
or split into two scripts. Not v0 scope.

### Q6. Tailscale port-exposure model

The plist binds `MAESTRO_WEB_PORT=45678` and the server itself listens on
`0.0.0.0:45678` per Fastify defaults (verify this in
`src/main/web-server/WebServer.ts` — Architect's ISC-9/ISC-17 explicitly
calls out the anti-criterion "no `0.0.0.0` binding on a public IP without
Tailscale filtering"). If the server binds `0.0.0.0`, this is fine on mini2
ONLY because mini2 has no public IPv4 — but the first spike should confirm:

```bash
# On mini2:
lsof -nP -iTCP:45678 -sTCP:LISTEN
# Expect: node ... TCP *:45678 (LISTEN) or TCP <tailscale-ip>:45678 (LISTEN)
```

If the server binds `*:45678` and mini2 ever gets a routable public IPv4,
the listener would be exposed. Mitigations to evaluate: `tailscale serve`
proxy mode, or a Fastify bind argument set to the Tailscale interface IP.
Defer to second deploy iteration.

---

## Out of scope for this spike

- TLS termination. Tailscale is the perimeter; HTTP-over-tailnet is the
  Vision per `ISA.md` Constraints.
- OAuth or any in-app login. Tailscale identity = Trillium.
- Multi-tenant SaaS. Single-user forever.
- Cloudflare tunnel / public exposure. Sub-project if ever needed.
- Auto-update via `electron-updater`. Replaced by `./infra/deploy.sh`.
- Public-internet `0.0.0.0` binding without Tailscale filter — verified
  absent per Q6.

---

## After the first deploy

Trillium runs the first real deploy. He writes a follow-on Decisions entry
in `ISA.md` capturing:

- Which of Q1-Q6 turned out to matter.
- Any plist edits made on mini2 (so the repo plist can be updated to match).
- Whether Tier-1 UX (mobile-companion view) loads cleanly from his phone
  over Tailscale.
- Whether the server survives a mini2 reboot (`sudo shutdown -r now`
  followed by SSH back in and re-verify §Post-deploy verification).

That feedback closes the loop on this spike.
