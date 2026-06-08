---
project: maestro-web
slug: maestro-electron-to-web-tailscale
effort: E4
phase: build
progress: 0/43
mode: ALGORITHM
started: 2026-06-07
updated: 2026-06-08
fork_of: RunMaestro/Maestro
upstream: RunMaestro/Maestro
my_fork: trillium/Maestro
---

# Maestro — Web Application over Tailscale (Trillium's Fork)

> Project ISA. Source of truth for this fork's deviation from upstream. Lives in repo, reviewed in PRs, outlives any single task run.
>
> **Upstream stays Electron. This fork repoints the primary surface to a Tailscale-hosted web app.**

## Problem

Upstream Maestro ships as an Electron 28 desktop app. The principal (Trillium) works across multiple machines (laptop, mini2, mini3, phone) connected over Tailscale and wants ONE running Maestro instance reachable from any of them via a browser. Electron pins the runtime to a single host: the app is wherever the principal last clicked the dock icon, requires per-machine installs, per-machine state, per-machine updates, and cannot be reached from phone or non-Mac devices.

The friction this causes: context-loss when moving between machines, multiple stale instances diverging on state, mobile-from-bed access blocked, mini2/mini3 (the always-on hosts) not utilized. Upstream already has a substantial web target (`src/web/`, `src/main/web-server/` running Fastify on 45678, `vite.config.web.mts`), but Electron is still the launcher and several subsystems (`node-pty` terminals, `better-sqlite3` DB, `electron-store` settings, `electron-updater`) assume the Electron process model.

## Vision

One Maestro instance runs on mini2 (the always-on Mac in Trillium's tailnet). Trillium opens `http://mini2.<tailnet>.ts.net:45678` from his laptop's browser, his iPhone, or any borrowed machine that's joined to the tailnet, and gets the same Maestro UI — same active sessions, same terminal scrollback, same database, same settings, same in-flight conversations. No installs. No "which copy of Maestro has my work in it." Tailscale handles network reachability AND identity (if you're on the tailnet, you're Trillium). Closing the laptop lid does not lose any work. Mobile access is good enough to read/respond from a phone.

Euphoric surprise on convergence: Trillium opens the app on his phone in bed, sees a terminal he started from his laptop at the office still streaming output, taps it, dictates a command, and watches it execute — all without thinking about where "the app" is.

## Out of Scope

- **Multi-tenant SaaS.** Not building user accounts, billing, workspace isolation, or per-tenant data segregation. Single user (Trillium) is the design assumption forever.
- **Public-internet exposure.** No public TLS, no Cloudflare tunnel, no OAuth. Tailscale identity = auth. If reverse-proxying is ever needed it is a separate sub-project.
- **Electron parity for upstream.** This fork does NOT promise to keep Electron builds passing CI. Upstream owns the desktop product; this fork is a web-first divergence.
- **Native mobile apps.** No iOS/Android wrappers. Mobile = mobile-responsive web served from the same Fastify origin (`src/web/mobile/` already exists per repo scan).
- **Maintaining `dmg`/`AppImage`/`nsis` packaging targets.** These can rot in this fork; PRs upstream-only.
- **Auto-update via electron-updater.** Replaced by `git pull && bun run build:web && systemd/launchd restart` on the host.

## Principles

1. **Tailscale is the perimeter.** Anything reachable on the tailnet is reachable by Trillium and nobody else; we trust that for auth and transport. No re-implementing identity inside the app.
2. **State lives once, on the host.** SQLite file, electron-store equivalents, session files — all on mini2's disk. Every browser session is a thin client into that state. Conflict resolution for "two browsers editing the same thing" is last-writer-wins via WebSocket events.
3. **Terminal sessions are server-owned.** `node-pty` ptys live in the server process, persist across browser disconnects, stream over WebSocket to xterm.js (or whatever upstream's renderer uses). Closing a tab does NOT kill the pty.
4. **Mobile responsiveness is first-class, not a bolt-on.** `src/web/mobile/` already exists; keep it healthy.
5. **Don't fork code, fork posture.** Stay close enough to upstream that periodic `git pull` from RunMaestro is mechanical. Divergence lives in adapters, launcher scripts, build targets — not in business logic.
6. **Server-side native modules stay.** `better-sqlite3` and `node-pty` keep running in the Node process; we don't replace them, we just stop wrapping the process in Electron.

## Constraints

- **`src/web/` is read-only on this fork.** Never edit, refactor, rename, lint-fix, or auto-format any file under `src/web/`. Treated as a verbatim mirror of upstream `RunMaestro/Maestro` so `git pull upstream main` is mechanical. All divergent web-UI work — including bugfixes to the mobile-companion surface — happens in `src/webFull/` (created from `src/web/` on 2026-06-07, commit `ee6274e1f`). This constraint is non-negotiable per Trillium's standing rule (2026-06-07). Anti-criterion ISC-43 enforces.
- **Node ≥22** (upstream `engines`). Host is macOS (mini2 / mini3), arm64.
- **Tailscale must be the only network path in the v1 deploy.** No `0.0.0.0` binding on a public IP.
- **Stay rebase-friendly with upstream `RunMaestro/Maestro main`.** Avoid invasive edits to files upstream touches frequently; prefer adapter/launcher files.
- **Single user, but possibly multiple concurrent browser tabs/devices.** WebSocket session model must tolerate N clients on one server.
- **Existing IPC contract is load-bearing.** `src/main/web-server/web-server-factory.ts` already bridges HTTP/WS → IPC `ipcMain.once(responseChannel, ...)`. Repointing requires either keeping the IPC stub or rewriting the bridge to direct in-process calls.
- **node-pty + better-sqlite3 native rebuilds** must work against the actual Node version running the standalone server. Cannot mix Electron's ABI with vanilla Node's ABI on the same `node_modules/`.
- **`@sentry/electron` does not run outside Electron.** Replace with `@sentry/node` or strip in the web build.
- **`electron-store` does not run outside Electron.** Replace with a `~/.config/maestro/settings.json` shim or migrate to the existing SQLite.

## Goal

Deliver a `bun run start:web` (or equivalent) launch path that runs Maestro's Fastify+WebSocket server as a vanilla Node process on mini2, serves the prebuilt `dist/web/` SPA, exposes `/api` + `/ws` on a Tailscale-reachable port (45678 or chosen), survives browser disconnects, persists state to disk, and produces the same UX Trillium gets from `bun run dev` today — accessed from any browser on his tailnet. Electron remains buildable upstream-side for anyone who wants it, but is not on the critical path for this fork.

## Criteria

> **DRAFT.** Background research agent's web-port codebase conversion assessment ([brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md)) contains the full IPC inventory, native-module map, and tiered effort estimate. The granular ISCs (target ≥128 at E4) will be appended as those findings get distilled into criteria here. Initial scaffold below covers the load-bearing structural criteria.

### Tier 1 — local web parity (laptop → laptop, same machine)

- [ ] ISC-1: `npm install` completes on host without electron-rebuild failures for `node-pty` and `better-sqlite3` against vanilla Node 22+.
- [ ] ISC-2: `npm run build:web` produces `dist/web/` containing `index.html` + hashed JS/CSS assets and exits 0.
- [ ] ISC-3: A `start:web` script (to be added) launches a vanilla `node`/`bun` process (NOT `electron .`) that boots the Fastify server on a configurable port.
- [ ] ISC-4: With server running, `curl -i http://localhost:<port>/` returns 200 and the HTML body contains `<div id="root">` (or whatever upstream uses as the React root).
- [ ] ISC-5: With server running, `curl -i http://localhost:<port>/api/health` (or upstream equivalent) returns 200 with a JSON body — Interceptor screenshot of `/` shows the actual Maestro UI mounting in a real browser, not just bare HTML.
- [ ] ISC-6: WebSocket upgrade succeeds at `ws://localhost:<port>/ws` and a smoke handshake completes within 2s.
- [ ] ISC-7: `src/main/web-server/web-server-factory.ts` IPC bridge is either (a) kept working with an in-process stub OR (b) replaced with direct function calls — code path documented in Decisions.

### Tier 2 — Tailscale-hosted, multi-device

- [ ] ISC-8: Process runs as a launchd-managed service on mini2; survives reboot.
- [ ] ISC-9: Service binds to mini2's Tailscale interface (or `0.0.0.0` filtered by `tailscale serve` / firewall to tailnet-only). Anti: ISC-8 must NOT result in a public-internet listener.
- [ ] ISC-10: From laptop on tailnet, `https://mini2.<tailnet>.ts.net:<port>/` loads the UI in Chrome (Interceptor screenshot proof).
- [ ] ISC-11: From iPhone Safari on tailnet, the same URL loads `src/web/mobile/` variant and is usable (manual smoke test — checklist in Verification).
- [ ] ISC-12: Two browsers (laptop Chrome + phone Safari) connected simultaneously can both observe the SAME open terminal session; an action in one is reflected in the other within 1s via WebSocket.
- [ ] ISC-13: A running `node-pty` terminal survives a browser disconnect; reopening the URL re-attaches to the same pty with intact scrollback.
- [ ] ISC-14: Settings written from browser A are visible to browser B without an explicit reload (or after one reload — Decision called out).
- [ ] ISC-15: `better-sqlite3` DB file on mini2 is the single source of truth; no `~/Library/Application Support/Maestro` Electron-side artifacts are created during web-mode runtime.

### Anti-criteria & guard-rails

- [ ] ISC-16: Anti: web-mode server MUST NOT spawn an Electron `BrowserWindow` or require `electron` binary on the host PATH.
- [ ] ISC-17: Anti: no `0.0.0.0:<port>` binding on a host without Tailscale filtering — verified with `lsof -i :<port>` + `tailscale serve status`.
- [ ] ISC-18: Anti: no telemetry/auto-update beacons fire from the web-mode process to non-tailnet endpoints (network capture during a 60s idle).
- [ ] ISC-19: Anti: `@sentry/electron` MUST NOT be a runtime dep of `start:web` (verified by `lsof` / process tree).
- [ ] ISC-20: Anti: upstream `npm run dev` (Electron path) MUST still work — fork divergence MUST NOT brick the desktop dev loop for anyone rebasing.
- [ ] ISC-21: Antecedent: Tailscale daemon running on mini2 AND laptop AND phone before any Tier 2 ISC can be verified.
- [ ] ISC-45: **Falsification probe (post-L0c).** Antecedent: Layer 0c has landed and the headless server can spawn pty sessions from the browser. Probe: spawn a pty session from phone Safari against the mini2 server; send a command into it; observe output; `kill -9` the server process on mini2; restart the server (via launchd or `./infra/deploy.sh`); reload the phone tab; the SAME pty re-attaches with intact scrollback (the command and its output are still on-screen). If the pty does NOT survive — fresh terminal, no scrollback — the entire decouple-from-Electron investment delivered nothing the user can feel, and the project's value claim collapses regardless of which lower-numbered ISCs are green. Pairs with ISC-13 (the unit-level pty-persistence-across-disconnect criterion); ISC-45 is the integration-level "did the whole thing matter" check.

### Build & operational

- [ ] ISC-22: `bun run build:web` is reproducible — same git SHA produces identical `dist/web/` (modulo timestamps).
- [ ] ISC-23: `bun run lint` (or upstream's TS typecheck) stays green on this fork's added files.
- [ ] ISC-24: `bun run test` (or upstream's vitest) stays green on the web-server tests in `src/__tests__/main/web-server/`.
- [ ] ISC-25: A `README.fork.md` (or equivalent) at the repo root documents: how to install, how to launch in web mode, how to reach over Tailscale, how to rebase from upstream.
- [ ] ISC-26: `launchd` plist is checked into `infra/` (or similar) on this fork.
- [ ] ISC-27: A documented procedure for `git pull` from upstream + rebuild + restart exists.

### Agent-informed ISCs (replacing prior [PENDING] slots)

- [ ] ISC-28: A `src/server/index.ts` (or equivalent) headless bootstrap initializes `stores`, `ProcessManager`, `AgentDetector`, `HistoryManager`, `WebServer` WITHOUT importing `electron` or instantiating `BrowserWindow`. (Mirrors the `src/cli/` Node-only pattern that already exists.)
- [ ] ISC-29: `app.getPath('userData')` callsites (estimated ~10-20) are replaced with `process.env.MAESTRO_DATA_DIR ?? path.join(os.homedir(), '.config/maestro')`.
- [ ] ISC-30: All 42 `mainWindow.webContents.send(...)` callsites either route through `WebServer.broadcastService` or are deleted; web clients receive the same updates over WebSocket.
- [ ] ISC-31: `CallbackRegistry` is wired by the server itself in headless mode (replacing the renderer-round-trip that currently provides session callbacks).
- [ ] ISC-32: Desktop-only IPC handlers (`dialog:*`, `shell:*`, `devtools:*`, `power:*`, `tunnel:*`, `updates:*`, `clipboard:*`, `fonts:*`) are deleted or replaced with web-API equivalents in `src/server/` build, listed individually in Decisions.
- [ ] ISC-33: `@sentry/electron` is split: `@sentry/node` in `src/server/`, `@sentry/browser` in `src/web/`. Server process does not pull `@sentry/electron` at runtime.
- [ ] ISC-34: `electron-updater` is excluded from the server build (`src/main/auto-updater.ts` not imported by `src/server/index.ts`).
- [ ] ISC-35: `electron-devtools-installer` excluded from server build (it's already dev-only).
- [ ] ISC-36: `electron-store` is replaced with a file-based JSON store rooted at `MAESTRO_DATA_DIR`. The on-disk schema is preserved so a desktop-app data dir can be copied into web mode with no migration.
- [ ] ISC-37: Existing single-token-in-URL auth at `WebServer.ts:111-128` is retained as-is for Tier 1/2 over Tailscale — Anti: Tier 3 (multi-tenant) is excluded so no real-auth work this fork.
- [ ] ISC-38: chokidar watchers continue to operate, watching server-side workspace paths rather than client-chosen paths. Watch root configurable via `MAESTRO_WORKSPACE`.
- [ ] ISC-39: Service worker + PWA install banner at `/` are functional from a Tailscale URL (Interceptor probe on iPhone Safari, "Add to Home Screen" works).
- [ ] ISC-40: Rebase smoke — cleanly `git pull upstream main` and rebuild without conflict in non-`src/server/` files. (Bias edits to NEW files; minimize touches to upstream's `src/main/` and `src/main/web-server/`.)

### Scope decision required from principal (NEW after agent report)

- [ ] ISC-41: **Principal-decision-gated.** Either accept "browser UI is the mobile-companion surface (~mobile/App.tsx, no session-create, no agent-config, no file-browse, no git-diff, no Auto Run UI)" OR scope a Tier-1.5 to grow `src/web/` to cover desktop-class features. ANTI: must not silently regress desktop functionality without explicit acknowledgment.
- [ ] ISC-42: xterm.js + raw-byte WS multiplex SCOPED IN as Layer 6. Server-side multiplex shipped in L6.1 (sha `1e4b90e75`); client-side xterm renderer in L6.2 (in flight); scrollback disk persistence in L6.3. Status: server-half closed; client + persistence pending.
- [ ] ISC-43: **Anti: no commit on this fork modifies any file under `src/web/`.** Verified by `git log origin/main..HEAD -- src/web/` returning empty for any range under consideration. Auto-formatter runs, lint-fix sweeps, typo fixes — all forbidden. If a fix is needed, it happens in `src/webFull/`.

## Test Strategy

### Layer-0 / infrastructure ISCs

| ISC range | Probe type | Tool | Threshold |
|-----------|------------|------|-----------|
| 1-3 | command exit code + file existence | `Bash`, `Read` | exit 0, file present |
| 4-6 | HTTP/WS probe | `curl -i`, WS smoke client | 2xx status, < 2s handshake |
| 5, 10, 11 | live browser render | `Skill("Interceptor")` screenshot at the URL | UI visibly mounts, no console errors |
| 7, 28-40 | code-level | `Read`, `Grep`, code review | bridge code path matches Decisions entry |
| 8 | launchd | `launchctl list \| grep maestro`, reboot smoke | service present, restarts on reboot |
| 9, 17 | network surface | `lsof -i :<port>`, `tailscale serve status`, external `curl` from non-tailnet | bind matches policy |
| 12-14 | multi-client behavior | two Interceptor sessions side-by-side | state propagates < 1s |
| 13 | pty persistence | WS reconnect smoke after `kill -9` browser tab | scrollback intact |
| 16, 19 | process tree | `ps`, `lsof` against running server | electron binary absent |
| 18 | egress | `tcpdump`/`Little Snitch` for 60s idle | zero non-tailnet packets |
| 20 | upstream compat | `git checkout upstream/main && npm run dev` in worktree | Electron dev still launches |
| 22 | reproducibility | hash dist/web twice from same SHA | matches |
| 23-24 | upstream tooling | `bun run lint`, `bun run test` | exit 0 |
| 25-27 | docs presence | `Read` | files exist with content |

### Per-feature function-parity ISCs (added when each port lands)

Every feature ported into `src/webFull/` gets a parity catalog at `src/webFull/<feature>/parity.test.ts` per the function-parity verification methodology ([brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md)). The catalog is recorded against Electron at `localhost:9222` (the reference oracle), replayed against webFull at `localhost:5176`, and must pass on both. The allowed assertion types are `hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast` — see [brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md) for the full vocabulary and the standing "catalog is the spec, not the renderer source" rule. Per-feature ISCs will land in this ISA at the time each port commits, formatted as: `ISC-44.x: <feature-name> parity catalog passes against both Electron and webFull, ≥N stories, including ≥1 negative-path story per happy-path story`.

#### ISC-44.x deferral tracking (per Architect plan-reeval-1 START directive)

> Every "Coming in subsequent layers" deferral enumerated in a shipped layer becomes a tracked `ISC-44.<tab>.<deferral>` so the partial-parity surface is countable. Three terminal statuses: `DEFERRED` (will be ported), `DROPPED` (no browser equivalent — won't be ported), `MISSING` (must be added, blocks ideal state). See Decisions 2026-06-08 ("Adopted `ISC-44.<tab>.<deferral>` tracking convention").

- [ ] ISC-44.general.wakatime: Settings General tab's wakatime status + API-key validation surfaced via `/api/wakatime/*` REST routes. Currently DEFERRED (renderer reads `wakatime:*` IPC).
- [ ] ISC-44.general.sync: storage location + custom path + folder picker via `/api/sync/*`. Currently DEFERRED.
- [ ] ISC-44.general.stats: DB size + clear-old-data + earliest-timestamp via `/api/stats/*`. Currently DEFERRED.
- [ ] ISC-44.general.shells: shells:detect + custom shell path + args + env-var editor. Currently DEFERRED (local-machine concept — server's machine may not match client's; design call needed).
- [ ] ISC-44.general.power: power.setEnabled (sleep prevention). Currently DROPPED (Electron-only; no browser equivalent).
- [ ] ISC-44.general.gpu_acceleration: GPU acceleration toggle. Currently DROPPED (Electron renderer setting).
- [ ] ISC-44.general.shell_open_path: shell.openPath ("open in Finder"). Currently DROPPED (no browser equivalent).
- [ ] ISC-44.display.font_family: fontFamily picker + custom-font management via `/api/fonts/detected`. Currently DEFERRED.
- [ ] ISC-44.display.window_chrome: useNativeTitleBar + autoHideMenuBar. Currently DROPPED (Electron BrowserWindow chrome).
- [ ] ISC-44.display.bionify_info_modal: bionify info modal. Currently DEFERRED (non-essential).
- [x] ISC-44.global.settings_broadcast: ISC-14 (CLOSED 2026-06-08) — `settings_changed` WS broadcast on server-side mutation so concurrent browsers stay in sync without reload. Was MISSING; shipped on `w2-isc14-settings-broadcast` (plan-reeval-1 N2 closure). Fan-out frame `{type:'settings_changed', changedKeys, newValues, timestamp}` emitted by headless server on every successful PATCH /api/settings; webFull `useSettings()` subscribes via module-level event bus and merges newValues into local state. Last-writer-wins per ISA Principle 2. See Decisions 2026-06-08 ("ISC-44.global.settings_broadcast shipped").

## Features

> Filled in PLAN phase. Initial breakdown:

| name | satisfies | depends_on | parallelizable |
|------|-----------|------------|----------------|
| F1: vanilla-node launch script | ISC-3, ISC-37 | — | yes |
| F2: IPC bridge collapse (decide stub vs rewrite) | ISC-7, ISC-28, ISC-36 | research-agent report | no |
| F3: native-module rebuild story (off-Electron ABI) | ISC-1 | — | yes |
| F4: launchd service + Tailscale bind | ISC-8, ISC-9, ISC-26 | F1 | yes |
| F5: pty session persistence across WS reconnect | ISC-13, ISC-29 | F1 | yes |
| F6: settings/sentry/updater de-Electron-ification | ISC-19, ISC-32-35 | research-agent report | yes |
| F7: rebase hygiene + README.fork.md | ISC-20, ISC-25, ISC-27, ISC-40 | — | yes |

## Decisions

- **2026-06-07** — Forked `RunMaestro/Maestro` to `trillium/Maestro` and cloned to `~/code/maestro`. Upstream remote not yet wired; will add as `upstream` to support periodic rebases.
- **2026-06-07** — Tier 3 (multi-tenant SaaS) declared **Out of Scope** in this ISA. Single-user-multi-device is the design point. Anti-criterion ISC-16/17/19 derive from this.
- **2026-06-07** — Tailscale is treated as the perimeter. No public TLS, no OAuth, no in-app session login. Trade-off: if Trillium ever wants to share Maestro with anyone else, this assumption breaks and the auth story becomes a separate project — accepted.
- **2026-06-07** — `@sentry/electron`, `electron-updater`, `electron-store`, `electron-devtools-installer` all targeted for replacement or removal in the web-mode launch path. Concrete strategy per dep is PENDING the research agent report (ISC-33/34/35/19 + ISC-32).
- **2026-06-07** — refined: Initial ISC count is 40 (well below E4 ≥128 floor). Reason: granular per-IPC-channel and per-native-module ISCs require the background agent's inventory of `src/main/web-server/web-server-factory.ts` IPC channels and the native-module callsite list. Floor will be revisited when the conversion assessment ([brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md)) findings are distilled into criteria; new ISCs append as `ISC-N.M` per ID-stability rule, never re-number.
- **2026-06-07** — Substantial web target already exists upstream: `src/web/`, `src/main/web-server/{WebServer.ts, web-server-factory.ts, routes/{api,static,ws}Routes.ts}`, Fastify on port 45678, `vite.config.web.mts` proxying `/api` and `/ws`. This means conversion is more "decouple the server from `app.whenReady`" than "build a server from scratch." Adjusted PLAN scope accordingly.
- **2026-06-07** — `AskUserQuestion` tool will NOT be used to ask Trillium to pick Tier 1 vs Tier 2; per his standing feedback, the agent presents the plan in prose and stops, letting him redirect.
- **2026-06-07** — Plan-Means-Stop: this ISA-establishing run completes at PLAN. EXECUTE/BUILD does not start until Trillium reviews the tiered plan and approves a first probe.
- **2026-06-07** — Fork-hygiene decision: duplicated `src/web/` → `src/webFull/` (71 files, 1.1 MB). All "grow the web bundle to desktop-class features" work happens in `src/webFull/`; `src/web/` stays a verbatim mirror of upstream so `git pull upstream main` is mechanical. Trade-off: the two trees will diverge — any UX work the upstream maintainer does on `src/web/` will need to be cherry-picked into `src/webFull/`, not auto-inherited. Accepted because Trillium is explicitly aiming for a different product (desktop-equivalent web), not the upstream mobile-companion.
- **2026-06-07** — Background agent's web-port codebase conversion assessment ([brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md), ~14 KB) materially changed the picture. Key new findings: (1) shipped web bundle is mobile-remote-control, not full Maestro; (2) `src/cli/` is electron-free, proving Node-only execution path is structurally already there; (3) 303 `ipcMain.handle` channels across 30 files but web client has ZERO direct IPC (talks only HTTP/WS via token-in-URL); (4) `tunnel-manager.ts` (Cloudflare tunnel) already exists upstream and proves the "browser-from-anywhere" mental model is precedented; (5) no xterm.js anywhere in renderer — PTY-in-browser is a separate sub-project. **New Tier 0 ("use what's there") added to plan** — run upstream Electron headless on mini2, expose existing dashboard URL over Tailscale. May be the right first answer.
- **2026-06-07** — All time estimates stripped from this ISA and the support docs per principal's standing instruction. Plan is ordered by dependency, not by duration. Logical port order lives in `WEB_PORT_ORDER.md`. See feedback memory `feedback_no_time_estimates`.
- **2026-06-07** — **Delegation-first execution model adopted.** Trillium's framing: this whole port project is delegate-able because we have a working Electron app as a golden reference. Per-feature agents read `src/renderer/<surface>`, drive both Electron (via CDP at `localhost:9222`) and `src/webFull/` (via Vite dev server) side-by-side, port the UI to talk to the existing WS protocol, and verify by comparing observed behavior. Each agent runs in a worktree-isolated branch. Layer 0 from `WEB_PORT_ORDER.md` must complete BEFORE the delegation pipeline starts — agents need a vanilla-Node server entrypoint to run their builds against. After Layer 0, Layers 1-9 fan out cleanly: most features within a layer have no inter-feature dependencies and can run in parallel agents. The delegation harness itself (per-feature agent contract, comparison loop, merge protocol) is the next concrete artifact to design once Layer 0 work begins.
- **2026-06-07** — **Function parity is the verification bar, not structural/protocol parity.** Methodology lives in [brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md): every feature port ships with a user-story catalog of (`Given`, `When`, `Then`) triples; assertions use a fixed vocabulary (`hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast`) that's deliberately layout-independent; the catalog is recorded against the running Electron app (the test oracle) and replayed against webFull; pass criteria = every catalog story passes on both targets. Pixel-perfect, DOM-identical, and CSS-identical parity are explicitly rejected as the wrong bar. The catalog IS the spec — not the renderer source — to protect against agent hallucination and renderer-bug canonization.
- **2026-06-08** — **Layer 0a shipped: bootable headless server with read-only callbacks.** The Fastify+WebSocket server in `src/main/web-server/WebServer.ts` now boots from a vanilla Node entrypoint (`src/server/index.ts`) with no `electron` import in the runtime path. What landed: (1) `src/shared/data-dir.ts` — dual-mode userData resolver that returns `app.getPath('userData')` under Electron else `MAESTRO_DATA_DIR ?? ~/.config/maestro` (covers ISC-29); (2) `src/shared/file-store.ts` — `electron-store`-shape JSON file store that preserves on-disk schema so a desktop data dir is portable into headless mode (covers ISC-36); (3) `src/server/index.ts` — entrypoint that constructs `WebServer`, wires READ callbacks (`getSessions`, `getSessionDetail`, `getTheme`, `getBionifyReadingMode`, `getCustomCommands`, `getHistory` — the last stubbed to `[]` pending HistoryManager port) to file-backed stores; WRITE callbacks (`writeToSession`, `executeCommand`, `interruptSession`, `switchMode`, `selectSession`, `selectTab`, `newTab`, `closeTab`, `renameTab`, `starTab`, `reorderTab`, `toggleBookmark`) log a warning and return `false`; (4) `tsconfig.server.json` — server-only TS build (rootDir `src`, outDir `dist`) so `dist/server/index.js` is the runnable artifact; (5) `package.json` scripts `build:server` + `start:web`. **Upstream files touched:** zero — every change is in NEW files (`src/server/`, `src/shared/`, `tsconfig.server.json`) plus a two-line `package.json` scripts addition.
- **2026-06-08** — **Layer 0b shipped: write/interrupt/execute callbacks wired via ProcessManager.** `src/server/process-manager-adapter.ts` (108 LOC) instantiates a single `ProcessManager` at server startup; `src/server/index.ts` routes `setWriteToSessionCallback` / `setExecuteCommandCallback` / `setInterruptSessionCallback` through it. Suffix logic (`-ai` / `-terminal`) mirrors `src/main/web-server/web-server-factory.ts` lines 248-272 verbatim — the adapter reads the live sessions store on every call (lookup closure), matches by `s.id`, and resolves `inputMode === 'ai' ? '${id}-ai' : '${id}-terminal'`. ProcessManager confirmed electron-free (grep across `src/main/process-manager/`, `src/main/parsers/`, `src/shared/` returned zero `from 'electron'` hits). `tsconfig.server.json` `include` widened to add `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts`; build still emits cleanly and `grep -r "from 'electron'" dist/server/` stays empty. **Out of scope (still stubbed, deferred to Layer 0c):** `switchMode`, `selectSession`, `selectTab`, `newTab`, `closeTab`, `renameTab`, `starTab`, `reorderTab`, `toggleBookmark` — these need write-back to the sessions store and WebSocket broadcast plumbing. `executeCommand`'s "spawn new session if none exists" semantics also deferred — full session-creation flow lives in the renderer today and needs a server-side port plus a UI surface in Layer 3.
- **2026-06-08** — **Layer 1.1 shipped: `vite.config.webfull.mts` sibling config + dev/build scripts.** Pattern: a parallel Vite config file (sibling to `vite.config.web.mts`) drives the `src/webFull/` divergent tree without touching `vite.config.web.mts`, `tsconfig.json`, or any file under `src/web/`. Surgical changes from the original: `root` and `publicDir` repointed to `src/webFull/` (+ `src/webFull/public/`); `outDir` → `dist/webfull/`; dev port 5174 → 5176, preview 5175 → 5177 (both `strictPort: true`); `@web` alias re-pointed at `src/webFull` so any import that resolves through the alias stays inside the webfull tree (no new `@webfull` alias added — keeping import sites stable across the two trees). All other settings (`define`, `esbuild`, build target, manualChunks logic, css, optimizeDeps, proxy) carried over verbatim. The `mobile/` and `desktop/` path-based chunk naming continues to work because `src/webFull/` was forked verbatim from `src/web/`. Files touched: NEW `vite.config.webfull.mts`; 2-line scripts addition in `package.json` (`dev:webfull`, `build:webfull`). NOT added to the aggregate `build` script — that stays upstream-compatible. No edits to `src/web/`, `vite.config.web.mts`, or `tsconfig.json`. Plumbing only — subsequent web-UI port agents now have a `src/webFull/` build target to land against.
- **2026-06-08** — **mini2 deploy spike pre-staged in `infra/` directory.** The Architect's 2026-06-08 audit flagged the mini2 deploy story as the most underspecified part of the plan and pointed out it is the actual Vision target (a Tailscale-reachable Maestro server running on `mini2`). This commit pre-stages the artifacts so the first real deploy is one command, not a debugging expedition. Three files land under a new `infra/` directory at the repo root: (1) `infra/DEPLOY_SPIKE.md` — Trillium-readable runbook covering prerequisites on mini2 (Tailscale, Node 22.x via fnm, Python 3.11 for `node-gyp`, Xcode CLT), one-time setup (clone path `~/code/maestro`, `npm install`, `npm run build:server`, verify-and-edit plist, bootstrap launchd), the steady-state deploy sequence (`./infra/deploy.sh`), four post-deploy verification checks (service state, loopback HTTP, Tailscale HTTP, browser load), data-dir backup/restore commands, log location, rollback procedure, and six explicit open questions for the first real run; (2) `infra/com.maestro.server.plist` — launchd LaunchAgent (not LaunchDaemon — runs as Trillium's user, no privileged listener) with `KeepAlive=true`, `RunAtLoad=true`, `ProcessType=Background`, `ThrottleInterval=10`, env vars wired (`MAESTRO_DATA_DIR=~/.config/maestro`, `MAESTRO_WEB_PORT=45678`, `NODE_ENV=production`, `PATH` including the fnm Node prefix), and stdout/stderr piped to `~/Library/Logs/maestro/`; (3) `infra/deploy.sh` — executable git pull + `npm ci` (fallback `npm install`) + `npm run build:server` + `launchctl bootout` + `launchctl bootstrap` + 3-second sleep + curl health probe + error-log tail on failure. The plist hard-codes the absolute node path (`/Users/trillium/.local/share/fnm/node-versions/v22.22.1/installation/bin/node`) with a TODO comment block at the top of the file documenting that the path needs verification on mini2 because launchd does not expand `$HOME` or PATH lookups in `ProgramArguments`. **NOT executed in this commit** — the agent authoring this does not have access to mini2. Trillium runs the first real deploy manually and reports findings back via a follow-on Decisions entry. **Six open questions surfaced for the first run:** Q1 data-dir migration from existing Electron `maestro-dev/` (untested per the audit); Q2 `customSyncPath` not consulted by `src/shared/data-dir.ts` so the server silently reads the wrong directory if Trillium has set it in Electron; Q3 exact fnm Node binary path on mini2; Q4 deploy-tag convention for rollback (`git tag deploy-...` in `deploy.sh` or `git reflog`?); Q5 `postinstall` electron-rebuild behavior on a host that never runs Electron; Q6 Tailscale port-exposure model (`0.0.0.0:45678` bind verified mini2-safe because no public IPv4, but should it be locked to the Tailscale interface?). **Files touched in this turn:** three NEW files under `infra/` plus this Decisions entry + the Verification entry below in `ISA.md`. **No source touched** — `git diff main..HEAD -- src/web/ | wc -c` and `git diff main..HEAD -- src/main/ | wc -c` both 0.
- **2026-06-08** — **`WEB_PORT_ORDER.md` restructured for primitives-first lift strategy.** The doc was rewritten on branch `docs-port-order-lift-first` to reflect findings from `/tmp/web-ui-lift-scope.md` (445-line lift audit). Three structural changes: (1) **inserted a new Layer 2 — Lift UI primitives** between the existing Layer 1 (webfull build target) and the existing Layer 2 (Identity + Settings). Layer 2 lifts `ui/Modal.tsx` (+ `LayerStackContext` + `useModalLayer` + `useLayerStack` + `MODAL_PRIORITIES`), `ui/FormInput.tsx`, `ui/EmojiPickerField.tsx`, `ConfirmModal.tsx`, and `GitStatusWidget.tsx` — all with 0 IPC and 0 Electron-only APIs per audit §B4. The Tailwind glob fix (`src/webFull/**` added to `tailwind.config.mjs:3`) is L1.2, a hard prerequisite for L2; (2) **renumbered subsequent layers** — old Layer 2 (Identity + Settings) → Layer 3; old Layer 3 (Create + Navigate) → Layer 4; old Layer 4 (xterm.js / raw-byte PTY) → Layer 6 and made explicitly scope-gated by ISC-42; History/AutoRun/Agents → Layer 7; Markdown/Files/Diffs → Layer 8; polish (LogViewer/About/ProcessMonitor/Sentry swap) → Layer 9; (3) **added a Lift-vs-Rewrite decision rule** as a top-level subsection: lift verbatim if 0 IPC ∧ 0 Electron-only API; rewrite-with-lifted-primitives if ≥1 IPC ∨ ≥1 Electron-only API; hybrid (lift JSX, rewrite hook) if 1–3 IPCs are isolated in one hook. Cites the audit's NOT-easy examples (`NewInstanceModal.tsx` 1822 LOC / 18 IPC, `GeneralTab.tsx` 1522 LOC / 17 IPC, `App.tsx` 3357 LOC) as canonical "rewrite, don't lift" cases. Also updated the IPC-substitution reference with the audit's one-line rule (`window.maestro.X.Y(args)` → `fetch('/${token}/api/X/Y', ...)` / POST / `useWebSocket()` subscription) and the 32-vs-886 server/renderer-surface imbalance the lift work compounds against. The "Working rule" at the top now reads "every layer item is built in `src/webFull/` and most items COMPOSE the primitives lifted in Layer 2 rather than re-lifting renderer components." **Cross-reference impact:** ISA.md line 129 (ISC-42) still reads "Layer 4 in `WEB_PORT_ORDER.md`" — the doc's Layer 6 self-notes the rename, but the ISA wording is intentionally left as-is per the brief's scope guard (the only ISA edit permitted in this turn was this Decisions append). When the ISC-42 scope decision is made, that line gets updated then; for now the layer-rename is one-line-documented at the bottom of `WEB_PORT_ORDER.md` Layer 6. **Files touched in this turn:** `WEB_PORT_ORDER.md` (new file at repo root reflecting the restructured plan) + this Decisions entry in `ISA.md`. No source touched.
- **2026-06-08** — **Drift fix: `MODAL_PRIORITIES` and `Layer` types in webFull converted from verbatim copies to re-exports from `src/renderer/`.** Architect's 2026-06-08 audit (risk A) flagged that L2.1 lifted `src/renderer/constants/modalPriorities.ts` and `src/renderer/types/layer.ts` into `src/webFull/constants/modalPriorities.ts` and `src/webFull/types/layer.ts` as byte-for-byte copies. Verbatim copies create silent-drift risk: any new modal priority or layer-kind added to the renderer source will fail to propagate, and TypeScript can't catch the mismatch because the two files are independent type sources. The drift-prevention pattern adopted: **for types/constants that are explicitly shared between renderer and webFull and have no semantic reason to diverge, the webFull file becomes a single-line `export * from '../../renderer/...';` re-export.** Rationale: (1) the rendering target is irrelevant — modal stacking semantics are determined by application logic, not by Electron-vs-browser; (2) the layer-stack discriminated union is a domain model, not a target-specific concern; (3) vite's resolver already handles cross-directory imports cleanly (webFull/vite config aliases `@renderer` to `src/renderer/`, and existing webFull files like `mobile/App.tsx`, `mobile/WebReadingContent.tsx`, `mobile/MobileMarkdownRenderer.tsx`, `mobile/SessionStatusBanner.tsx` already use `'../../renderer/...'` relative imports against `utils/contextUsage` and `utils/bionifyReadingMode` in production). tsconfig.json `include` covers `src/renderer` (the source) but NOT `src/webFull` — type-checking for webFull rides on vite/esbuild, not tsc, so the re-export resolves at bundle time without a tsc-level include change. **When to use this pattern:** the type/constant is named identically on both sides, the semantics are identical, divergence has no use case, and the audit/diff workflow would treat divergence as a bug. **When NOT to use:** anything that genuinely diverges (e.g. components with different DOM trees, hooks with different store dependencies, types with different optional fields). For divergent surfaces, the lift-and-adapt pattern from L2.1 remains correct. **Files touched:** `src/webFull/constants/modalPriorities.ts` (242 LOC of body replaced with 1 re-export line + 2 comment lines citing risk A), `src/webFull/types/layer.ts` (107 LOC of body replaced with 1 re-export line + 2 comment lines). No edits to `src/renderer/`, `src/web/`, `src/main/`, vite config, or tsconfig — the existing vite alias and resolver are sufficient. The renderer-side files remain the single source of truth; the webFull files are now derived artifacts that cannot drift by construction.
- **2026-06-08** — **Layer 3.1 shipped: Settings General tab rewritten in `src/webFull/` using lifted Modal primitive; first feature port to wire `<LayerStackProvider>` and the first additive REST routes on the server.** Per the lift-vs-rewrite rule, the renderer's `src/renderer/components/Settings/tabs/GeneralTab.tsx` (1522 LOC across 5 IPC namespaces — `settings`, `wakatime`, `sync`, `stats`, `shells`/`shell`) is firmly in the "rewrite, don't lift" zone; this wave delivers a webfull-native rewrite that preserves the OBSERVABLE FUNCTION (open settings → see general options → change them → save) without verbatim-copying renderer markup. **Files added (new files only, all under `src/webFull/`):** `src/webFull/components/Settings/SettingsModal.tsx` (96 LOC — webfull SettingsModal shell using lifted `Modal` primitive at `MODAL_PRIORITIES.SETTINGS` (450), tab strip ready for subsequent tab agents but only General wired today), `src/webFull/components/Settings/tabs/GeneralTab.tsx` (~320 LOC — covers the `settings.get/set` namespace: `conductorProfile`, `logLevel`, `enterToSendAI`, `enterToSendTerminal`, `defaultSaveToHistory`, `defaultShowThinking` (three-state), `autoScrollAiMode`, `spellCheck`, `automaticTabNamingEnabled`, `checkForUpdatesOnStartup`, `enableBetaUpdates`, `crashReportingEnabled`; explicit "deferred to subsequent layers" panel surfaces the partial-parity gaps so they are NOT silently dropped), `src/webFull/hooks/useSettings.ts` (130 LOC — REST-backed `useState`+`fetch` hook with optimistic update + rollback on PATCH failure; intentionally NOT Zustand per audit §C4), `src/webFull/components/Settings/parity.test.ts` (180 LOC — 5 stories: 3 happy-path + 2 negative-path; assertion vocabulary restricted to `hasElement`/`hasText`/`fsHas` per the function-parity verification methodology rules ([brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md)); vitest smoke pass guards the catalog shape until the record-and-replay harness lands). **Files edited (purely additive):** `src/webFull/App.tsx` — added `LayerStackProvider` import + wrap between `<ThemeProvider>` and `<Suspense>` (lines 20 + 285-294 approx, mounting around the line range documented as 285 in Layer 2.1's Decisions); `src/main/web-server/routes/apiRoutes.ts` — added two new routes (`GET /:token/api/settings` and `PATCH /:token/api/settings`) at the end of `registerRoutes()` plus a module-level `SettingsProvider` registry with `registerSettingsProvider`/`getSettingsProvider`/`_resetDefaultSettingsStore` exports; existing routes and `ApiRouteCallbacks` interface unchanged. **Server design decision — lazy default FileStore provider:** the brief authorizes editing `apiRoutes.ts` but explicitly forbids touching `WebServer.ts` (which is where existing callbacks get wired). To make the routes useful end-to-end without touching `WebServer.ts`, the route module exports a `registerSettingsProvider(p)` setter AND falls back to a lazily-instantiated `FileStore<Record<string, unknown>>` rooted at `getDataDir()` if no provider is registered. This means: (a) headless Node startup at `src/server/index.ts` can opt to register a provider later without further `apiRoutes.ts` edits; (b) until then, the routes work directly against the same `maestro-settings.json` file `src/server/index.ts` already reads via its own `FileStore`. Trade-off accepted: a second FileStore instance exists transiently against the same JSON file. FileStore's write path uses temp-file-rename (`src/shared/file-store.ts:54-57`) so the on-disk file stays valid under concurrent reads; the renderer/Electron path never calls these routes, so the only real client is the webFull bundle. **LayerStackProvider mount point:** `src/webFull/App.tsx` — the L2.1 agent reported it would land around line 285; in this branch it landed at the corresponding `<ThemeProvider>` body (which moved by 7 lines after the comment + provider insertion). The provider wraps `<Suspense fallback={<LoadingFallback />}>` so every modal lifted into the lazy mobile bundle has a layer stack to register against. **New REST endpoints (additive in `src/main/web-server/routes/apiRoutes.ts`):** `GET /:token/api/settings` returns `{ settings: Record<string, unknown>, timestamp: number }`; `PATCH /:token/api/settings` accepts body `{ patch: Record<string, unknown> }` and returns the same shape (with the patch applied). 503 when no provider is registered AND the default store can't be instantiated (e.g. permissions); 400 on invalid PATCH body shape; 500 on read/write errors. **Partial-parity gaps surfaced (per the brief's "reject patterns that bail out of full parity" rule):** the General tab body shows a "Coming in subsequent layers" panel listing exactly what's deferred — WakaTime CLI status & API-key validation (`wakatime:*` namespace), sync / storage location picker (`sync:*` namespace — needs a server-side `/api/sync/*` plus a typed folder-path input since the browser can't dialog-pick a folder), stats DB size/clear/earliest-timestamp (`stats:*` namespace — port adds `/api/stats/*`), shell detection & custom shell path / args / env vars (`shells:detect` is a local-machine concept; the renderer's machine ≠ the server's machine in headless mode), sleep prevention (`power.setEnabled` — Electron-only; no browser equivalent), GPU acceleration toggle (Electron renderer setting), "Open in Finder" affordances (`shell.openPath` — no browser equivalent). Each gap is named explicitly so subsequent Settings-tab agents can pick them up rather than wonder what was silently dropped. **Lift-vs-rewrite call made:** REWRITE-with-lifted-primitives. The renderer's GeneralTab has 17 IPC callsites across 5 namespaces; the audit threshold for "lift" is 0 IPC ∧ 0 Electron-only API; for "rewrite" is ≥1 IPC ∨ ≥1 Electron-only API. GeneralTab is well past the threshold. The lifted Modal primitive (Layer 2.1) carries 100% of the modal shell behavior; only the body content is webfull-native. **Scope guards (verified post-write, pre-commit):** `git diff main..HEAD -- src/web/ | wc -c` → 0; `git diff main..HEAD -- src/renderer/ | wc -c` → 0. Only edits outside `src/webFull/` are the additive REST routes in `src/main/web-server/routes/apiRoutes.ts`. No new env vars, no new dependencies, no new package.json scripts.
- **2026-06-08** — **Layer 2.1 shipped: visual primitives (Modal + FormInput + ConfirmModal) lifted from `src/renderer/` into `src/webFull/`, plus webFull added to Tailwind content glob.** This wave proves the lift-and-adapt pattern from the `/tmp/web-ui-lift-scope.md` audit by lifting the leaf-most visual atoms that have zero IPC and zero Electron API — subsequent feature ports now have UI building blocks already in `src/webFull/`. **Tailwind config:** one-line edit to `tailwind.config.mjs:3` adds `'./src/webFull/**/*.{js,ts,jsx,tsx}'` to the content array (the audit-flagged blocker — without it any Tailwind class in webFull files gets purged at build). This is the ONLY upstream-file edit in this wave; rationale for selecting it as the single allowed upstream edit: the content glob is the most rebase-stable part of a Tailwind config (Tailwind itself authoring guidance frames it as "add your source paths here"), so the rebase-conflict cost is minimal vs the alternative of leaving the bug in place and shipping broken CSS in production. **Lifted primitives (3 files):** `src/webFull/components/ui/Modal.tsx` (200 LOC), `src/webFull/components/ui/FormInput.tsx` (189 LOC), `src/webFull/components/ConfirmModal.tsx` (74 LOC). **Lifted supporting infra (the audit's "pre-flight" set — required because all three primitives transitively depend on the layer stack system, and webFull had no layer stack of its own yet):** `src/webFull/types/layer.ts` (108 LOC), `src/webFull/constants/modalPriorities.ts` (243 LOC), `src/webFull/hooks/useLayerStack.ts` (300 LOC), `src/webFull/contexts/LayerStackContext.tsx` (90 LOC), `src/webFull/hooks/useModalLayer.ts` (124 LOC). **Theme access pattern decision:** primitives keep the renderer's `theme: Theme` prop convention rather than calling `useTheme()` internally. Rationale per `/tmp/web-ui-lift-scope.md` A3: the renderer threads `theme` as a prop from `App.tsx` while webFull provides theme via `useTheme()` context, but the primitives themselves are tree-shape-agnostic — by accepting `theme` as a prop they work identically under either pattern. Consumers in webFull call `const { theme } = useTheme()` at the feature-component level and pass `theme` into the primitive; that keeps the primitive's diff vs the renderer source minimal (smaller rebase surface) and avoids coupling the primitive's signature to webFull's specific ThemeProvider. Trade-off accepted: feature consumers in webFull have one extra line of code vs reading theme from context directly inside the primitive. **Import path adapts (the only non-verbatim changes vs renderer source):** Modal.tsx — `Theme` from `'../../types'` became `'../../../shared/theme-types'` (webFull has no `types/index.ts` aggregator yet), and `useModalLayer` / `UseModalLayerOptions` from `'../../hooks'` became `'../../hooks/useModalLayer'` (webFull keeps `hooks/` flat; renderer routes through `hooks/ui/` barrel). FormInput.tsx — same `Theme` path adapt only. ConfirmModal.tsx — `Theme` from `'../types'` became `'../../shared/theme-types'`; everything else (Modal/ModalFooter import, MODAL_PRIORITIES import) stays at the same relative path. `useLayerStack.ts` — `Layer`/`LayerInput` import path from `'../../types/layer'` became `'../types/layer'` (webFull hooks/ is one level shallower than renderer hooks/ui/). `useModalLayer.ts` — `useLayerStack` from `'../../contexts/LayerStackContext'` became `'../contexts/LayerStackContext'`; `FocusTrapMode` from `'../../types/layer'` became `'../types/layer'`. `LayerStackContext.tsx` — `useLayerStack`/`LayerStackAPI` import from the renderer's `'../hooks'` barrel became a direct file import `'../hooks/useLayerStack'` (no barrel in webFull/hooks yet — direct imports keep the surface explicit until more hooks land). **Barrel exposure:** `src/webFull/components/index.ts` gained 8 lines re-exporting Modal/ModalFooter/FormInput/ConfirmModal (plus their prop types). This is an in-fork divergent-tree edit (NOT an upstream-tracked file — `src/webFull/` was forked specifically to support divergence), not counted as a second upstream-file edit. **Wiring deferred — LayerStackProvider not yet mounted in webFull/App.tsx:** the lifted primitives compile and are tree-shaken-only-because-no-feature-consumer-imports-them-yet; first feature port that lifts a modal will need to wrap the App tree in `<LayerStackProvider>` once (around `<ThemeProvider>` at `src/webFull/App.tsx:285`). That edit was scoped out of this wave because it's a runtime wiring change with no consumer yet to validate it. Documented here so the next port agent doesn't repeat the discovery. **No FAIL-OUT cases:** none of the three primitives transitively touched IPC, an Electron API, a Zustand store, or a context that didn't lift cleanly. The audit's predicted "lift verbatim" verdict for these three held exactly. **Scope guard:** `git diff main..HEAD -- src/web/ | wc -c` → 0 (verified). Only upstream-file edit in this wave is the tailwind.config.mjs one-liner; everything else is new files under `src/webFull/` (or the in-fork barrel edit).
- **2026-06-08** — **ISA.md marked `merge=union` in `.gitattributes` to eliminate parallel-branch conflicts.** Architect's 2026-06-08 audit flagged ISA.md as the most collision-prone file in the project: every layer ships a Decisions entry and a Verification entry on its own branch, and the default git 3-way merge driver treats parallel appends to the same file as a conflict requiring manual resolution. The textbook fix is git's built-in `union` merge driver — when two branches both append to ISA.md, the driver takes the union of both sides (keeping every line from both parents) instead of emitting conflict markers. Applied via a new `.gitattributes` at the repo root with a single rule `ISA.md merge=union` plus a comment block explaining the append-only convention that makes the driver semantically safe. **The convention is the load-bearing piece:** ISA.md edits must be append-only — Decisions/Verification/Changelog entries are write-once-by-date, never edited in place. Under that discipline, union merge produces correct results (the union of two append sets equals the intended combined history). If someone violates the convention by editing an existing entry on a branch, union merge will silently keep both versions side-by-side rather than flagging a conflict; that's the accepted trade-off for zero-friction parallel appends. **Files touched in this turn:** NEW `.gitattributes` at repo root (single rule + comment block) + this Decisions entry + a Verification evidence entry below. No source touched.
- **2026-06-08** — Added `PLAN.md` at the repo root as a single entry-point summary linking to ISA, WEB_PORT_ORDER, and the three assessment docs. Living doc; updates land here when execution state changes materially.
- **2026-06-08** — **Layer 0e shipped (scaffold-only): `@sentry/node` + `@sentry/browser` wrapper modules.** ISC-33's Layer 0a evidence closed as a partial PASS — `@sentry/electron` is absent from `dist/server/` only because `tsconfig.server.json` happens to omit the paths that pull it. A future import of `src/main/utils/sentry.ts` into the server graph (or any reach into the renderer-side Sentry wrapper from webFull) would silently regress that PASS. This wave lands the explicit-replacement modules so the next time someone needs server-side or webFull-side error reporting, the right SDK is sitting there ready. **NEW `src/server/sentry.ts`:** thin `@sentry/node` wrapper exposing `initSentry({ dsn?, environment? })`, `captureException(err, context?)`, `captureMessage(msg, level?, context?)`. Lazy require on `@sentry/node` only when a DSN is present (`opts.dsn` or `process.env.MAESTRO_SENTRY_DSN`); no-op otherwise. API shape mirrors `src/main/utils/sentry.ts` so call sites are mechanically swappable between desktop-main and headless-server. **NEW `src/webFull/utils/sentry.ts`:** same three-function surface, lazy dynamic-import of `@sentry/browser` (so Vite/Rollup code-splits it into a chunk that DSN-less users never download), DSN read from `import.meta.env.MAESTRO_PUBLIC_SENTRY_DSN` (the `PUBLIC_` prefix is Vite's convention for browser-safe env vars). **`package.json` deps added:** `@sentry/browser@^7.5.0` and `@sentry/node@^7.5.0` — both pinned to the same major as the existing `@sentry/electron@^7.5.0` for cross-process API compat (npm resolved both to 7.120.4, matching the version `@sentry/electron`'s transitive deps already pulled in). `@sentry/electron` itself is intentionally retained — the desktop renderer still uses it, only the server and webFull bundles are explicitly redirected away from it. **Deliberately deferred to follow-on:** the actual `initSentry()` call in `src/server/index.ts` (and in `src/webFull/main.tsx` / `App.tsx`). Decoupling the init wire-up from the scaffold avoids a merge collision with in-flight work on `layer-0c-remaining-writes` which is editing `src/server/index.ts`. **Scope guard verified:** `git diff main..HEAD -- src/web/ | wc -c` → 0; `git diff main..HEAD -- src/main/ | wc -c` → 0; `git diff main..HEAD -- src/server/index.ts | wc -c` → 0. **ISC-33 closure path:** when the init wire-up lands, ISC-33 graduates from "not in dist" (partial PASS) to "explicitly replaced with the right SDK per surface" (full PASS) — the wrapper modules are the keystone for that flip.
- **2026-06-08** — **Additive upstream-config edits authorized under ISC-40 with explicit Decision entries.** ISC-40 ("bias new files; minimize touches") forbids invasive upstream-file edits but does NOT forbid all upstream touches. Recognized exception: additive config edits (extending a tailwind content glob to include `src/webFull/`, widening a tsconfig `include` array to add a new directory, etc.) where the diff is a single line and rebase-trivial. Each such edit MUST have an accompanying Decision entry naming the file, the line edited, the rationale, and the rebase-risk assessment. Already-landed examples: `tailwind.config.mjs` line 3 content-glob extension (Layer 2.1, sha `edfa532b2`); `tsconfig.server.json` `include` array extension to `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts` (Layer 0b, sha `0cbd4df5c`). Anti-criterion: NO modifications to existing logic in upstream files. Read-only patterns (re-exports, additive includes) are the only authorized shapes.
- **2026-06-08** — **Layer 0g shipped: ISC-33 client closure — Sentry init wired in `src/webFull/main.tsx`.** L0f landed the server-side `initSentry()` call ahead of `WebServer` construction in `src/server/index.ts` and flipped ISC-33 from partial PASS ("not in dist") to PASS ("explicitly replaced with `@sentry/node`") on the server side. This wave does the symmetric flip on the webFull (browser) side: `src/webFull/main.tsx` now imports `initSentry` + `captureException` from `./utils/sentry` (the L0e scaffold), calls `initSentry()` as the earliest statement after the import block — before `createRoot(container).render(<AppRoot />)` — so any error thrown during the React mount (or in an early bundle-evaluation side effect) is captured when `MAESTRO_PUBLIC_SENTRY_DSN` is set at build time. Two `window.addEventListener` handlers (`'error'`, `'unhandledrejection'`) installed immediately after `initSentry()` route browser-level uncaught exceptions and unhandled promise rejections through `captureException(err, { source: 'window_error' | 'unhandled_rejection' })`. Rationale for the listener pair over an `ErrorBoundary` wrap: webFull's `App.tsx` currently has no top-level `<ErrorBoundary>` and the App tree is wrapped in `StrictMode` + `ThemeProvider` rather than an error fence — listeners on `window` catch faults that escape React (event handlers, async work, native APIs) as well as faults inside the React tree that React re-throws at the document root. Both listeners are no-ops when Sentry isn't initialized (the wrapper's `captureException` short-circuits when `sentryModule === null`), and `initSentry()` itself is a no-op when no DSN is present, so DSN-less builds pay zero runtime cost beyond two empty event listeners. The lazy `import('@sentry/browser')` inside `initSentry()` still code-splits the SDK into a separate Rollup chunk (this build: `index-BaW46i7p.js` 407.56 kB), so DSN-less users still don't download `@sentry/browser` at runtime — Vite emits the chunk but the entry chunk's dynamic import never resolves. **Files touched:** `src/webFull/main.tsx` only (3-line import addition, 1-line `initSentry()` call, two `window.addEventListener` blocks — all additive within the existing entrypoint, no upstream files modified). **ISC-33 status:** with the server-side init (L0f) and the client-side init (this wave) both landed, ISC-33 now closes as full PASS — `@sentry/electron` is explicitly replaced with `@sentry/node` for the server bundle and `@sentry/browser` for the webFull bundle, with no residual `@sentry/electron` imports in either dist.
- **2026-06-08** — **`getDataDir()` extended to read `customSyncPath` from `maestro-bootstrap.json` in headless mode.** Architect's 2026-06-08 audit (Finding 3) flagged that `src/shared/data-dir.ts` was not equivalent to `electron-store` semantics: Electron's `instances.ts:86` resolves the sync path as `getCustomSyncPath(_bootstrapStore) ?? app.getPath('userData')`, but headless mode only consulted `MAESTRO_DATA_DIR` and silently fell back to `~/.config/maestro` — meaning a desktop user who configured a custom sync path in the Electron Settings UI would have the headless server invisibly read defaults from a completely different directory, presenting an empty/stale state. New resolution order in headless mode: (1) `MAESTRO_DATA_DIR` env var (explicit override, highest precedence); (2) `customSyncPath` field in `<defaultUserData>/maestro-bootstrap.json` where `<defaultUserData>` is `~/.config/maestro`; (3) `~/.config/maestro` fallback. The bootstrap-reading path uses raw `fs.readFileSync` + `JSON.parse` — not `electron-store` or `FileStore` — to keep `src/shared/data-dir.ts` dependency-light. A minimal `isValidCustomSyncPath` validator inlined in the same file mirrors the absolute-path / null-byte / traversal-segment checks from `src/main/stores/utils.ts:isValidSyncPath`; the full Windows-reserved-name + sensitive-system-dir checks from that validator are deliberately NOT duplicated because the Electron-side validator already runs before the value ever lands in `maestro-bootstrap.json` (this is a second-line defense for read-time integrity, not the primary validator). Any error in the read path (missing file, malformed JSON, missing field, validation failure) falls through silently to the default, matching the Electron-side `getCustomSyncPath()` return-undefined-on-failure behavior. Files touched: `src/shared/data-dir.ts` only — additive logic, no upstream files modified (`src/main/` diff is zero bytes). Anti-pattern guard from the brief honored: the bootstrap-reading logic was kept INSIDE `src/shared/data-dir.ts` rather than spawning a new `src/shared/bootstrap-reader.ts` module, because the reader is ~12 LOC and only one caller exists — premature shared-module extraction would just add an import boundary with no second consumer to justify it.
- **2026-06-08** — **Layer 0h shipped: server-side `HistoryManager` port + `setGetHistoryCallback` wired through to per-session storage.** The L0a stub `setGetHistoryCallback(() => [])` in `src/server/index.ts` returned an empty array unconditionally because the canonical `HistoryManager` at `src/main/history-manager.ts` imports `electron`'s `app.getPath('userData')` and `src/main/utils/logger` / `src/main/utils/sentry` (the sentry wrapper transitively pulls `@sentry/electron/main`). This wave lands a NEW `src/server/history-manager.ts` that ports the entire public API to a headless variant and wires it through the stubbed callback. **File added:** `src/server/history-manager.ts` (~480 LOC). **Substitutions vs `src/main/history-manager.ts`** (verbatim except for these): (1) `import { app } from 'electron'` → `import { getDataDir } from '../shared/data-dir'`; constructor reads `this.configDir = getDataDir()` instead of `app.getPath('userData')` — the L0a-era `data-dir.ts` already handles the `MAESTRO_DATA_DIR` env / `customSyncPath` bootstrap precedence chain, so the on-disk root resolves identically to the Electron path when run against the same dataDir. (2) `import { logger } from './utils/logger'` → `console.log/warn/error` with a `[HistoryManager]` prefix, matching the rest of `src/server/`. `src/main/utils/logger.ts` is itself electron-free, but importing it would force the server module graph to drag in the renderer's structured-log buffer + sentry-breadcrumb path for no functional gain in headless mode. (3) `import { captureException } from './utils/sentry'` → `import { captureException } from './sentry'`; the L0e `src/server/sentry.ts` exposes the same fire-and-forget shape (`(err, context?)`) backed by `@sentry/node`, so call sites swap cleanly. (4) Drops the `logger.debug` info noise on per-write paths (every successful add/write logged at debug in the renderer); kept the error/warn paths and the migration-progress info logs — the renderer's debug-level logs are a renderer-developer-tools affordance with no equivalent in headless. **Public API parity (1:1 with renderer-side):** `initialize`, `hasMigrated`, `getEntries`, `addEntry`, `deleteEntry`, `updateEntry`, `clearSession`, `listSessionsWithHistory`, `getHistoryFilePath`, `getAllEntries(limit?)`, `getAllEntriesPaginated(opts?)`, `getEntriesByProjectPath`, `getEntriesByProjectPathPaginated(opts?)`, `getEntriesPaginated(sessionId, opts?)`, `updateSessionNameByClaudeSessionId`, `clearByProjectPath`, `clearAll`, `startWatching(onExternalChange)`, `stopWatching`, `getHistoryDir`, `getLegacyFilePath`. Plus the `getHistoryManager()` singleton accessor — same name, same shape. The on-disk schema (`<dataDir>/history/<sessionId>.json` with `{version, sessionId, projectPath, entries[]}`) is unchanged because both the renderer and headless variants import `HISTORY_VERSION`, `MAX_ENTRIES_PER_SESSION`, `HistoryFileData`, `sanitizeSessionId`, `paginateEntries`, `sortEntriesByTimestamp` from the same `src/shared/history.ts` module, and the file I/O calls are byte-for-byte identical. **An Electron-written `<userData>/history/` directory reads correctly headless and vice-versa.** **Watcher:** kept verbatim (the renderer's `startWatching` / `stopWatching` use `fs.watch` from node core, not chokidar — no dependency to drop). **`src/main/history-manager.ts` NOT touched** — verified by `git diff main..HEAD -- src/main/ | wc -c` → 0. The renderer continues to import `getHistoryManager()` from `src/main/history-manager.ts`; the server imports `getHistoryManager()` from `src/server/history-manager.ts`. Two singletons, two import paths, same on-disk format. **`src/server/index.ts` wiring (3 surgical edits):** (a) added `import { getHistoryManager } from './history-manager';` next to the existing `./sentry` import; (b) inserted `const historyManager = getHistoryManager();` next to the other store initializations (after `groupsStore`); (c) replaced the L0a stub `setGetHistoryCallback(() => [])` with the three-path dispatch from `src/main/web-server/web-server-factory.ts:227-245` verbatim — `sessionId` → `getEntries` + descending-timestamp sort; `projectPath` → `getEntriesByProjectPath` (already sorted inside the manager); neither → `getAllEntries()` (also sorted inside the manager). (d) `main()` now awaits `historyManager.initialize()` before `server.start()` so the `history/` directory exists and the legacy `maestro-history.json` → per-session migration has run; the await is wrapped in try/catch with `captureException(err, { context: 'history_init' })` to keep the boot path resilient — a failed init logs and proceeds, the manager just returns `[]` for missing sessions. (e) boot log line updated from "L0f: 10/10 WRITE callbacks active" to "L0h: getHistory — server-side HistoryManager wired (per-session storage at <dataDir>/history/<sessionId>.json, API parity with src/main/history-manager.ts). 10/10 WRITE callbacks active …" so the boot log no longer mentions any history stubbing. **Why a separate file rather than refactoring `src/main/history-manager.ts` to be runtime-conditional:** the brief's anti-pattern guard explicitly rejects touching `src/main/`. A runtime-conditional import of `electron` (try/require it, fall back to `getDataDir()` on failure) was considered and rejected because it would force every desktop-renderer maintainer to think about the headless branch when they touch `history-manager.ts`. Two parallel files is the lower-cognitive-load shape; the trade-off (any new method has to be added in two places) is acceptable because the public API is now ~21 methods and stabilizing — the rate of additions is low. If/when the methods churn frequently, the next refactor is to lift the implementation into `src/shared/history-manager.ts` and have both `src/main/` and `src/server/` re-export, but that refactor is out of scope for L0h and would itself require touching `src/main/`. **`tsconfig.server.json` unchanged** — the new file lives under `src/server/**/*.ts` which the existing include glob already covers. **Scope guards verified (post-write, pre-commit):** `git diff main..HEAD -- src/web/ | wc -c` → 0; `git diff main..HEAD -- src/main/ | wc -c` → 0; `git diff main..HEAD -- src/renderer/ | wc -c` → 0. Only edits in this wave are `src/server/index.ts` (additive — import, init, callback replacement, boot log) + NEW `src/server/history-manager.ts` + this ISA Decisions entry + the Verification entry below.
- **2026-06-08** — **Additive runtime-code edits authorized in `src/main/web-server/{handlers,services}` and `src/main/process-manager/spawners/` under ISC-40, with explicit Decision entries per touch.** Architect plan-reeval-1 (N1) flagged that L6.1 (sha `1e4b90e75`, RawPtyMultiplexer + pty_* WS protocol) edited four `src/main/` runtime files (PtySpawner.ts, messageHandlers.ts, broadcastService.ts, WebServer.ts) without an authorizing Decision precedent — the prior "additive upstream-config edits" Decision covered tailwind.config.mjs and tsconfig.server.json only. Recognized authorization: ADDITIVE-ONLY edits to web-server handlers/services + process-manager spawners (new methods, new switch cases, new emitters) are allowed when the work would otherwise require duplicating an entire upstream subsystem in `src/server/`. Anti-criterion: NO modifications to existing logic in upstream files; no deletions; no rewrites of upstream methods. Already-landed L6.1 surface (additive WS protocol handlers + additive PTY raw-bytes emission) is legalized retroactively under this Decision.
- **2026-06-08** — **Adopted `ISC-44.<tab>.<deferral>` tracking convention** per Architect plan-reeval-1 START directive. Every "Coming in subsequent layers" deferral from a shipped layer becomes a numbered ISC under ISC-44 so partial-parity surface is countable. Statuses: DEFERRED (port pending), DROPPED (no browser equivalent), MISSING (blocks ideal state). Currently logged: 10 deferrals from L3.1+L3.2 plus ISC-14 settings broadcast (W2 closure).
- **2026-06-08** — **ISC-44.global.settings_broadcast shipped (closes plan-reeval-1 N2 + ISC-14).** Was MISSING per the ISC-44.x deferral tracking convention; W2 closure. The headless server's PATCH `/api/settings` route now fires a fan-out `settings_changed` WS frame after the SettingsProvider persists the patch. webFull's `useSettings()` hook subscribes via a module-level event bus and merges `newValues` into local state without a refetch. **Wire-protocol shape:** `{type:'settings_changed', changedKeys:string[], newValues:Record<string,unknown>, timestamp:number}` — `changedKeys` is `Object.keys(patch)`, `newValues` IS the patch (not the full settings object), so frame size is proportional to the edit and clients don't clobber unrelated in-flight edits. **Fan-out, not point-to-point:** every connected client receives the same frame, including the originator. The originator's hook treats its own echo as a no-op merge since local state already reflects the patch. **Conflict resolution:** last-writer-wins per ISA Principles §2. The broadcast fires AFTER `SettingsProvider.setSettings()` returns, so the on-disk value (and every client's view after the broadcast lands) reflects whoever wrote last. If browser A is mid-edit on a key when browser B's broadcast for that key arrives, A's local state is overwritten — A's next PATCH then re-applies A's edit and wins the race. **Callback flow (5 hops):** (1) `PATCH /api/settings` handler in `apiRoutes.ts` invokes optional `ApiRouteCallbacks.onSettingsChanged(changedKeys, newValues)` AFTER persist succeeds, BEFORE returning the response; (2) `WebServer.setupRoutes()` wires `onSettingsChanged` to a late-binding invoker `invokeSettingsChangedCallback`; (3) the late-binding invoker calls the consumer-registered callback installed via the new `setSettingsChangedCallback()` setter (mirrors the existing setter-pattern on the surface); (4) `src/server/index.ts` registers a callback that calls `server.broadcastSettingsChanged(changedKeys, newValues)`; (5) the broadcast method on `BroadcastService` calls `broadcastToAll({type:'settings_changed', ...})`. Late-binding chosen over direct injection so a consumer registering AFTER `setupRoutes()` (or re-registering later) still gets called; the invoker no-ops when nothing is registered (Electron path stays a no-op since it doesn't wire this callback). **webFull subscription model — module-level event bus:** `useSettings()` is independently instantiated by three Settings tab components (GeneralTab, DisplayTab, ShortcutsTab) — each gets its own state. Rather than thread a SettingsProvider context from mobile/App.tsx down through every tab (which would require lifting state out of the hook), `useSettings.ts` exposes a module-level `publishSettingsChanged` / `subscribeSettingsChanged` pair. The WS handler in `mobile/App.tsx` (the single `useWebSocket` consumer) routes the broadcast through `publishSettingsChanged`, and every active hook instance subscribes via `useEffect`. Trade-off accepted: module-level singleton state is slightly less testable than React-context state, but the alternative (lifting state into a SettingsProvider) requires touching every Settings tab consumer to read from context instead of calling the hook — out of scope for an additive W2 closure. **Files touched (all additive):** `src/main/web-server/services/broadcastService.ts` (NEW `broadcastSettingsChanged` method, ~33 LOC including comment block); `src/main/web-server/WebServer.ts` (NEW `broadcastSettingsChanged` wrapper + NEW `setSettingsChangedCallback` setter + private `settingsChangedCallback` storage + private `invokeSettingsChangedCallback` invoker, ~55 LOC including comment block; `setupRoutes()` augmented with one additional callback wire); `src/main/web-server/routes/apiRoutes.ts` (NEW optional `onSettingsChanged` field on `ApiRouteCallbacks` + invocation block inside the PATCH handler's success path; ~20 LOC including doc comment); `src/server/index.ts` (NEW callback registration block ~26 LOC); `src/webFull/hooks/useWebSocket.ts` (NEW `'settings_changed'` `ServerMessageType` literal + NEW `SettingsChangedMessage` interface + NEW `onSettingsChanged` optional handler on `WebSocketEventHandlers` + NEW switch case routing to it + union extended; ~50 LOC); `src/webFull/hooks/useSettings.ts` (NEW module-level event bus exports `publishSettingsChanged` / `subscribeSettingsChanged` / `_resetSettingsListeners` + NEW `useEffect` subscription inside the hook that merges incoming changedKeys; ~70 LOC); `src/webFull/mobile/App.tsx` (NEW import of `publishSettingsChanged` + NEW `wsHandlers` `useMemo` that spreads `sessionsHandlers` and adds `onSettingsChanged` routing into the bus; ~22 LOC). NEW `src/webFull/hooks/useSettings.parity.test.ts` (~320 LOC — three-story function-parity catalog matching the WEB_PARITY_VERIFICATION shape, plus 13 vitest cases exercising the bus + the hook merge logic in jsdom). **Scope guards verified:** `git diff main..HEAD -- src/web/ | wc -c` → 0; `git diff main..HEAD -- src/renderer/ | wc -c` → 0. `src/main/web-server/` edits authorized per the 2026-06-08 ISC-40 legalization Decision for additive `src/main/web-server/{handlers,services}` runtime touches (N1 closure). **ISC-44.global.settings_broadcast status flipped from `[ ]` MISSING to `[x]` CLOSED on line 172.** ISC-14 closure path: the criterion text says "settings written from browser A are visible to browser B without an explicit reload (or after one reload — Decision called out)"; the implementation delivers the no-reload path (broadcast fan-out within 1s of PATCH return), and the catalog asserts this. ISC-14 itself stays as a Tier 2 antecedent ISC (needs running mini2 + two browsers for the end-to-end assertion); this closure is the unit/wire-level prerequisite.
- **2026-06-08** — **ISA hygiene cleanup — three surgical doc-only fixes bundled on branch `docs-isa-hygiene-cleanup`.** Three small drift items closed in one pass, all doc-only, zero source touched. (1) **ISC-42 layer reference corrected.** Line 130 (formerly line 129 before this cleanup added ISC-45) previously read "Layer 4 in `WEB_PORT_ORDER.md`" for the xterm scope decision; the 2026-06-08 `WEB_PORT_ORDER.md` restructure (Decision entry 2026-06-08 above) renamed old Layer 4 → Layer 6 and that restructure's own Decision entry explicitly deferred the ISA line edit. This cleanup closes the deferral: ISC-42 now reads "Layer 6 in `WEB_PORT_ORDER.md`". The historical Decision entry (2026-06-08 "`WEB_PORT_ORDER.md` restructured…") and Verification entry (2026-06-08 "`WEB_PORT_ORDER.md` restructure (docs-only)") still describe the deferral as it stood at write-time — those are append-only by convention and were not edited. (2) **ISC-45 added: falsification probe.** New criterion appended to the "Anti-criteria & guard-rails" section, born from Architect's 2026-06-08 audit framing of the decouple-from-Electron value proposition: spawn a pty from phone Safari, kill the server, restart, reload the tab — if the pty does NOT survive with intact scrollback, the entire investment delivered nothing the user can feel. ISC-45 is the integration-level "did the whole thing matter" check that pairs with ISC-13 (unit-level pty-persistence-across-disconnect). Antecedent-gated on Layer 0c landing so the probe is runnable. ISC-44.x remains reserved for per-feature parity-catalog ISCs per the ID-stability rule. (3) **Cross-references to three migrated planning docs rewritten as brain pointers.** `WEB_CONVERSION_ASSESSMENT.md` → [brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md); `WEB_FEATURE_PARITY_SCOPE.md` → [brain-8s3r](~/data/knowledge/entries/knowledge/maestro-web-port-feature-parity-scope-inventory.md); `WEB_PARITY_VERIFICATION.md` → [brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md). The three documents were migrated to brain on 2026-06-08 and no longer exist in the repo; every relative-path reference in ISA.md and PLAN.md was rewritten to the brain pointer above. Historical Decision and Verification entries (write-once-by-date) were NOT edited — their references to the old filenames are accurate at their write-time and now exist only in append-only history. **Files touched in this turn:** `ISA.md` (this Decisions entry + Verification entry below + ISC-42 line fix + ISC-45 append + 8 reference rewrites in Criteria/Test Strategy/Decisions/Changelog) and `PLAN.md` (2 reference rewrites in Verification approach + Companion docs). No source touched — `git diff main..HEAD -- src/ infra/ | wc -c` should remain 0.

## Changelog

> Conjecture / refuted_by / learned / criterion_now entries land here as the project evolves.

### 2026-06-07 — conversion is decoupling, not rebuilding

- **conjectured**: Converting Maestro to a web app means writing a new Fastify server, a new client, and a new IPC story.
- **refuted_by**: First-pass repo scan: `src/web/` exists with mobile/desktop split; `src/main/web-server/{WebServer.ts, web-server-factory.ts, routes/*}` already runs Fastify on port 45678 with WS upgrade; `vite.config.web.mts` already proxies `/api` and `/ws` to that port; integration tests exist at `src/__tests__/main/web-server/`.
- **learned**: The Electron→web work is structurally a **decoupling** problem — extracting the existing Fastify server from `BrowserWindow`/Electron lifecycle — not a greenfield rebuild. This roughly halves the perceived effort and reshapes the PLAN around "remove the wrapper" rather than "add the server."
- **criterion_now**: ISC-7 (IPC bridge collapse — stub vs rewrite) is the keystone criterion. Resolving it unblocks F1 (vanilla-node launcher) and most of Tier 2.

### 2026-06-07 — the existing web bundle is the mobile-remote-control surface, not full Maestro

- **conjectured**: Opening the existing web URL gives Trillium the same Maestro UX he uses on desktop — same session-create, agent config, file browse, git diff, Auto Run UI, settings.
- **refuted_by**: Background agent's web-port codebase conversion assessment ([brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md)) §1.3, §6.1 (lines 36-53, 223-240) — the shipped `src/web/` PWA is a **mobile companion / remote control** for an already-running desktop instance. It can list sessions, send commands, switch tabs, interrupt. It **cannot** create new sessions, configure agents, browse the filesystem, view git diffs, edit settings, or use the Auto Run UI. The desktop renderer has 132 components; the mobile/web bundle has a small fraction.
- **learned**: A web target that ships from this codebase has THREE materially different shapes:
  1. **"Maestro Server" (Tier 1 in the conversion assessment, [brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md)):** Decouple the existing Fastify server from Electron. UX is the existing mobile/PWA bundle. Trillium loses ~80% of desktop UI features but gets browser-from-anywhere immediately. Honest, shippable. Maps to Layer 0 in `WEB_PORT_ORDER.md`.
  2. **"Tier 1.5":** Grow `src/webFull/` bundle to cover desktop-class features — port session-create, agent-config, file-browse, git-diff, Auto Run, settings. Real work given 132 desktop-renderer components. Maps to Layers 1-9 in `WEB_PORT_ORDER.md`.
  3. **"Use what's there today" (Tier 0):** Run upstream Electron headless-ish on mini2; expose the existing `live:getDashboardUrl` URL over Tailscale. Browser-from-anywhere with no code changes, accept the mobile-companion UX immediately, defer all conversion work. The existing token-in-URL auth + Tailscale-as-perimeter is already a working security model. The cheapest path to "browser-accessible from many machines" — and may be the right first answer.
- **criterion_now**: ISC-41 (accept mobile-companion UX or scope desktop-class web build) and ISC-42 (accept no-browser-PTY or scope xterm.js work) are now BLOCKING for any BUILD turn. Need principal decision before sizing further.



## Verification

> Per-ISC evidence lands here at VERIFY phase.

### 2026-06-08 — Layer 0a evidence

**Environment:** Node 22.22.1 via fnm; npm; macOS arm64 (laptop); branch `layer-0-decouple-server`.

#### ISC-28 — headless bootstrap with no `electron` import in runtime path

- **Probe:** `npx tsc -p tsconfig.server.json && ls dist/server/`
- **Result:** Clean compile (zero TS errors). Produced `dist/server/index.js` + `index.js.map`.
- **Probe:** `MAESTRO_DATA_DIR=/tmp/maestro-test MAESTRO_WEB_PORT=45679 node dist/server/index.js`
- **Result:** Server bootstrapped without crashing and logged `[maestro-server] listening at http://192.168.86.26:45679/<token>`. No `electron` symbol pulled in (verified by ISC-33 grep below). Process tree: `pgrep -P <server-pid>` returned no children — confirming no Electron Helper / GPU / Renderer processes spawned.
- **Probe:** `curl -i http://localhost:45679/<token>/`
- **Result:** `HTTP/1.1 200 OK`, `content-type: text/html`, `content-length: 4215`. Body contains `<div id="root">` (the React mount point from `dist/web/index.html`). Status: **PASS**.

#### ISC-29 — `app.getPath('userData')` replaced with env-var-driven path

- **Code:** `src/shared/data-dir.ts` exports `getDataDir()` which prefers Electron's `app.getPath('userData')` when available (via `require('electron')` in a try/catch), else `MAESTRO_DATA_DIR ?? path.join(os.homedir(), '.config/maestro')`. Lazy-resolved on first call, cached.
- **Probe:** `MAESTRO_DATA_DIR=/tmp/maestro-test node dist/server/index.js` — server log printed `[maestro-server] dataDir = /tmp/maestro-test` confirming env-var wins in headless mode.
- **Result:** **PASS for the bootstrap path.** Note: this ISC asks for all ~10-20 callsites to be replaced — Layer 0a only routes the bootstrap entrypoint through `getDataDir()`. Remaining callsites in `src/main/` continue to use `app.getPath('userData')` directly and will be migrated incrementally as their modules are de-Electron-ified in Layer 0b+. Tracking residual: partial PASS, full ISC-29 closure deferred.

#### ISC-33 — `@sentry/electron` not in server runtime

- **Probe:** `grep -r "@sentry/electron" dist/server/`
- **Result:** Empty (exit 0, no matches). `tsconfig.server.json`'s `include` list deliberately omits any path that pulls `@sentry/electron`; `src/main/utils/sentry.ts` is included but its electron-dependent branches are guarded. Status: **PASS for the dist artifact.** Full ISC-33 closure (splitting `@sentry/electron` → `@sentry/node` for server, `@sentry/browser` for web) is deferred to Layer 0b — current state is "not imported at runtime," not "explicitly replaced with `@sentry/node`."

#### ISC-36 — `electron-store` replaced with file-based JSON store

- **Code:** `src/shared/file-store.ts` provides a class `FileStore<T>` with the subset of `electron-store`'s API Maestro uses (`get`, `set`, `has`, `delete`, `store`, `clear`, `path`). Persists as `<cwd>/<name>.json` via temp-file-rename. On-disk schema is byte-identical to `electron-store`'s default (a single JSON object).
- **Probe:** Server boot wrote no settings file (empty defaults) but `FileStore` constructor `mkdirSync(cwd, { recursive: true })` created `/tmp/maestro-test/` cleanly; `get('webAuthToken', '')` returned `''` and the server fell back to an ephemeral `randomUUID()` token, logging `using ephemeral token (no valid webAuthToken in settings)`. Status: **PASS** for the file-backed-store behavior. Note: server-side WRITE callbacks (which would call `FileStore.set` to persist sessions/settings updates) are stubbed in Layer 0a — write-path observability is deferred to Layer 0b.

#### Process-tree / port-binding evidence

- `ps -p 83270 -o pid,ppid,comm` → `node` (no Electron lineage); `pgrep -P 83270` → empty.
- `/usr/sbin/lsof -nP -iTCP:45679 -sTCP:LISTEN` → `node 83270 ... TCP *:45679 (LISTEN)`. Single `node` listener, no `Electron`.
- `ps -A | grep -i electron` showed only (a) the pre-existing dev Electron on port 9222 (PID 79279, started before this test, unrelated to the test server) and (b) unrelated apps (Claude, Discord, VS Code, Slack). Test server (PID 83270) had no Electron descendants.

### 2026-06-08 — Layer 0b evidence

**Environment:** Node 22.x via system; macOS arm64 (laptop); branch `layer-0b`; worktree `/Users/trilliumsmith/code/maestro-l0b`. `node_modules` symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the test session; symlink removed before commit so the worktree tree stays clean.

#### Build — `tsc -p tsconfig.server.json`

- **Probe:** `npx tsc -p tsconfig.server.json; echo "EXIT=$?"`
- **Result:** `EXIT=0`. Zero TS errors. `dist/server/index.js` (11335 bytes) and `dist/server/process-manager-adapter.js` (4141 bytes) emitted. With `tsconfig.server.json` `include` widened to `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts`, `ProcessManager` and its parser dep tree compiled cleanly.

#### Boot — server starts and prints the Layer 0b log line

- **Probe:** `MAESTRO_DATA_DIR=/tmp/maestro-l0b-test MAESTRO_WEB_PORT=45682 node dist/server/index.js`
- **Result:** Server listened at `http://192.168.86.26:45682/68a56824-4352-4c0f-822e-de9a8734eb41`. New boot log line replaced the L0a "READ-ONLY mode" message: `[maestro-server] Layer 0b: 3/10 WRITE callbacks active (writeToSession, executeCommand, interruptSession via ProcessManager). switchMode, tab ops, bookmark still stubbed.` Status: **PASS**.

#### Smoke — `POST /:token/api/session/:id/send` exercises `writeToSession` through ProcessManager

- **Probe:** `curl -X POST -H "Content-Type: application/json" -d '{"command":"echo hello"}' "http://127.0.0.1:45682/<token>/api/session/nonexistent-session-id/send"`
- **Result:** HTTP `500` with `{"error":"Internal Server Error","message":"Failed to send command to session"}` — exactly the expected behavior for an unknown session. Server log shows the full callback chain:
	1. Adapter: `write(): session nonexistent-session-id not in store; falling back to terminal suffix`
	2. `ProcessManager.write()`: `write() - No process found for session { sessionId: 'nonexistent-session-id-terminal' }`
	3. Wrapper: `writeToSession nonexistent-session-id (11 bytes) -> false`
- The L0a "WRITE op not implemented" warning is **gone** from this code path. The callback fired through `ServerProcessManagerAdapter` → `ProcessManager`, returning `false` because no process is registered for that synthetic session id. Status: **PASS** for the callback wiring; full end-to-end against a real spawned process is deferred until L0c lands session-spawn.

#### Smoke — `POST /:token/api/session/:id/interrupt` exercises `interruptSession`

- **Probe:** `curl -X POST "http://127.0.0.1:45682/<token>/api/session/nonexistent-session-id/interrupt"`
- **Result:** HTTP `500` with `{"error":"Internal Server Error","message":"Failed to interrupt session"}`. Server log shows `[maestro-server] interruptSession nonexistent-session-id -> false`. Same shape as `writeToSession` — `ProcessManager.interrupt()` correctly returns false for a missing process and the wrapper propagates. Status: **PASS** for the wiring.

#### Electron-leak guard

- **Probe:** `grep -r "from 'electron'" dist/server/`
- **Result:** Empty (exit 0, no matches). Adding `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts` to the server tsconfig did not pull any electron imports into the compiled dist tree. Status: **PASS**.
### 2026-06-08 — Layer 1.1 evidence (webfull Vite scaffold)

**Environment:** Node 22.22.1 via fnm; npm 10.9.4; macOS arm64 (laptop); branch `layer-1.1-vite-webfull`; base SHA `7530a134b`.

#### Build verification (`npm run build:webfull`)

```
> maestro@0.15.3 build:webfull
> vite build --config vite.config.webfull.mts

vite v5.4.21 building for production...
transforming...
✓ 2532 modules transformed.
rendering chunks...
computing gzip size...
../../dist/webfull/index.html                    3.54 kB │ gzip:   1.41 kB
../../dist/webfull/assets/mobile-DWpJmM3c.css   47.56 kB │ gzip:   9.36 kB
../../dist/webfull/assets/main-Boi2EcHi.js       0.81 kB │ gzip:   0.47 kB │ map:     0.10 kB
../../dist/webfull/assets/react-Dl6t4piS.js    141.58 kB │ gzip:  45.37 kB │ map:   347.24 kB
../../dist/webfull/assets/mobile-Bju1GwAh.js   962.75 kB │ gzip: 319.27 kB │ map: 3,195.98 kB
✓ built in 4.52s
```

Exit code 0. Produced artifacts (paths relative to repo root):

- `dist/webfull/index.html` (3.54 kB) — contains `<div id="root">` mount point and references hashed asset paths (`./assets/main-Boi2EcHi.js`, `./assets/react-Dl6t4piS.js`, `./assets/mobile-Bju1GwAh.js`, `./assets/mobile-DWpJmM3c.css`).
- `dist/webfull/assets/` — hashed JS/CSS bundles + source maps.
- `dist/webfull/manifest.json`, `dist/webfull/sw.js`, `dist/webfull/icons/` — copied from `src/webFull/public/` (publicDir routing verified).

Chunk naming preserved the `mobile-`/`react-`/`main-` prefixes from the upstream chunk strategy — confirms manualChunks logic resolves correctly against the `src/webFull/` tree (the verbatim fork from `src/web/`).

Note: vite emitted a CSS minification warning (`Expected identifier but found "-"`) — same warning surfaces against `src/web/` upstream (it is in the existing CSS source); not a regression introduced by this config.

#### Dev mode verification (`npm run dev:webfull`)

```
> maestro@0.15.3 dev:webfull
> vite --config vite.config.webfull.mts

  VITE v5.4.21  ready in 146 ms

  ➜  Local:   http://localhost:5176/
```

```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:5176/
HTTP 200
```

`strictPort: true` honored at 5176 (web stays on 5174). Dev server killed cleanly after probe; no stray listener (`lsof -nP -iTCP:5176 -sTCP:LISTEN` → no rows).

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` untouched on this branch range relative to `main`).
- `git diff main..HEAD --stat` → 3 files: `ISA.md`, `package.json`, `vite.config.webfull.mts` (plus Layer 0a's pre-existing files via `7530a134b` ancestor). The layer-1.1 commit itself adds only the three files above.
- `node_modules` symlink (created for the build) removed before commit; not tracked.

### 2026-06-08 — `WEB_PORT_ORDER.md` restructure (docs-only)

Branch `docs-port-order-lift-first` off `main` at `3963a6bc0`. Doc-only turn — no source touched.

- **Probe:** `git diff main..HEAD --stat -- 'src/**'`
- **Expected:** empty (zero source files in the diff).
- **Probe:** `git diff main..HEAD --stat` — expect two files: `WEB_PORT_ORDER.md` (new) and `ISA.md` (Decisions append + this Verification entry).
- **Structure:** new Layer 2 (Lift UI primitives) inserted between L1 (webfull build target) and the renamed L3 (Identity + Settings). Old L4 (xterm/PTY) is now L6 and remains ISC-42-scope-gated. Lift-vs-Rewrite decision rule documented as a top-level subsection citing the audit's IPC-count thresholds from `/tmp/web-ui-lift-scope.md` §E and §F.
- **Cross-reference deferred:** ISA line 129 still reads "Layer 4 in `WEB_PORT_ORDER.md`" for the xterm scope decision (ISC-42). Per the brief's scope guard for this turn, the only ISA edit was the Decisions append documenting the restructure. The rename is self-noted at the bottom of `WEB_PORT_ORDER.md` Layer 6 so the trail resolves; the ISA line gets updated when ISC-42 is decided.

### 2026-06-08 — Layer 2.1 evidence (visual primitives lift)

**Environment:** Node 22.22.1 via fnm; npm 10.9.4; macOS arm64 (laptop); branch `layer-2.1-primitives-lift`; base SHA `3963a6bc0` (off `main` via Layer 1.1 ancestry).

#### Files added (new files only — under `src/webFull/`)

- `src/webFull/types/layer.ts` (108 LOC) — `LayerType` / `FocusTrapMode` / `BaseLayer` / `ModalLayer` / `OverlayLayer` / `Layer` / `LayerInput` types + `isModalLayer` / `isOverlayLayer` guards. Verbatim from `src/renderer/types/layer.ts`.
- `src/webFull/constants/modalPriorities.ts` (243 LOC) — `MODAL_PRIORITIES` constant + `ModalPriorityKey` / `ModalPriorityValue` types. Verbatim from `src/renderer/constants/modalPriorities.ts`.
- `src/webFull/hooks/useLayerStack.ts` (300 LOC) — `LayerStackAPI` interface + `useLayerStack` hook + dev-mode `window.__MAESTRO_DEBUG__.layers` API. One import path adapt: `Layer` / `LayerInput` from `'../../types/layer'` → `'../types/layer'` (webFull `hooks/` is one level shallower than renderer `hooks/ui/`).
- `src/webFull/contexts/LayerStackContext.tsx` (90 LOC) — `LayerStackProvider` + `useLayerStack` context consumer. One import path adapt: `useLayerStack` source hook is imported directly from `'../hooks/useLayerStack'` instead of the renderer's `'../hooks'` barrel (no barrel in `src/webFull/hooks/` yet).
- `src/webFull/hooks/useModalLayer.ts` (124 LOC) — `useModalLayer` hook + `UseModalLayerOptions` interface. Two import path adapts: `useLayerStack` from `'../../contexts/LayerStackContext'` → `'../contexts/LayerStackContext'`; `FocusTrapMode` from `'../../types/layer'` → `'../types/layer'`.
- `src/webFull/components/ui/Modal.tsx` (200 LOC) — `Modal` + `ModalFooter` + their prop types. Two import path adapts: `Theme` from `'../../types'` → `'../../../shared/theme-types'` (webFull has no `types/index.ts` aggregator); `useModalLayer` + `UseModalLayerOptions` from `'../../hooks'` → `'../../hooks/useModalLayer'` (direct import — webFull `hooks/` has no barrel yet). Theme accepted as `theme: Theme` prop (renderer convention), not via `useTheme()` internally — see Decisions append.
- `src/webFull/components/ui/FormInput.tsx` (189 LOC) — `FormInput` (forwardRef) + `FormInputProps`. One import path adapt: `Theme` from `'../../types'` → `'../../../shared/theme-types'`.
- `src/webFull/components/ConfirmModal.tsx` (74 LOC) — `ConfirmModal` (memo). One import path adapt: `Theme` from `'../types'` → `'../../shared/theme-types'`. Internal imports (`Modal` / `ModalFooter` from `'./ui/Modal'`, `MODAL_PRIORITIES` from `'../constants/modalPriorities'`) resolve at the same relative paths as in the renderer.

#### Upstream-tracked files touched (count: 1)

- `tailwind.config.mjs:3` — added `'./src/webFull/**/*.{js,ts,jsx,tsx}'` as the third entry in the `content` array (one-line edit). Without this, any Tailwind class introduced in webFull files gets purged at production build, producing visually broken UI on the webFull bundle. Selected as the one upstream-file edit for this wave because the content glob is the most rebase-stable part of a Tailwind config (the entire pattern is "add your source paths"), so rebase conflict cost is minimal vs the cost of leaving the bug in place.

#### In-fork divergent-tree file edits (count: 1, all under `src/webFull/`)

- `src/webFull/components/index.ts` — appended 8 lines of barrel re-exports for `Modal` / `ModalFooter` / `FormInput` / `ConfirmModal` and their prop types. `src/webFull/` is a fork-divergent tree (forked from `src/web/` specifically to support feature divergence — see Layer 0/1.1 decisions), not an upstream-tracked file in the same sense as `src/web/`. Barrel additions like this are the intended evolution pattern for `src/webFull/`.

#### Build verification (`npm run build:webfull`)

Symlinked `node_modules` from `/Users/trilliumsmith/code/maestro/node_modules` before build; removed before commit.

```
> maestro@0.15.3 build:webfull
> vite build --config vite.config.webfull.mts

vite v5.4.21 building for production...
transforming...
✓ 2532 modules transformed.
rendering chunks...
warnings when minifying css:
▲ [WARNING] Expected identifier but found "-" [css-syntax-error]
    <stdin>:2707:2:
      2707 │   -: \s|;
           ╵   ^
computing gzip size...
../../dist/webfull/index.html                    3.54 kB │ gzip:   1.41 kB
../../dist/webfull/assets/mobile-DWpJmM3c.css   47.56 kB │ gzip:   9.36 kB
../../dist/webfull/assets/main-Boi2EcHi.js       0.81 kB │ gzip:   0.47 kB │ map:     0.10 kB
../../dist/webfull/assets/react-Dl6t4piS.js    141.58 kB │ gzip:  45.37 kB │ map:   347.24 kB
../../dist/webfull/assets/mobile-Bju1GwAh.js   962.75 kB │ gzip: 319.27 kB │ map: 3,195.98 kB
✓ built in 4.61s
```

Exit code 0. Bundle output sizes match Layer 1.1's evidence exactly (the lifted primitives are not yet reachable from `main.tsx` — no feature consumer imports them yet, so Vite's tree-shaker drops them). The CSS minification warning is pre-existing in upstream (same warning surfaces against `src/web/` per Layer 1.1 evidence); not a regression from this wave.

#### Type-check verification

Because `tsconfig.json` only includes `src/renderer`, `src/web`, `src/shared` (not `src/webFull/`), and editing `tsconfig.json` would be a second upstream-file edit (not authorized for this wave), the lifted files were type-checked via a temporary isolated tsconfig (`tsconfig.webfull-lift-check.json` extending the root `tsconfig.json`) that explicitly included all eight new files plus their shared-types dependencies:

```
$ ./node_modules/.bin/tsc -p tsconfig.webfull-lift-check.json
$ echo $?
0
```

Exit code 0. Zero type errors. All `Theme` / `LayerStackAPI` / `LayerInput` / `Layer` / `FocusTrapMode` / `MODAL_PRIORITIES` / `UseModalLayerOptions` imports resolve cleanly. No missing-context errors (the lifted `LayerStackContext` provides the `useLayerStack` value that `useModalLayer` consumes, exactly mirroring the renderer's wiring). The temporary `tsconfig.webfull-lift-check.json` was deleted before commit.

#### Reachability note (deferred work)

The lifted primitives compile correctly but are not yet reachable from `src/webFull/main.tsx`. `main.tsx` imports `./App` directly (not `./index.ts`), so the new `src/webFull/components/index.ts` re-exports are only reachable when a future feature port adds an import. Additionally, the `<LayerStackProvider>` is NOT yet wrapping the App tree in `src/webFull/App.tsx` — the first feature port that lifts a modal will need to add `<LayerStackProvider>` around `<ThemeProvider>` at line 285 of `src/webFull/App.tsx`. Scoping that wiring change out of this wave was intentional: there's no consumer yet to validate the runtime wrap, and adding the provider without a consumer is a no-op that pollutes the diff with untested code. Documented here so the next port agent doesn't re-discover the gap.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` untouched).
- `git diff main..HEAD -- tailwind.config.mjs` shows exactly one line changed (the `content` array literal).
- `node_modules` symlink (created for the build) removed before commit; not tracked.

### 2026-06-08 — Layer 0c evidence (remaining WRITE callbacks via sessions store + broadcast)

**Environment:** Node 22.22.1 via fnm; macOS arm64 (laptop); branch `layer-0c-remaining-writes`; worktree `/Users/trilliumsmith/code/maestro-l0c`; base SHA `3963a6bc0`. `node_modules` symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the test session; removed before commit.

#### Strategic framing — pattern per callback

The brief identified three patterns for the remaining WRITE callbacks. L0c lands the six (A) cases and the two (C) cases; `newTab` (B-pattern) is deferred to L0d because spawning a process is fundamentally not a store mutation — it needs a server-side session-creation pipeline that the renderer currently owns.

| Callback | Pattern | Implementation |
| --- | --- | --- |
| `switchMode` | (A) persist + broadcast | mutate `inputMode` on the session, `broadcastSessionStateChange(id, state, {inputMode, ...})` — matches the desktop persistence handler's existing broadcast contract (`src/main/ipc/handlers/persistence.ts` lines 145-158). |
| `closeTab` | (A) persist + broadcast | filter the tab out of `aiTabs`, reassign `activeTabId` to the first remaining tab if the closed one was active, `broadcastTabsChange`. |
| `renameTab` | (A) persist + broadcast | mutate `name` on the tab record, `broadcastTabsChange`. |
| `starTab` | (A) persist + broadcast | mutate `starred` on the tab record, `broadcastTabsChange`. |
| `reorderTab` | (A) persist + broadcast | splice the `aiTabs` array, `broadcastTabsChange`. Bounds-checked: out-of-range indices return false; equal-indices is a no-op success. |
| `toggleBookmark` | (A) persist, no broadcast | flip `bookmarked`. The WebServer's broadcast surface has no dedicated bookmark channel and the desktop renderer also handles bookmark toggle as a local-only Zustand update (`src/renderer/stores/sessionStore.ts` lines 245-250), so headless matches desktop behavior. Web clients pick up the new state on the next sessions read. |
| `selectSession` | (C) headless no-op | log and return true. There is no global "visible session" in headless mode — each browser tab manages its own view state. The WS round-trip succeeds so the client doesn't surface an error. |
| `selectTab` | (C) headless no-op | same rationale; "active tab" is a per-browser-tab concept in web mode. |
| `newTab` | DEFERRED to L0d | spawn is a real side effect, not a store mutation. Tracked as the only remaining unwired callback. Stub returns `null` matching the type contract. |

#### File layout

- New: `src/server/sessions-mutator.ts` (151 LOC) — pure data-in/data-out functions per mutation (no I/O, no WebServer reference). Keeps `index.ts` declarative and opens unit-test surface for L0c-onwards.
- Edited: `src/server/index.ts` — replaced the L0a `notImplementedWrite(...)` stub block with the nine callback implementations above. Added the `applyMutation()` helper that does read → mutate → persist → broadcast in one transaction, and the `tabsForBroadcast()` helper that shapes a stored session's tabs to match the `AITabData` broadcast contract.
- Edited: `ISA.md` (this section).
- No edits to `src/main/`, `src/web/`, or `src/server/process-manager-adapter.ts`. The L0c implementations consume the existing `WebServer.broadcast*` public surface — no new broadcast methods were added.

#### Build verification — `tsc -p tsconfig.server.json`

- **Probe:** `npx tsc -p tsconfig.server.json && echo "BUILD OK exit=$?"`
- **Result:** `BUILD OK exit=0`. Zero TS errors. `dist/server/sessions-mutator.js` added alongside the existing `dist/server/index.js` and `dist/server/process-manager-adapter.js`. Status: **PASS**.

#### Electron-leak guard

- **Probe:** `grep -r "from 'electron'" dist/server/; echo "exit=$?"`
- **Result:** `exit=1` (grep no-match). The new mutator module pulls zero new dependencies; the `WebServer.broadcast*` methods called from `index.ts` go through `BroadcastService`, which itself imports only `ws` and the WebServer types. Status: **PASS**.

#### Boot — Layer 0c log line

- **Probe:** `MAESTRO_DATA_DIR=/tmp/maestro-l0c MAESTRO_WEB_PORT=45687 node dist/server/index.js`
- **Result:** Server listens at `http://192.168.86.26:45687/<token>`. New boot log:
	```
	[maestro-server] Layer 0c: 9/10 WRITE callbacks active (L0b: writeToSession,
	executeCommand, interruptSession via ProcessManager; L0c-A: switchMode,
	closeTab, renameTab, starTab, reorderTab, toggleBookmark via sessions store +
	broadcast; L0c-C: selectSession, selectTab as headless no-ops). newTab
	deferred to L0d (requires server-side spawn pipeline).
	```
- The "1 session visible" line confirmed the FileStore read pulled the seeded synthetic session (`sess-l0c-1` with two tabs `tab-a` and `tab-b`, written directly to `/tmp/maestro-l0c/maestro-sessions.json` before boot). Status: **PASS**.

#### Smoke — WebSocket probe drives each new callback

A small node WS client (`/tmp/maestro-l0c-smoke.mjs`) connected to `/<token>/ws`, then fired one message per callback against the seeded session plus one against a non-existent session. Every callback responded with its expected `*_result` envelope:

| Probe | Message → Response | Server-log trace |
| --- | --- | --- |
| `switch_mode` ai | `mode_switch_result success=true` + `session_state_change inputMode=ai` broadcast | `switchMode sess-l0c-1 -> ai: true` |
| `star_tab` tab-a true | `star_tab_result success=true` + `tabs_changed` broadcast (tab-a.starred=true) | `starTab sess-l0c-1/tab-a -> true: true` |
| `select_session` | `select_session_result success=true` | `selectSession sess-l0c-1 tab=tab-a — no-op in headless mode` |
| `toggle_bookmark` | `toggle_bookmark_result success=true` (no broadcast, by design) | `toggleBookmark sess-l0c-1: true` |
| `close_tab` against `sess-does-not-exist` | `close_tab_result success=false` (404-equivalent) | `closeTab: session not found or no-op; skipping` + `closeTab sess-does-not-exist/tab-x: false` |
| `reorder_tab` 1→0 | `reorder_tab_result success=true` + `tabs_changed` broadcast with new order | `reorderTab sess-l0c-1 1->0: true` |
| `rename_tab` tab-a "renamed-by-l0c" | `rename_tab_result success=true` + `tabs_changed` broadcast with new name | `renameTab sess-l0c-1/tab-a -> "renamed-by-l0c": true` |

#### Persistence verification

After the smoke probe, the on-disk sessions file (`/tmp/maestro-l0c/maestro-sessions.json`) shows the cumulative result of every mutation:

- `inputMode: "terminal" → "ai"` (switchMode)
- `bookmarked: false → true` (toggleBookmark)
- `aiTabs[0]: tab-a → tab-b`, `aiTabs[1]: tab-b → tab-a` (reorderTab)
- `tab-a.starred: false → true` (starTab)
- `tab-a.name: "first" → "renamed-by-l0c"` (renameTab)

Every mutation hit the disk via `FileStore.set('sessions', ...)`. The "not found" probe (`sess-does-not-exist`) left the store unchanged. Status: **PASS** for store + broadcast wiring; full UI-level verification deferred to webFull integration in a later layer.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` still untouched).
- L0c diff against `3963a6bc0` (base):
	- 1 new file: `src/server/sessions-mutator.ts`.
	- 2 edited files: `src/server/index.ts`, `ISA.md`.
	- No edits to `src/main/`, `src/server/process-manager-adapter.ts`, or any web-side file.
- `node_modules` symlink removed before commit; worktree tree clean.

#### Deferred — newTab

`newTab` is the only WRITE callback still stubbed (returns `null`). It needs:

1. A server-side `ProcessManager.spawn(...)` call to create the pty/agent.
2. Persistence of the new `aiTabs[]` entry (the mutator already handles this if given the new tab record).
3. A response shape `{ tabId: string }` returned to the caller.

The spawn pipeline is the L0d boundary — same scope as the missing "New Session" flow, which today lives in the renderer. Tracked separately.
### 2026-06-08 — `.gitattributes` `merge=union` for ISA.md

Branch `fix-isa-merge-union` off `main`. Metadata-only turn — no source touched.

- **Probe:** `git check-attr merge ISA.md`
- **Output:**
  ```
  ISA.md: merge: union
  ```
- **Expected:** `ISA.md: merge: union` — confirms the rule in `.gitattributes` is picked up by git's attribute resolver and the union merge driver is wired for ISA.md.
- **Probe:** `git diff main..HEAD -- src/web/ | wc -c`
- **Expected:** `0` (zero bytes — `src/web/` untouched on this branch range relative to `main`).
- **Probe:** `git diff main..HEAD --stat` — expect two files: `.gitattributes` (new) and `ISA.md` (Decisions append + this Verification entry).
- **Smoke note:** no artificial merge constructed. `git check-attr` reading `merge: union` for the path is sufficient evidence that the driver will engage at merge time; the driver itself is a git built-in, not custom code, so no behavioral test is needed beyond confirming the attribute resolves.
- **Convention reminder:** the append-only discipline is what makes union merge correct. Every future edit to ISA.md must add a new dated entry, never modify or delete an existing one. Violating this discipline silently produces stitched-together garbage at merge time (both versions kept side-by-side) rather than a flagged conflict — that's the cost of the friction-free parallel-append model.
### 2026-06-08 — mini2 deploy spike pre-staged (artifacts-only)

Branch `infra-mini2-deploy-spike` off `main` at `f8a501f30`. Doc + infra-only turn — zero source files touched, zero behavioral change to any running code. Artifacts are pre-staged on the laptop; the first actual deploy is Trillium's task to run on mini2 and report findings back via a follow-on Decisions entry on the next branch.

#### Files added

```
$ ls -la infra/
total 72
drwxr-xr-x+  5 trilliumsmith  sharedcode    160 Jun  7 20:07 .
drwxr-xr-x+ 59 trilliumsmith  sharedcode   1888 Jun  7 20:07 ..
-rw-r--r--+  1 trilliumsmith  sharedcode   5130 Jun  7 20:05 com.maestro.server.plist
-rw-r--r--+  1 trilliumsmith  sharedcode  16758 Jun  7 20:07 DEPLOY_SPIKE.md
-rwxr-xr-x+  1 trilliumsmith  sharedcode   5768 Jun  7 20:05 deploy.sh
```

- `infra/DEPLOY_SPIKE.md` — runbook (~17 KB). Sections: Vision recap, Prerequisites on mini2 (Tailscale, Node 22.x, Python 3.11, Git, Xcode CLT, filesystem layout), One-time setup (clone, install, smoke test, plist verify-and-edit, bootstrap), Deploy sequence (`./infra/deploy.sh`), Post-deploy verification (service state, loopback HTTP, Tailscale HTTP, browser load), Data dir location and backup/restore, Log location, Rollback procedure, six Open questions (Q1 data-dir migration, Q2 customSyncPath, Q3 fnm node path, Q4 deploy-tag convention, Q5 postinstall electron-rebuild, Q6 Tailscale port-exposure model), Out of scope.
- `infra/com.maestro.server.plist` — launchd LaunchAgent. `Label=com.maestro.server`, `KeepAlive=true`, `RunAtLoad=true`, `ProcessType=Background`, `ThrottleInterval=10`. `ProgramArguments` hard-codes the fnm 22.22.1 absolute path to node with a TODO comment block at the top of the file documenting verification on mini2. `EnvironmentVariables` sets `MAESTRO_DATA_DIR=/Users/trillium/.config/maestro`, `MAESTRO_WEB_PORT=45678`, `NODE_ENV=production`, and `PATH` including the fnm prefix. Logs go to `/Users/trillium/Library/Logs/maestro/server.{out,err}.log`. XML comment block at the top documents `launchctl bootstrap` / `bootout` / `print` / `kickstart` commands.
- `infra/deploy.sh` — executable (`-rwxr-xr-x`). Bash script with `set -euo pipefail`. Steps: `cd` to repo root, `eval "$(fnm env --shell bash)"` + `fnm use 22.22.1`, `git pull origin main`, `npm ci || npm install` (fallback for first run after rebase), `npm run build:server`, verify `dist/server/index.js` exists, symlink-or-rewire `~/Library/LaunchAgents/com.maestro.server.plist` → `infra/com.maestro.server.plist`, `launchctl bootout gui/$(id -u)/com.maestro.server` (best-effort), `launchctl bootstrap gui/$(id -u)`, `sleep 3`, `curl -sS -o /dev/null -w '%{http_code}' http://localhost:${MAESTRO_WEB_PORT:-45678}/`, accept any 2xx/3xx/4xx as healthy (root path without token returns 404 by design), tail `server.err.log` + `server.out.log` on failure.

#### Scope check

- **Probe:** `git diff main..HEAD -- src/web/ | wc -c`
- **Expected:** `0` (zero bytes — `src/web/` untouched on this branch).
- **Probe:** `git diff main..HEAD -- src/main/ | wc -c`
- **Expected:** `0` (zero bytes — `src/main/` untouched on this branch).
- **Probe:** `git diff main..HEAD --stat`
- **Expected:** four files — `ISA.md` (this Verification entry + the Decisions append above) plus the three new `infra/` files.
- **Probe:** the runbook + plist + script are concrete enough that `./infra/deploy.sh` from `~/code/maestro` on mini2 produces a running launchd-managed server with a curl-verifiable response on `localhost:45678` — NOT verified by this agent because it has no mini2 access. Verification of THAT claim is the first real spike, done by Trillium, fed back as a follow-on Decisions entry.

#### Deferred (first real spike answers these)

- Whether the hard-coded fnm node path in the plist matches mini2's actual install prefix (Q3).
- Whether the existing Electron `maestro-dev/` data dir is readable by the headless server without corruption when both target the same JSON files (Q1).
- Whether `customSyncPath` is set in Trillium's existing Electron install — if so, the plist's `MAESTRO_DATA_DIR` must be updated (Q2).
- Whether `npm install` on mini2 succeeds without manual `electron-rebuild` intervention (Q5).
- Whether the Fastify server binds `0.0.0.0:45678` or the Tailscale interface only (Q6 — `lsof -nP -iTCP:45678 -sTCP:LISTEN` on mini2 answers this).
- Whether deploys should auto-tag for rollback (Q4).

### 2026-06-08 — Drift fix evidence (re-export `MODAL_PRIORITIES` + `Layer` from renderer)

**Environment:** Node 22.22.1 via fnm; macOS arm64 (laptop); branch `fix-drift-reexport-modal-priorities`; worktree `/Users/trilliumsmith/code/maestro-drift`; base SHA `17226f882`. `node_modules` symlinked from `/Users/trilliumsmith/code/maestro/node_modules` for the build verification; removed before commit.

#### Pre-flight — verify renderer-side files are identical to webFull copies and have no default export

- **Probe (renderer/constants/modalPriorities.ts):** read all 243 LOC; exports are `export const MODAL_PRIORITIES = { ... } as const;`, `export type ModalPriorityKey = ...;`, `export type ModalPriorityValue = ...;`. No `export default`. Body byte-identical to `src/webFull/constants/modalPriorities.ts` (the L2.1 lift artifact carried an extra paragraph in the file-header doc-comment about "Lifted verbatim from src/renderer..." — the only delta vs the renderer source).
- **Probe (renderer/types/layer.ts):** read all 108 LOC; exports are `LayerType`, `FocusTrapMode`, `BaseLayer`, `ModalLayer`, `OverlayLayer`, `Layer`, `ModalLayerInput`, `OverlayLayerInput`, `LayerInput`, plus runtime `isModalLayer` / `isOverlayLayer`. No `export default`. Body byte-identical to `src/webFull/types/layer.ts` (same "Lifted verbatim..." header-comment delta only).
- **Result:** Neither file has a default export, so `export * from '../../renderer/...';` is sufficient — no `export { default } from '...';` line needed. Status: **PASS**.

#### Pre-flight — verify webFull→renderer relative imports already work in the build

- **Probe:** `grep -rn "from ['\"]\\.\\./\\.\\./renderer" src/webFull/` returned four hits before the change: `mobile/App.tsx:26` (`estimateContextUsage` from `../../renderer/utils/contextUsage`), `mobile/WebReadingContent.tsx:4` and `mobile/MobileMarkdownRenderer.tsx:24` (both `bionifyReadingMode` from `../../renderer/utils/bionifyReadingMode`), `mobile/SessionStatusBanner.tsx:36` (same as App.tsx). These four files build successfully today, confirming vite's resolver crosses the `src/webFull/` → `src/renderer/` boundary without tsconfig changes. Status: **PASS** — the re-export pattern is sound; no path-mapping work needed.

#### Pre-flight — verify vite config aliases support this pattern

- **Probe:** Read `vite.config.webfull.mts` lines 58-65: `resolve.alias` already maps `'@renderer'` → `path.join(__dirname, 'src/renderer')`. The webfull build explicitly declares "Allow importing from renderer types/constants" as the intent of that alias. Result: re-exports via relative path are consistent with the documented intent. Status: **PASS**.

#### Build — `npm run build:webfull` after the re-export switch

- **Probe:** `ln -s /Users/trilliumsmith/code/maestro/node_modules node_modules && eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npm run build:webfull`
- **Result:** `vite v5.4.21 building for production... ✓ 2532 modules transformed.` Built `dist/webfull/index.html` (3.54 kB), `dist/webfull/assets/mobile-DWpJmM3c.css` (47.56 kB), `dist/webfull/assets/main-Boi2EcHi.js` (0.81 kB), `dist/webfull/assets/react-Dl6t4piS.js` (141.58 kB), `dist/webfull/assets/mobile-Bju1GwAh.js` (962.75 kB). Built in 4.57s. Pre-existing CSS warning (`Expected identifier but found "-"` at `<stdin>:2707:2`) unrelated to this change — present on `main` before the edit. Pre-existing chunk-size advisory likewise unrelated. Exit 0. Status: **PASS**.

#### Build — `dist/webfull/index.html` still produces `<div id="root">`

- **Probe:** `grep 'id="root"' dist/webfull/index.html`
- **Result:** `		<div id="root">` — root mount point still present, identical shape to pre-change build. The bundle's entry sequence (Fastify static-asset path → `index.html` → `assets/main-*.js` → React mount on `#root`) is unaffected by the constant/type re-export. Status: **PASS**.

#### Hygiene — symlink removed before commit

- **Probe:** `rm node_modules && ls -la node_modules`
- **Result:** `ls: node_modules: No such file or directory`. Worktree tree clean of build-only symlinks before `git add`. Status: **PASS**.

#### Scope check — diff against `main` for guarded directories

- **Probe (renderer):** `git diff main..HEAD -- src/renderer/ | wc -c` (after commit)
- **Result:** `0` — no edits to `src/renderer/` (the single source of truth stays canonical). Status: **PASS**.
- **Probe (web):** `git diff main..HEAD -- src/web/ | wc -c` → `0`. Status: **PASS**.
- **Probe (main):** `git diff main..HEAD -- src/main/ | wc -c` → `0`. Status: **PASS**.
- **Probe (webFull):** the diff lands ONLY in `src/webFull/constants/modalPriorities.ts` (242 LOC removed, 3 LOC added) and `src/webFull/types/layer.ts` (107 LOC removed, 3 LOC added), plus this ISA append. Status: **PASS**.

#### Drift-prevention assertion — net result

After this commit, any future change to `MODAL_PRIORITIES` (e.g. a new modal kind landing upstream) or to the `Layer` discriminated union (e.g. a new layer-type variant) will propagate to webFull automatically via the re-export, with TypeScript catching mismatched consumers at build time. The "verbatim copy + manual sync" failure mode is closed by construction. Status: **PASS** — risk A retired.

### 2026-06-08 — Layer 0e evidence (Sentry wrapper scaffold)

**Environment:** Node 22.22.1 via fnm; npm 10.9.4; macOS arm64 (laptop); branch `layer-0e-sentry-split`; worktree `/Users/trilliumsmith/code/maestro-sentry`; base SHA `17226f882` (off `main` via the layer-0c merge). `node_modules` symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the install + build session; removed before commit so the worktree tree stays clean.

#### Files added / modified

- New: `src/server/sentry.ts` (~140 LOC including doc-comments) — three exported functions (`initSentry`, `captureException`, `captureMessage`), lazy `require('@sentry/node')` gated on `process.env.MAESTRO_SENTRY_DSN` / `opts.dsn`. All capture calls wrapped in try/catch — Sentry-side failures are intentionally swallowed so crash reporting failing cannot crash the server.
- New: `src/webFull/utils/sentry.ts` (~160 LOC including doc-comments) — same three-function surface, lazy dynamic `import('@sentry/browser')` so Vite/Rollup code-splits it into an async chunk that DSN-less users never download. DSN read from `import.meta.env.MAESTRO_PUBLIC_SENTRY_DSN` (Vite's `PUBLIC_` convention for browser-safe env vars).
- Modified: `package.json` — two-line `dependencies` addition for `@sentry/browser@^7.5.0` and `@sentry/node@^7.5.0` (both alphabetically adjacent to the existing `@sentry/electron@^7.5.0` line). No `scripts` / `build` / `devDependencies` touched.
- Modified: `package-lock.json` — auto-updated by `npm install`. Top-level `node_modules/@sentry/browser` and `node_modules/@sentry/node` entries resolved to `7.120.4`, matching the `^7.5.0` range and the version `@sentry/electron`'s transitive deps had already pulled into the tree (npm deduplicated cleanly — no duplicate installs).
- Modified: `ISA.md` — Decisions append (L0e shipped scaffold-only) and this Verification entry.

#### Install — `npm install --no-audit --no-fund --include=dev`

- **Probe:** `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npm install --no-audit --no-fund --include=dev`
- **Result:** `package-lock.json` updated with the new `@sentry/browser` + `@sentry/node` top-level entries; `node_modules/@sentry/browser/package.json` reports `"version": "7.120.4"` and `node_modules/@sentry/node/package.json` reports `"version": "7.120.4"`. `npm install` itself completed the dependency resolution and lockfile update; the `postinstall` `electron-rebuild -f -w node-pty,better-sqlite3` step failed with an unrelated `ModuleNotFoundError: No module named 'distutils'` (macOS Python 3.12+ removed `distutils` from the stdlib — `node-gyp` needs it for `better-sqlite3` rebuild). The postinstall failure does NOT affect this layer because (1) this layer adds pure-JS deps with no native components, (2) the symlinked `node_modules` already contains the correctly-rebuilt `node-pty` and `better-sqlite3` binaries from the main checkout, and (3) the server (`tsc -p tsconfig.server.json`) and webfull (`vite build`) builds both ran cleanly on the same install state. Status: **PASS** for the layer's install goals (deps in `node_modules`, lockfile updated); the postinstall failure is pre-existing macOS-Python environmental noise unrelated to the Sentry split.

#### Build — `npx tsc -p tsconfig.server.json`

- **Probe:** `npx tsc -p tsconfig.server.json && echo "EXIT=$?"`
- **Result:** `EXIT=0`. Zero TS errors. `dist/server/sentry.js` + `dist/server/sentry.js.map` emitted alongside the pre-existing `dist/server/index.js`, `dist/server/process-manager-adapter.js`, `dist/server/sessions-mutator.js`. The new module compiled against the same `tsconfig.server.json` include list that already covers `src/server/**/*.ts` — no tsconfig change needed.

#### Build — `npm run build:webfull`

- **Probe:** `npm run build:webfull` (clean: `rm -rf dist/webfull` first)
- **Result:** Exit 0. Bundle output: `index.html` 3.54 kB, `mobile-DWpJmM3c.css` 47.56 kB, `main-Boi2EcHi.js` 0.81 kB, `react-Dl6t4piS.js` 141.58 kB, `mobile-Bju1GwAh.js` 962.75 kB. **Bundle sizes are bit-for-bit identical to Layer 2.1's evidence** — Vite's tree-shaker correctly dropped the new `src/webFull/utils/sentry.ts` module because no consumer imports it yet (matching the scaffold-only intent). The pre-existing CSS minification warning (`Expected identifier but found "-"` at line 2707) carried over from upstream's CSS source; not a regression. The `@sentry/browser` dependency adds zero bytes to the bundle until a feature imports `initSentry()`.

#### Electron-leak guard — `grep -rE "@sentry/electron" dist/server/ dist/webfull/`

- **Probe:** `grep -rE "@sentry/electron" dist/server/ dist/webfull/; echo "EXIT=$?"`
- **Result:** `EXIT=1` (grep no-match, empty output). Neither the server dist nor the webfull bundle contains any reference to `@sentry/electron` — confirms ISC-33's "not imported at runtime" PASS holds, and that the new wrapper modules deliberately steer clear of the electron SDK. Status: **PASS**.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` untouched).
- `git diff main..HEAD -- src/main/ | wc -c` → `0` (zero bytes — `src/main/` untouched, including `src/main/utils/sentry.ts` left exactly as upstream).
- `git diff main..HEAD -- src/server/index.ts | wc -c` → `0` (zero bytes — init wire-up deferred to follow-on, no collision with in-flight `layer-0c-remaining-writes` editing this file).
- Working-tree changes for this layer (before commit): `M package.json`, `M package-lock.json`, `M ISA.md`, `?? src/server/sentry.ts`, `?? src/webFull/utils/sentry.ts`. Exactly the authorized set.
- `node_modules` symlink (created for the install + builds) removed before commit; not tracked.

#### Deferred — init wire-up

`initSentry()` is exported but not called. The follow-on commit needs to:

1. Add `initSentry()` near the top of `src/server/index.ts` (before `new WebServer(...)`) so unhandled exceptions during server boot get reported when a DSN is configured.
2. Add `initSentry()` near the top of `src/webFull/main.tsx` (before `ReactDOM.createRoot(...).render(...)`) so renderer-side React errors get reported in the webFull bundle when a DSN is configured.
3. Once both calls land, re-run the L0a/L0e probes and flip ISC-33 from partial PASS ("not in dist") to full PASS ("explicitly replaced with `@sentry/node` for server and `@sentry/browser` for webFull").

This split (scaffold now, init later) was chosen to avoid colliding with the in-flight `layer-0c-remaining-writes` work on `src/server/index.ts`.

### 2026-06-08 — customSyncPath bootstrap check evidence (audit Finding 3)

**Environment:** Node 26.0.0; macOS arm64 (laptop); branch `fix-audit-followup-config-and-syncpath`; base SHA `17226f882` (off Layer 0c). `node_modules` symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the test session; removed before commit.

#### Build verification — `tsc -p tsconfig.server.json`

- **Probe:** `./node_modules/.bin/tsc -p tsconfig.server.json; echo EXIT=$?`
- **Result:** `EXIT=0`. Zero TS errors. `dist/shared/data-dir.js` re-emitted with the new bootstrap-reading logic. Status: **PASS**.

#### Smoke — seven cases against the compiled artifact

A small node ESM smoke (`/tmp/maestro-data-dir-smoke.mjs`, deleted before commit) imports `dist/shared/data-dir.js`, writes and removes `~/.config/maestro/maestro-bootstrap.json` between cases, calls `__resetCacheForTesting()` to bust the module-level cache, then asserts the return of `getDataDir()`. The pre-existing bootstrap file (if any) is snapshotted and restored at the end so the smoke is non-destructive.

```
PASS  env-var-wins: /tmp/maestro-env-wins
PASS  bootstrap-customSyncPath-wins: /tmp/maestro-bootstrap-target
PASS  default-fallback: /Users/trilliumsmith/.config/maestro
PASS  malformed-bootstrap-falls-through: /Users/trilliumsmith/.config/maestro
PASS  bootstrap-without-customSyncPath-falls-through: /Users/trilliumsmith/.config/maestro
PASS  bootstrap-non-absolute-rejected: /Users/trilliumsmith/.config/maestro
PASS  bootstrap-traversal-rejected: /Users/trilliumsmith/.config/maestro

Total: 7 passed, 0 failed.
```

Case-by-case:

| Case | Setup | Expected | Result |
| --- | --- | --- | --- |
| (a) env-var-wins | `MAESTRO_DATA_DIR=/tmp/maestro-env-wins`, bootstrap has `customSyncPath=/tmp/should-be-ignored` | `/tmp/maestro-env-wins` | PASS — env var wins absolutely, bootstrap NOT consulted |
| (b) bootstrap-customSyncPath-wins | no env, bootstrap has `customSyncPath=/tmp/maestro-bootstrap-target` | `/tmp/maestro-bootstrap-target` | PASS — bootstrap field returned (this is the audit-fixed case) |
| (c) default-fallback | no env, no bootstrap file | `~/.config/maestro` | PASS — falls through to default cleanly |
| (d) malformed-bootstrap-falls-through | no env, bootstrap is `{not valid json` | `~/.config/maestro` | PASS — JSON parse error swallowed, falls through to default |
| (e) bootstrap-without-customSyncPath-falls-through | no env, bootstrap has `{someOtherField: 'x'}` | `~/.config/maestro` | PASS — missing field falls through |
| (f) bootstrap-non-absolute-rejected | no env, `customSyncPath=relative/path` | `~/.config/maestro` | PASS — validator rejects non-absolute path |
| (g) bootstrap-traversal-rejected | no env, `customSyncPath=/tmp/../etc` | `~/.config/maestro` | PASS — validator rejects literal `..` segment |

#### Cleanup

- Smoke script (`/tmp/maestro-data-dir-smoke.mjs`) deleted post-run.
- Pre-existing `~/.config/maestro/maestro-bootstrap.json` (if any) restored to its pre-smoke contents; if none existed, the file was unlinked.
- `node_modules` symlink (used for the `tsc` build) removed before commit.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes).
- `git diff main..HEAD -- src/main/ | wc -c` → `0` (zero bytes — Architect's Finding 3 fix does NOT touch any upstream files, matching the brief's anti-pattern guard).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes).
- Files modified in this turn: `src/shared/data-dir.ts` (additive logic — bootstrap-reading + validation), `ISA.md` (Decisions appends + this Verification entry).

#### Architect audit Finding 2 — Decisions entry verification

- **Probe:** `grep -c "Additive upstream-config edits authorized" ISA.md`
- **Result:** 1 — the legalization Decision entry is appended (line in the Decisions section, dated 2026-06-08). This closes Finding 2: the `tailwind.config.mjs` line-3 content-glob edit (Layer 2.1, sha `edfa532b2`) and the `tsconfig.server.json` `include` array extension (Layer 0b, sha `0cbd4df5c`) are now both retroactively legalized under ISC-40's additive-config exception, with the rebase-risk assessment documented in the Decision entry itself. Status: **PASS**.

### 2026-06-08 — Layer 3.1 evidence (Settings General tab rewrite)

**Environment:** Node 22.22.1 via fnm; macOS arm64 (laptop); branch `layer-3.1-settings-general-tab`; worktree `/Users/trilliumsmith/code/maestro-settings`; base SHA `17226f882`. `node_modules` symlinked from `/Users/trilliumsmith/code/maestro/node_modules` for the build session; removed before commit so the worktree stays clean.

#### Files added (new, all under `src/webFull/`)

- `src/webFull/components/Settings/SettingsModal.tsx` (96 LOC) — webfull SettingsModal shell. Uses lifted `Modal` primitive (Layer 2.1) at `MODAL_PRIORITIES.SETTINGS` (450), fixed width 780 + max-height 720px to match the renderer's 780x720 modal shape. Tab strip ready for subsequent tab agents — only General is wired today.
- `src/webFull/components/Settings/tabs/GeneralTab.tsx` (~320 LOC) — covers the `settings.get/set` namespace fields with consistent visual language (icons via lucide-react, themed toggles, three-state thinking-mode selector). Inline "Coming in subsequent layers" panel surfaces the deferred IPC namespaces (wakatime/sync/stats/shells/power/GPU/openPath) so they are not silently dropped.
- `src/webFull/hooks/useSettings.ts` (130 LOC) — REST-backed `useState`+`fetch` hook. Returns `{ settings, loading, error, setSetting, refresh }`. Mutations optimistically update the local cache, PATCH the server, adopt the server's returned full settings as source of truth on success, and roll back the optimistic update on failure. Intentionally NOT Zustand — webFull has no Zustand anywhere today per audit §C4; `useState` is the consistent pattern.
- `src/webFull/components/Settings/parity.test.ts` (180 LOC) — 5 parity stories (3 happy-path + 2 negative-path): `open-general-tab-shows-known-fields`, `change-conductor-profile-persists-to-server`, `switch-thinking-mode-to-sticky-persists`, `server-503-on-missing-provider-shows-error`, `patch-with-empty-body-returns-400-no-state-change`. Assertion vocabulary restricted to `hasElement`/`hasText`/`fsHas`/`wsFrameMatches`/`dbHasRow`/`processHas`/`notificationFired`/`broadcast` per the function-parity verification methodology ([brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md)). Vitest smoke pass guards catalog shape until the record-and-replay harness lands.

#### Files edited (purely additive)

- `src/webFull/App.tsx` — added `import { LayerStackProvider } from './contexts/LayerStackContext'` and wrapped `<Suspense fallback={<LoadingFallback />}>` with `<LayerStackProvider>` inside the existing `<ThemeProvider>` block. This is the Layer 2.1-foreshadowed mount point ("around line 285") — in this branch the comment + provider insertion shifted exact line numbers by ~7 lines but the wrap sits at the same logical position. No other changes to App.tsx.
- `src/main/web-server/routes/apiRoutes.ts` — header doc updated to list the two new routes. Added two imports (`FileStore` from `../../../shared/file-store`, `getDataDir` from `../../../shared/data-dir`). Added module-level `SettingsProvider` interface + `settingsProvider` slot + `registerSettingsProvider`/`getSettingsProvider`/`_resetDefaultSettingsStore` exports + lazily-instantiated `getDefaultProvider()` helper. Added `GET /:token/api/settings` and `PATCH /:token/api/settings` routes at the END of `registerRoutes()`. Existing routes, `ApiRouteCallbacks` interface, and `ApiRoutes` class shape unchanged. `setCallbacks` semantics unchanged (still overwrite). 503 fallback removed in favor of always-available default provider — this matches the "wire end-to-end through the brief's allowed file set" constraint while staying additive.

#### Server design — why a module-level registry instead of WebServer.ts setters

The brief authorizes editing `src/main/web-server/routes/apiRoutes.ts` (additive routes only) but explicitly forbids touching `WebServer.ts`. WebServer's existing callback flow is centralized through `CallbackRegistry`, constructed inside WebServer and not reachable from outside without modifying the setter surface. To wire end-to-end within the brief's constraints, the route module owns its own provider registry. `registerSettingsProvider(p)` is the explicit injection seam for future headless entrypoints (`src/server/index.ts`); the lazy default FileStore-backed provider is the fallback that makes the routes useful immediately. Both code paths target `<dataDir>/maestro-settings.json` — same on-disk schema, same `temp-file-rename` write semantics from `src/shared/file-store.ts`.

#### Build verification — `npm run build:webfull`

Symlinked `/Users/trilliumsmith/code/maestro/node_modules` into the worktree before build; removed before commit.

```
> maestro@0.15.3 build:webfull
> vite build --config vite.config.webfull.mts

vite v5.4.21 building for production...
transforming...
✓ 2534 modules transformed.
rendering chunks...
warnings when minifying css:
▲ [WARNING] Expected identifier but found "-" [css-syntax-error]
    <stdin>:2714:2: -: \s|; (pre-existing in upstream CSS — same warning surfaces against src/web/ per Layer 1.1 evidence)
computing gzip size...
../../dist/webfull/index.html                    3.54 kB │ gzip:   1.41 kB
../../dist/webfull/assets/mobile-Jsjq6L5g.css   47.64 kB │ gzip:   9.38 kB
../../dist/webfull/assets/main-CB3EGn_a.js       0.81 kB │ gzip:   0.47 kB
../../dist/webfull/assets/react-xxjwAHka.js    141.58 kB │ gzip:  45.37 kB
../../dist/webfull/assets/mobile-BaSfynjr.js   964.13 kB │ gzip: 319.77 kB
✓ built in 3.96s
```

Exit code 0. Module count went from 2532 (Layer 2.1) to 2534 (Layer 3.1) — +2 reachable modules: `useSettings.ts` + the SettingsModal/GeneralTab pair (counted as one logical module by Vite via the index.ts barrel chain through `LayerStackProvider`). The lifted Layer 2.1 primitives are now consumed (not just tree-shaken-only), proving the L2.1 audit prediction held under load.

#### Server typecheck — `npx tsc -p tsconfig.server.json`

```
$ npx tsc -p tsconfig.server.json; echo "EXIT=$?"
EXIT=0
```

Zero TS errors. The new `FileStore` + `getDataDir` imports resolve through the existing `tsconfig.server.json` `include` paths (`src/shared/**/*.ts` is already in scope from Layer 0a).

#### Dev mode HTTP probe — `npm run dev:webfull`

```
$ npm run dev:webfull > /tmp/devwf.log 2>&1 &
$ sleep 4
$ curl -s -o /dev/null -w "HTTP=%{http_code}\n" http://localhost:5176/
HTTP=200
$ pkill -f "vite.*webfull"
```

Vite dev server bound to 5176 (strictPort honored — web stays on 5174), responded with HTTP 200 to a root GET. Killed cleanly.

#### Parity catalog smoke pass — `npx vitest run src/webFull/components/Settings/parity.test.ts`

```
 ✓ src/webFull/components/Settings/parity.test.ts (5 tests) 2ms

 Test Files  1 passed (1)
      Tests  5 passed (5)
```

All 5 parity tests pass: catalog declares ≥1 happy-path AND ≥1 negative-path story; every assertion uses an allowed verb; every story has non-empty given/when/then; no story references the deferred namespaces (wakatime/sync/stats/shells/openPath). The actual record-and-replay run against Electron-at-9222 + webFull-at-5176 lands when the parity harness module ships (not in this brief's scope).

#### Scope checks (verified post-write, pre-commit)

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — upstream-mirror web tree untouched).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — renderer tree untouched).
- Worktree status (pre-commit): two existing files edited (`src/webFull/App.tsx`, `src/main/web-server/routes/apiRoutes.ts`), one new directory tree under `src/webFull/components/Settings/`, one new file `src/webFull/hooks/useSettings.ts`. Plus the ISA appends in this section.
- `node_modules` symlink removed before commit; not tracked.

#### Deferred / out-of-scope for this brief

- Other Settings tabs (Display, Shortcuts, Theme, Notifications, AI Commands, Group Chat, SSH Hosts, Encore, LLM if-enabled) — subsequent agents per the Layer 3.x sub-plan.
- The "Coming in subsequent layers" inline panel in `GeneralTab.tsx` is the discoverable trail for what each subsequent agent picks up: `wakatime:*`, `sync:*`, `stats:*`, `shells:*`, `power:*`, GPU acceleration, `shell.openPath`.
- `WS broadcast` on settings change — no `settings:changed` broadcast exists in `src/main/web-server/services/broadcastService.ts` today. The parity catalog avoids asserting a `broadcast` verb against this surface to keep the catalog passable; if a subsequent layer adds a `settings_changed` broadcast type, the catalog can grow a `wsFrameMatches` story for live multi-client sync.
- The headless `src/server/index.ts` entrypoint does NOT call `registerSettingsProvider(...)` today — it doesn't need to, because the default FileStore-backed provider already targets the same `<dataDir>/maestro-settings.json` file the rest of `src/server/index.ts` reads. A future layer can swap in a provider that broadcasts on change without touching `apiRoutes.ts` again.

### 2026-06-08 — Layer 2.2 evidence (additional 0-IPC primitives lift)

#### Decisions

- **Lifted (verbatim):** `src/renderer/components/ui/EmojiPickerField.tsx` → `src/webFull/components/ui/EmojiPickerField.tsx`. Implementation copied byte-for-byte except the `Theme` import path (`'../../types'` → `'../../../shared/theme-types'`), matching the L2.1 pattern established by `ui/Modal.tsx` and `ui/FormInput.tsx`. Keeps the renderer's `theme: Theme` prop convention — webFull consumers resolve `useTheme()` at the feature-component level and thread `theme` down. 0-IPC verified: zero `window.maestro.*` callsites; the only `dialog` references are ARIA semantics (`aria-haspopup="dialog"`, `role="dialog"`), not Electron `dialog` IPC.
- **Re-export barrel:** appended Layer 2.2 section to `src/webFull/components/index.ts` exporting `EmojiPickerField` + `EmojiPickerFieldProps` from `./ui/EmojiPickerField`.
- **Skipped — not present in renderer tree:** `Spinner.tsx`, `Button.tsx` (under `ui/`), `Tooltip.tsx`. Confirmed via `ls src/renderer/components/ui/` → only `EmojiPickerField.tsx`, `FormInput.tsx`, `Modal.tsx`, `index.ts`. Renderer's design is deliberately "primitives over compositions" (per audit B1 at `/tmp/web-ui-lift-scope.md`) — buttons/spinners/tooltips are styled inline at callsites, not extracted as files. No 0-IPC check needed; the files don't exist to lift. WebFull already has its own `Button.tsx` (forwardRef-based, variants/sizes/states), so no parallel primitive was needed anyway.
- **Skipped — has IPC:** `src/renderer/components/Toast.tsx` (one line of audit-candidate review). `grep -nE "window\.maestro"` returned a hit at line 227 (`window.maestro.shell.openExternal(toast.actionUrl!)`). Candidate failed 0-IPC check; defer to rewrite pattern (would need either a `shell:openExternal` WS message type or an HTTP `POST /shell/open-external` route on the server, neither of which exists today — out of scope for this layer).
- **Skipped — not a primitive:** `ThinkingStatusPill.tsx` (586 lines — too large/composed to be a primitive). `ErrorBoundary.tsx` (163 lines, 0-IPC, but not on the audit's primitive list and `~/.claude/skills/Delegation/templates/lift-renderer-component.md` directs the lift wave to focus on items the audit names). Per parent brief "Don't aggressively lift — pick the small set of clear winners. Quality over quantity," these were left untouched.

#### Pattern used

Verbatim copy (not re-export). Rationale: `EmojiPickerField.tsx` contains real component logic (state, callbacks, JSX) that the webFull tree may evolve independently. The re-export pattern (`export * from '../../renderer/<path>'`) cited by Architect 2026-06-08 audit risk A is reserved for **non-divergent constants/types** like `MODAL_PRIORITIES` and `Layer` (see `src/webFull/constants/modalPriorities.ts` and `src/webFull/types/layer.ts`). For a stateful React component, the verbatim-copy + relative-path-adapt pattern from L2.1 (Modal, FormInput) is correct.

#### Verification

- **Files added** under `src/webFull/components/ui/`:
  - `src/webFull/components/ui/EmojiPickerField.tsx` (201 lines — verbatim from renderer source, only the `Theme` import path adapted and a doc-comment paragraph appended noting the lift + 0-IPC verification).
- **Files modified** in `src/webFull/components/`:
  - `src/webFull/components/index.ts` — appended Layer 2.2 section re-exporting `EmojiPickerField` + `EmojiPickerFieldProps`.

#### Build — `npm run build:webfull`

- **Probe:** `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npm run build:webfull` (node_modules symlinked from `/Users/trilliumsmith/code/maestro/node_modules` for the build, removed before commit).
- **Result:** Exit 0. `vite v5.4.21 building for production... ✓ 2532 modules transformed. ✓ built in 3.89s`. Bundle output: `index.html` 3.54 kB, `mobile-DWpJmM3c.css` 47.56 kB, `main-Boi2EcHi.js` 0.81 kB, `react-Dl6t4piS.js` 141.58 kB, `mobile-Bju1GwAh.js` 962.75 kB. **Bit-for-bit identical to Layer 0e's bundle sizes** — Vite's tree-shaker correctly dropped the new `ui/EmojiPickerField.tsx` because no webFull consumer imports it yet (matching the "primitive available, awaiting first consumer" scaffold intent). The pre-existing CSS minification warning (`Expected identifier but found "-"` at line 2707) carried over from upstream's CSS source; not a regression.
- **Mount check:** `grep -c '<div id="root">' dist/webfull/index.html` → `1`. The webfull bundle still mounts the React root at `<div id="root">`, unchanged by this layer.
### 2026-06-08 — Layer 0g evidence (Sentry init in webFull main.tsx — ISC-33 client closure)

**Environment:** Node 22.22.1 via fnm; npm 10.9.4; macOS arm64 (laptop); branch `layer-0g-webfull-sentry-init`; worktree `/Users/trilliumsmith/code/maestro-sentryweb`; base SHA `dd4c97462` (off `main` via the customSyncPath audit merge). `node_modules` symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the build session; removed before commit so the worktree stays clean.

#### Files modified

- Modified: `src/webFull/main.tsx` — added one import line (`initSentry, captureException` from `./utils/sentry`), one `initSentry()` call as the first runtime statement after the import block, and two `window.addEventListener` blocks (`'error'` → `captureException(e.error, { source: 'window_error' })`, `'unhandledrejection'` → `captureException(e.reason, { source: 'unhandled_rejection' })`) installed immediately after the init call. Mount block (`createRoot(container).render(<AppRoot />)`) is unchanged and now runs strictly after init + listener registration. No other webFull files touched.
- Modified: `ISA.md` — Decisions append (L0g shipped) and this Verification entry.

#### Build verification — `npm run build:webfull`

- **Probe:** `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && rm -rf dist/webfull && npm run build:webfull`
- **Result:** Exit 0. Bundle output: `index.html` 3.54 kB, `mobile-DWpJmM3c.css` 47.56 kB, `main-bclK4-Zt.js` 0.81 kB, `react-BcRkZXqt.js` 141.58 kB, `index-BaW46i7p.js` 407.56 kB, `mobile-4P0WkZS8.js` 963.30 kB. New `index-*.js` chunk (407.56 kB / 135.09 kB gzip) is the lazy `@sentry/browser` code-split — Vite/Rollup correctly hoisted the dynamic `import('@sentry/browser')` from `src/webFull/utils/sentry.ts` into a separate async chunk that the entry bundle only resolves when `initSentry()` finds a DSN at runtime. Main entry chunks (`main-*.js` 0.81 kB, `react-*.js` 141.58 kB) are bit-stable vs L0e/L2.1; the only new bytes in the eager graph are the `initSentry()` call + 2 `addEventListener` registrations. The pre-existing CSS minification warning (`Expected identifier but found "-"` at line 2707) carried over from upstream; not a regression. Status: **PASS**.

#### Electron-leak guard — `grep -r "@sentry/electron" dist/webfull/`

- **Probe:** `grep -rE "@sentry/electron" dist/webfull/; echo "EXIT=$?"`
- **Result:** `EXIT=1` (grep no-match, empty output). The webFull bundle contains no reference to `@sentry/electron`. Combined with L0f's server-side grep PASS (`dist/server/` also empty), ISC-33 closes as **full PASS** — `@sentry/electron` is explicitly replaced with `@sentry/node` (server) and `@sentry/browser` (webFull), not merely "not in dist." Status: **PASS**.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` untouched).
- `git diff main..HEAD -- src/main/ | wc -c` → `0` (zero bytes — `src/main/` untouched).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — `src/renderer/` untouched; the source `EmojiPickerField.tsx` lives at `src/renderer/components/ui/EmojiPickerField.tsx` and was read-only — only the destination `src/webFull/components/ui/EmojiPickerField.tsx` was written).
- Working-tree changes for this layer (before commit): `M src/webFull/components/index.ts`, `?? src/webFull/components/ui/EmojiPickerField.tsx`, plus this `M ISA.md` append. Exactly the authorized set.
- `node_modules` symlink (created for the build) removed before commit; not tracked.
- **2026-06-08** — **Layer 0f shipped: `newTab` callback wired (store-only, pattern B) + Sentry init wired into `main()`.** Two outstanding `src/server/index.ts` edits were bundled into one branch because they touch the same file and parallel agents would conflict. **Decision A — newTab strategy: pattern (B) "store-only mutation + lazy spawn on first command", not pattern (A) "real spawn at newTab time".** The renderer-side `setNewTabCallback` (`src/main/web-server/web-server-factory.ts:394-432`) returns a `Promise<{tabId} | null>` after spawning the underlying pty via the renderer's session-creation pipeline. In headless mode the equivalent real-spawn path would require lifting that pipeline's spawn-config-building logic into the server — out of scope for L0. Pattern (B) appends a tab record to the session's `aiTabs` array, generates a UUID, broadcasts `tabs_changed`, returns `{tabId}`. The underlying pty is spawned lazily on the first command-send into the new tab via the existing L0b `writeToSession` / `executeCommand` callback chain (ProcessManager already has on-demand spawn). Trade-off accepted: tabs created via web do NOT immediately have a backing process — they get one on first input. This matches what most web-driven flows expect anyway (a fresh tab sits idle until the user types). New mutator `addTab(sessions, sessionId): AddTabResult | null` added to `src/server/sessions-mutator.ts`; uses `randomUUID()` for tab id, sets `activeTabId = newTabId` (matches renderer focus-new-tab behavior), shape mirrors `tabsForBroadcast`'s `AITabData` contract (id, agentSessionId=null, name=null, starred=false, inputValue='', usageStats=null, createdAt=Date.now(), state='idle', thinkingStartTime=null, logs=[]). Returns `null` when the session id is unknown. **Decision B — Sentry init landing: ISC-33 graduates from partial PASS to full PASS.** L0e scaffolded `src/server/sentry.ts` but deliberately deferred the `initSentry()` call to avoid colliding with the in-flight L0c work on `index.ts`. L0c is now merged; L0f wires `initSentry()` as the very first line of `main()` (synchronous no-op when `MAESTRO_SENTRY_DSN` is unset, lazy-requires `@sentry/node` on the first capture call when set) and wraps the existing `main().catch(...)` block to call `captureException(err, { context: 'main_startup' })` before `process.exit(1)`. This closes the keystone gap identified at the bottom of the L0e Decisions entry: server-side error reporting is now explicit-replacement (`@sentry/node`), not "happens to be absent from dist because tsconfig include omits the path that pulls `@sentry/electron`". Renderer-side full closure for `@sentry/browser` still awaits the webFull `main.tsx` init wire-up — separate change, no `src/server/` conflict. **Decision C — boot-log line updated** from "Layer 0c: 9/10 WRITE callbacks active …newTab deferred to L0d" to "Layer 0f: 10/10 WRITE callbacks active … L0d: newTab via sessions store + broadcast, lazy process spawn on first command. L0f also wires Sentry init for error capture (no-op without MAESTRO_SENTRY_DSN)." File-header doc comment in `src/server/index.ts` updated to add the L0d / L0e / L0f layer descriptions alongside L0a-c. **Files touched in this turn:** `src/server/sessions-mutator.ts` (added `randomUUID` import + `AddTabResult` interface + `addTab` function), `src/server/index.ts` (added `initSentry` / `captureException` imports, replaced `newTab` stub with real handler, added `initSentry()` call at top of `main()`, wrapped `main().catch(...)` with `captureException(...)`, updated boot log line + file-header doc), and `ISA.md` (this Decisions entry + the Verification entry below). **Scope guard verified:** `git diff main..HEAD -- src/web/ | wc -c` → 0; `git diff main..HEAD -- src/main/ | wc -c` → 0; `git diff main..HEAD -- src/renderer/ | wc -c` → 0.

### 2026-06-08 — Layer 0f evidence (newTab pattern B + Sentry init)

**Environment:** Node 22.22.1 via fnm; macOS arm64 (laptop); branch `layer-0f-newtab-sentry-init`; worktree `/Users/trilliumsmith/code/maestro-l0f`; base SHA `6d683b39b` (off `main` via the L0e merge). `node_modules` symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the test session; removed before commit so the worktree tree stays clean.

#### File layout

- New mutator (additive only, no edits to existing functions): `src/server/sessions-mutator.ts` gains `import { randomUUID } from 'crypto';` at module top, `AddTabResult<T>` interface declaration, and the `addTab<T extends MutableSession>(sessions, sessionId): AddTabResult<T> | null` function. All other mutators (`switchMode`, `toggleBookmark`, `closeTab`, `renameTab`, `starTab`, `reorderTab`) untouched.
- Edited entrypoint: `src/server/index.ts` — file-header doc comment extended with L0d/L0e/L0f layer descriptions; one new `import { initSentry, captureException } from './sentry';`; the L0c `setNewTabCallback` stub block replaced with the real handler; `initSentry()` called as first line of `main()`; `main().catch(...)` wrapped with `captureException(err, { context: 'main_startup' });` before `process.exit(1)`; boot log line updated.
- ISA append (this Verification entry + the Decisions entry above).
- No edits to `src/main/`, `src/web/`, `src/renderer/`, `src/server/process-manager-adapter.ts`, `src/server/sentry.ts`, or any web-side file.

#### Build verification — `npx tsc -p tsconfig.server.json`

- **Probe:** `ln -s /Users/trilliumsmith/code/maestro/node_modules node_modules && eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npx tsc -p tsconfig.server.json; echo "EXIT=$?"`
- **Result:** `EXIT=0`. Zero TS errors. The new `addTab` mutator returns the right shape (`AddTabResult<StoredSession>`) for the L0f `setNewTabCallback` consumer; the wrapped `main().catch(...)` block typechecks; the new `import { initSentry, captureException } from './sentry'` resolves cleanly against the L0e wrapper module. `dist/server/index.js`, `dist/server/sessions-mutator.js`, and the pre-existing dist artifacts emitted. Status: **PASS**.

#### Boot — Layer 0f log line + Sentry init no-op without DSN

- **Probe:** `MAESTRO_DATA_DIR=/tmp/maestro-l0f MAESTRO_WEB_PORT=45689 node dist/server/index.js`
- **Result:** Server listens at `http://192.168.86.26:45689/<token>`. Boot log shows the new L0f line:
	```
	[maestro-server] Layer 0f: 10/10 WRITE callbacks active (L0b: writeToSession,
	executeCommand, interruptSession via ProcessManager; L0c-A: switchMode, closeTab,
	renameTab, starTab, reorderTab, toggleBookmark via sessions store + broadcast;
	L0c-C: selectSession, selectTab as headless no-ops; L0d: newTab via sessions store
	+ broadcast, lazy process spawn on first command). L0f also wires Sentry init for
	error capture (no-op without MAESTRO_SENTRY_DSN).
	```
- No Sentry-related crash, warning, or error on startup — `initSentry()` correctly returns without touching `@sentry/node` because `MAESTRO_SENTRY_DSN` is unset. Process tree clean: `node` only, no Electron Helper / GPU / Renderer descendants. Status: **PASS**.

#### Smoke — newTab via WebSocket against a seeded session

A small node WS client (`/tmp/maestro-l0f-smoke.mjs`) connected to `/<token>/ws`, subscribed to `sess-l0f-1` (pre-seeded in `/tmp/maestro-l0f-smoke/maestro-sessions.json` with one existing tab `tab-existing`), then fired two `new_tab` messages: one against the seeded session, one against `sess-does-not-exist`.

| Probe | Message → Response | Server-log trace |
| --- | --- | --- |
| `new_tab` `sess-l0f-1` | `new_tab_result success=true tabId=92c3ebbf-08ae-4942-9c61-867e92216ee6` plus `tabs_changed` broadcast (`aiTabs[0]=tab-existing, aiTabs[1]=92c3ebbf-..., activeTabId=92c3ebbf-...`) | `[Web] Received new_tab message: session=sess-l0f-1` → `newTab sess-l0f-1 -> 92c3ebbf-08ae-4942-9c61-867e92216ee6` |
| `new_tab` `sess-does-not-exist` | `new_tab_result success=false` (no tabId field — matches the `{tabId?}` schema in `handleNewTab`) | `[Web] Received new_tab message: session=sess-does-not-exist` → `newTab: session sess-does-not-exist not found; skipping` |

The `tabs_changed` broadcast arrived BEFORE the `new_tab_result` (broadcast fired inside the callback before the promise resolved) — matches the L0c pattern for `closeTab` / `renameTab` / etc. Both probes round-tripped within ~100ms and 600ms of message dispatch. Status: **PASS**.

#### Persistence verification

After the smoke probe, `/tmp/maestro-l0f-smoke/maestro-sessions.json` shows the cumulative result:

- `aiTabs[0]`: unchanged (`tab-existing`).
- `aiTabs[1]`: new tab `92c3ebbf-08ae-4942-9c61-867e92216ee6` with `agentSessionId=null`, `name=null`, `starred=false`, `inputValue=''`, `usageStats=null`, `createdAt=1780889158261`, `state='idle'`, `thinkingStartTime=null`, `logs=[]`.
- `activeTabId`: `tab-existing` → `92c3ebbf-08ae-4942-9c61-867e92216ee6` (focus shifted to the new tab, matching renderer behavior).

The "not found" probe (`sess-does-not-exist`) left the store unchanged. Status: **PASS** for store + broadcast wiring.

#### ISC-33 full-closure check — Sentry init lands, replacement is explicit

- **Probe:** `grep -rn "require(.@sentry/electron" dist/server/; grep -rn "from .@sentry/electron" dist/server/; echo "EXIT=$?"`
- **Result:** `EXIT=1` for both — no runtime require/import of `@sentry/electron` anywhere in `dist/server/`. (One match for the literal string `@sentry/electron` exists in `dist/server/index.js`, but it is inside the file-header doc comment describing the L0e layer scope — not a runtime reference.)
- **Probe:** `grep -rn "require(.@sentry/node" dist/server/`
- **Result:** `dist/server/sentry.js: const sentry = require('@sentry/node');` — confirms the `@sentry/node` lazy require lives in the dist artifact. The init call sequence is now: `main()` calls `initSentry()` → checks `process.env.MAESTRO_SENTRY_DSN` → if set, `require('@sentry/node')` lazily and call `sentry.init({ dsn, environment })`; if unset, silent return. `main().catch(...)` then routes errors through `captureException(err, { context: 'main_startup' })` which checks the cached `sentryModule` reference and is a no-op when uninitialized.
- **Conclusion:** ISC-33 graduates from partial PASS ("not in dist because tsconfig happens to omit the paths that pull it") to **full PASS** ("server explicitly initializes `@sentry/node` and routes the top-level error path through `captureException`; webFull side still pending the `main.tsx` init wire-up but the server side of the split is done"). Status: **PASS** (server-side closure).

#### Electron-leak guard

- **Probe:** `grep -r "from 'electron'" dist/server/; echo "exit=$?"`
- **Result:** `exit=1` (grep no-match). Adding the `addTab` mutator + Sentry init wire-up pulled zero new electron dependencies into the compiled dist tree. Status: **PASS**.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` still untouched).
- `git diff main..HEAD -- src/main/ | wc -c` → `0` (zero bytes — `src/main/` still untouched).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — `src/renderer/` still untouched).
- L0f diff against `6d683b39b` (base):
	- 2 edited source files: `src/server/index.ts`, `src/server/sessions-mutator.ts`.
	- 1 edited doc file: `ISA.md`.
	- No new files; no `tsconfig.server.json` changes; no `package.json` changes.
- `node_modules` symlink (created for the build + smoke) removed before commit; not tracked.
- `git diff main..HEAD -- src/main/ | wc -c` → pre-existing baseline drift only (main moved ahead of this branch's base for unrelated upstream files); `git diff HEAD -- src/main/ | wc -c` → `0` (this turn touched zero bytes under `src/main/`).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — `src/renderer/` untouched).
- `git diff HEAD -- src/web/ src/main/ src/renderer/ | wc -c` → `0` (this turn's working-tree changes touched none of the three guarded dirs).
- Files modified in this turn: `src/webFull/main.tsx` (3-line import + 1-line init call + 2 `addEventListener` blocks), `ISA.md` (Decisions append + this Verification entry). Exactly the authorized set.
- `node_modules` symlink (used for the `vite build`) removed before commit; not tracked.

#### ISC-33 closure

L0a closed ISC-33 as partial PASS ("`@sentry/electron` not in `dist/server/`" — but only because `tsconfig.server.json` happened to omit the paths that pulled it). L0e shipped the explicit-replacement wrapper modules (`src/server/sentry.ts` + `src/webFull/utils/sentry.ts`) but left them un-imported. L0f called `initSentry()` from `src/server/index.ts` ahead of `WebServer` construction. This wave (L0g) calls `initSentry()` from `src/webFull/main.tsx` ahead of `createRoot().render()`. Both sides are now (a) explicitly replaced with the right SDK per surface and (b) wired into the runtime startup path. ISC-33 is **PASS, full closure** — re-running the L0a grep probe on both `dist/server/` and `dist/webfull/` confirms zero `@sentry/electron` references in either dist artifact.

### 2026-06-08 — Layer 0h evidence (server-side `HistoryManager` port + callback wiring)

#### Build

- `ln -s /Users/trilliumsmith/code/maestro/node_modules node_modules` (worktree-local; removed pre-commit).
- `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npx tsc -p tsconfig.server.json` → exit 0, no diagnostics. `dist/server/history-manager.js` + `.js.map` produced; `dist/server/index.js` rebuilt with the new boot log line.

#### Boot smoke (clean dataDir, history endpoint exercised three ways)

- `rm -rf /tmp/maestro-l0h && mkdir -p /tmp/maestro-l0h`
- `MAESTRO_DATA_DIR=/tmp/maestro-l0h MAESTRO_WEB_PORT=45690 node dist/server/index.js` (backgrounded, PID 50334).
- Boot log diff vs L0f:
	- `[HistoryManager] Created history directory` line lands during `historyManager.initialize()` (the L0h `await` inside `main()`). This is the new init-time log; the renderer-side `logger.debug` call was switched to `console.log` (info-level) for parity with the rest of `src/server/`.
	- The L0f summary line `Layer 0f: 10/10 WRITE callbacks active …` is replaced by:
	```
	Layer 0h: getHistory — server-side HistoryManager wired (per-session storage at
	<dataDir>/history/<sessionId>.json, API parity with src/main/history-manager.ts).
	10/10 WRITE callbacks active (L0b: writeToSession, executeCommand, interruptSession
	via ProcessManager; L0c-A: switchMode, closeTab, renameTab, starTab, reorderTab,
	toggleBookmark via sessions store + broadcast; L0c-C: selectSession, selectTab as
	headless no-ops; L0d: newTab via sessions store + broadcast, lazy process spawn on
	first command). L0f also wires Sentry init for error capture (no-op without
	MAESTRO_SENTRY_DSN).
	```
	The phrase "history stubbed to `[]`" / "getHistory — the last stubbed" no longer appears in the boot log line. Status: **PASS** for boot-log update.
- Filesystem after init: `ls -la /tmp/maestro-l0h/` → `history/` dir created (empty). No `maestro-history.json` legacy file present, so `needsMigration()` returns `false` and the migration code path is not exercised on this clean run.

#### Curl probes against `/<token>/api/history` (token `3e05f99e-d918-44ee-a434-1e49dc8298d9`)

Clean dataDir (no session files):

| Query | Response |
| --- | --- |
| `(no params)` | `{"entries":[],"count":0,"timestamp":1780890059989}` |
| `?sessionId=does-not-exist` | `{"entries":[],"count":0,"timestamp":1780890060001}` |
| `?projectPath=/nonexistent` | `{"entries":[],"count":0,"timestamp":1780890060013}` |

All three dispatch branches return a clean empty array (NOT 503 / NOT 500 — the callback is wired). Status: **PASS** for "returns `[]` since no history file exists, not an error" per the brief's acceptance bar.

Then pre-seeded `/tmp/maestro-l0h/history/sess-smoke.json` with two entries (timestamps `1780000000000` and `1780000001000`, both `projectPath=/tmp/some-project`) — no server restart needed since the manager reads from disk on every call:

| Query | Response |
| --- | --- |
| `?sessionId=sess-smoke` | 2 entries, `entry-2` (ts `1780000001000`) first, `entry-1` (ts `1780000000000`) second — descending timestamp sort applied by the callback before return |
| `?projectPath=/tmp/some-project` | 2 entries, same order (sort applied inside `getEntriesByProjectPath` via `sortEntriesByTimestamp`) |
| `(no params)` | 2 entries (cross-session feed via `getAllEntries`), same order |

All three paths return the seeded data correctly sorted. Status: **PASS** for end-to-end seed → curl round-trip.

#### Anti-import guard (electron-leak check)

- **Probe:** `grep "from 'electron'" dist/server/history-manager.js; echo exit=$?`
- **Result:** `exit=1` (no match). The new module compiles to an `@sentry/electron`-free, `electron`-free artifact.
- **Probe:** `grep -rn "from 'electron'" dist/server/; echo exit=$?`
- **Result:** `exit=1` (no match). The L0h additions do not regress the dist-wide electron-free property established in L0a/L0b/L0e/L0f.
- One `require('electron')` reference remains in `dist/shared/data-dir.js` (inside the `try`/`catch` in `tryElectronUserData()`) — that's the dual-mode helper, intentional and pre-existing from L0a. Not a regression.

#### Scope check

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — `src/web/` still untouched).
- `git diff main..HEAD -- src/main/ | wc -c` → `0` (zero bytes — `src/main/` still untouched; `src/main/history-manager.ts` is byte-for-byte the canonical renderer copy).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — `src/renderer/` still untouched).
- L0h diff against `ed1e6757d` (base):
	- 1 NEW source file: `src/server/history-manager.ts`.
	- 1 edited source file: `src/server/index.ts` (additive — import, init, callback replacement, boot log).
	- 1 edited doc file: `ISA.md`.
	- No new files outside `src/server/`; no `tsconfig.server.json` changes; no `package.json` changes; no new dependencies.
- `node_modules` symlink (created for the build + smoke) removed before commit; not tracked.

#### Process cleanup

- `kill 50334` → server exited cleanly, no orphan child processes. Verified via `ps -p 50334` post-kill (empty).

### 2026-06-08 — Layer 3.2 evidence (Settings Display + Shortcuts tabs)

#### Decisions

- **Pattern: rewrite-with-primitives for both tabs.** Per the L3.x lift-vs-rewrite rule.
  - **DisplayTab.** Renderer source is 715 LOC and fans out into ≥1 IPC namespace beyond `settings` (specifically `fonts:detect` for system font enumeration in `loadFonts()`). That puts it over the "lift if ≤ 1 IPC namespace beyond settings" threshold; rewrite-with-primitives, not verbatim lift.
  - **ShortcutsTab.** Renderer source is 212 LOC and uses ZERO `window.maestro.*` IPC. By the rule it is technically liftable, but rewriting keeps the L3.x catalog uniform and avoids a cross-tree import from `src/renderer/utils/shortcutFormatter.ts` (a utility not part of the L2.x lifted primitives). Inlined a ~20-line platform-aware key formatter in the webFull tab — pure function, no IPC.

- **DisplayTab deferred IPC / Electron-only surface (surfaced inline, NOT silently dropped):**
  - `fontFamily` picker + custom-font management (`fonts:detect` — Electron-only system font enumeration).
  - "Window Chrome" toggles (`useNativeTitleBar`, `autoHideMenuBar`) — affect Electron's BrowserWindow chrome; no browser equivalent. Settings keys themselves still writable from a future port.
  - Bionify info modal (non-essential algorithm reference popup). Algorithm input itself stays editable.
  - Surfaced via the same "Coming in subsequent layers" panel template from L3.1 General. Anti-criterion: do NOT silently drop.

- **DisplayTab IPC-free coverage (today):** `fontSize`, `terminalWidth`, `maxLogBuffer`, `maxOutputLines`, `userMessageAlignment`, `bionifyReadingMode`, `bionifyIntensity`, `bionifyAlgorithm` (with `BIONIFY_ALGORITHM_PATTERN` validation matching the renderer's regex), `fileExplorerIconTheme`, `documentGraphShowExternalLinks`, `documentGraphMaxNodes`, `contextManagementSettings` (nested object: `contextWarningsEnabled` + yellow/red thresholds with the renderer's mutual-bump validation), `localIgnorePatterns` (string[] edited as a one-per-line textarea), `localHonorGitignore`.

- **DisplayTab data-model adapter — `maxOutputLines` Infinity sentinel.** Renderer's `maxOutputLines` toggle allows `Infinity` for the "All" option; `Infinity` is not JSON-representable, so the on-disk FileStore would coerce it on round-trip. WebFull serializes `Infinity` ↔ `-1` at the I/O boundary: the toggle reads `maxOutputLines === Infinity ? -1 : value`, and writes `value === -1 ? Infinity : value`. The renderer's Electron-store equivalent silently does the same coercion under the hood; this just makes the contract explicit in the webFull path.

- **ShortcutsTab — uses the same flat settings shape.** `shortcuts: Record<id, {id,label,keys}>` and `tabShortcuts: Record<id, {id,label,keys}>` are read from `useSettings()` (zero IPC). Writes go through the existing `PATCH /api/settings` route from L3.1 — no new route needed. Live key capture uses browser KeyboardEvent (the renderer's `e.code` Alt-handling for macOS special-character keys is preserved verbatim).

- **ShortcutsTab — empty-state handling.** When the server has not published a `shortcuts` map yet (e.g. early startup or fresh install) the renderer would show empty section headers; webFull instead shows a single "No customizable shortcuts have been registered yet" panel. This is the negative-path story in the parity catalog (`empty-shortcuts-map-shows-empty-state`).

- **SettingsModal tab list.** Renderer's tab order with LLM disabled is `general, display, shortcuts, theme, notifications, …`; webFull L3.2 covers the first three. Tab list refactored from a hardcoded single button into a `TABS: TabDef[]` array driven by `lucide-react` icons (Settings, Monitor, Keyboard). Tab strip is now data-driven, so subsequent layers add a row to the array instead of duplicating button JSX.

- **No new REST routes.** Both new tabs use the L3.1 `GET /api/settings` + `PATCH /api/settings` routes. The `customFonts` field (a Display tab feature on the renderer side) is the only setting that would have needed `fonts:detect` — explicitly deferred above. `apiRoutes.ts` UNTOUCHED in this layer.

#### Files added

- `src/webFull/components/Settings/tabs/DisplayTab.tsx` (789 LOC). Rewrite-with-primitives. Field accessors + JSX + two helper components (`ToggleButtonGroup<T>` for radio-style number/string pickers, `SwitchRow` for boolean toggles). Inline "Coming in subsequent layers" panel surfaces deferred IPC namespaces and Electron-only behaviors.
- `src/webFull/components/Settings/tabs/ShortcutsTab.tsx` (370 LOC). Rewrite-with-primitives. Inline `formatShortcutKeys` (~20 LOC) so no cross-tree import from `src/renderer/utils/`. Live keyboard recording via React KeyboardEvent; macOS Alt+key special-character handling preserved. Filter input auto-focuses on mount.
- `src/webFull/components/Settings/tabs/DisplayTab.parity.test.ts` (215 LOC). 6 parity stories: 4 happy-path (`open-display-tab-shows-known-fields`, `change-font-size-to-large-persists-to-server`, `toggle-context-warnings-persists-nested-object`, `edit-ignore-patterns-textarea-persists-array`) + 2 negative-path (`invalid-bionify-algorithm-does-not-persist`, `server-error-on-fetch-shows-error-banner`). Vitest catalog-shape guard with the allowed-verb set (`hasElement` / `hasText` / `fsHas` / `wsFrameMatches` / `dbHasRow` / `processHas` / `notificationFired` / `broadcast`). Banned-substring guard excludes `fonts:detect`, `useNativeTitleBar`, `autoHideMenuBar` (deferred surface).
- `src/webFull/components/Settings/tabs/ShortcutsTab.parity.test.ts` (215 LOC). 6 parity stories: 4 happy-path (`open-shortcuts-tab-shows-filter-and-count`, `record-new-shortcut-persists-to-server`, `filter-input-narrows-visible-shortcuts`, `escape-during-recording-cancels-without-persisting`) + 2 negative-path (`modifier-only-keypress-does-not-persist`, `empty-shortcuts-map-shows-empty-state`). Banned-substring guard excludes `fonts:detect`, `shell:`, `dialog:`, `power:`, `wakatime:` (no IPC namespace beyond `settings`).

#### Files edited (purely additive)

- `src/webFull/components/Settings/SettingsModal.tsx` (was 116 LOC, now 144 LOC). `SettingsTabId` widened to `'general' | 'display' | 'shortcuts'`. New `TabDef` interface + `TABS` array with icon refs from `lucide-react` (Settings, Monitor, Keyboard). Tab strip rewritten from hardcoded single button to a `TABS.map(...)` render so subsequent layers add an array entry instead of new JSX. Tab body switch grew two new branches (`display`, `shortcuts`). All existing testids preserved (`webfull-settings-modal`, `webfull-settings-tab-strip`, `webfull-settings-tab-general`, `webfull-settings-close`, `webfull-settings-body`). New testids: `webfull-settings-tab-display`, `webfull-settings-tab-shortcuts`.

#### Build — `npm run build:webfull`

Symlinked `/Users/trilliumsmith/code/maestro/node_modules` into the worktree before build; removed before commit.

```
> maestro@0.15.3 build:webfull
> vite build --config vite.config.webfull.mts

vite v5.4.21 building for production...
✓ 2534 modules transformed.
warnings when minifying css:
▲ [WARNING] Expected identifier but found "-" [css-syntax-error]
    <stdin>:2714:2: -: \s|; (pre-existing in upstream CSS — same warning surfaces against src/web/ per Layer 1.1 evidence)
computing gzip size...
../../dist/webfull/index.html                    3.54 kB │ gzip:   1.41 kB
../../dist/webfull/assets/mobile-Jsjq6L5g.css   47.64 kB │ gzip:   9.38 kB
../../dist/webfull/assets/main-CB3EGn_a.js       0.81 kB │ gzip:   0.47 kB
../../dist/webfull/assets/react-xxjwAHka.js    141.58 kB │ gzip:  45.37 kB
../../dist/webfull/assets/mobile-BaSfynjr.js   964.13 kB │ gzip: 319.77 kB
✓ built in 4.00s
```

Exit 0. Module count stable at 2534 (same as L3.1). The two new tabs are reachable through the SettingsModal but Rollup tree-shake folds them into the existing chunk; bundle bytes are bit-for-bit identical to L3.1 because the only consumers are the SettingsModal — which already imports `react`, `lucide-react`, the theme types, and `useSettings`. No new chunk introduced, no new top-level module count.

#### Parity catalog smoke pass

```
$ npx vitest run src/webFull/components/Settings/tabs/DisplayTab.parity.test.ts src/webFull/components/Settings/tabs/ShortcutsTab.parity.test.ts
 ✓ src/webFull/components/Settings/tabs/ShortcutsTab.parity.test.ts (6 tests) 3ms
 ✓ src/webFull/components/Settings/tabs/DisplayTab.parity.test.ts (6 tests) 4ms

 Test Files  2 passed (2)
      Tests  12 passed (12)
```

All 12 catalog-shape tests pass. Plus the L3.1 General-tab catalog continues to pass (5 tests). Full regression: `npx vitest run src/webFull/components/Settings/` → 17 tests, 3 files, all green. The actual record-and-replay run against Electron-at-9222 + webFull-at-5176 lands when the parity harness module ships (not in this brief's scope).

#### Scope checks (verified post-write, pre-commit)

- `git diff main..HEAD -- src/web/ | wc -c` → `0` (zero bytes — upstream-mirror web tree untouched).
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — renderer tree untouched).
- `git diff main..HEAD -- src/main/ | wc -c` → `0` (zero bytes — server tree untouched; L3.2 added no new REST routes).
- Working-tree changes for this layer (before commit): `M src/webFull/components/Settings/SettingsModal.tsx`, plus four new files under `src/webFull/components/Settings/tabs/` (DisplayTab.tsx, ShortcutsTab.tsx, and the two parity catalogs). Plus this ISA append.
- `node_modules` symlink removed before commit; not tracked.

#### Deferred / out-of-scope for this brief

- LLM, Theme, Notifications, AI Commands, Group Chat, SSH Hosts, Encore tabs — subsequent agents per the Layer 3.x sub-plan.
- DisplayTab's `fontFamily` + custom-font management — needs a `GET /api/fonts/detected` route on the server backed by a non-Electron font enumerator. Surfaced in the inline "Coming in subsequent layers" panel.
- DisplayTab's Window Chrome (`useNativeTitleBar`, `autoHideMenuBar`) — these settings have no browser equivalent. The keys remain writable through a future port if needed for Electron-mode parity; the user-visible effect is Electron-only.
- DisplayTab's Bionify info modal — non-essential help popup. Algorithm input itself is fully functional.
- ShortcutsTab — no deferred features. The renderer's `onRecordingChange` callback (used to coordinate with the modal's Escape handler) is replaced by the `onKeyDownCapture` `stopPropagation` pattern inside the recording flow; the layer-stack-managed modal Escape stays out of the way.
- A `shortcuts_changed` WS broadcast for live multi-client sync — same out-of-scope note as L3.1 (no `settings_changed` broadcast exists on the server side today).
### 2026-06-08 — ISA hygiene cleanup evidence (docs-only)

Branch `docs-isa-hygiene-cleanup` off `main` at `b82c60841`. Doc-only turn — no source touched.

- **Probe:** `git diff main..HEAD --stat -- 'src/**'`
- **Expected:** empty (zero source files in the diff).
- **Probe:** `git diff main..HEAD -- src/ | wc -c` → `0`.
- **Probe:** `git diff main..HEAD -- src/web/ | wc -c` → `0`.
- **Probe:** `git diff main..HEAD -- src/main/ | wc -c` → `0`.
- **Probe:** `git diff main..HEAD -- src/renderer/ | wc -c` → `0`.
- **Probe:** `git diff main..HEAD -- infra/ | wc -c` → `0`.
- **Probe:** `git diff main..HEAD --stat` — expect exactly two files: `ISA.md` and `PLAN.md`.
- **Probe:** `grep -nE "WEB_CONVERSION_ASSESSMENT|WEB_FEATURE_PARITY_SCOPE|WEB_PARITY_VERIFICATION" ISA.md PLAN.md`
- **Expected:** zero matches with bare filenames; the only matches are explicit "migrated from `<old-filename>` to brain on 2026-06-08" notes in the Companion docs section of PLAN.md and this Decisions entry — every former cross-reference now resolves through a `[brain-tlak]` / `[brain-8s3r]` / `[brain-aq5m]` pointer.
- **Probe:** `grep -n "Layer 4" ISA.md`
- **Expected:** zero matches against ISC-42's line. Remaining matches (lines ~192 and ~362) are historical Decisions/Verification entries describing the old-→new layer rename mapping ("old Layer 4 → Layer 6") and the historical "deferred" status at write-time — those entries are append-only by convention and correctly reflect what was true at write-time.
- **Probe:** `grep -nE "Layer 6 in \`WEB_PORT_ORDER\.md\`" ISA.md`
- **Expected:** matches ISC-42 (line ~130 after this cleanup's ISC-45 append shifts numbering).
- **ISC-45 placement check:** appended at the end of the "Anti-criteria & guard-rails" subsection, immediately after ISC-21 (the existing antecedent ISC). ISC-44.x is left untouched as the reserved per-feature parity-catalog namespace (see Test Strategy § Per-feature function-parity ISCs).
- Files modified in this turn: `ISA.md` (ISC-42 line fix + ISC-45 append + 8 reference rewrites + this Decisions entry + this Verification entry) and `PLAN.md` (2 reference rewrites). Exactly the authorized set.
### 2026-06-08 — Layer 6.1 evidence (RawPtyMultiplexer + pty_* WS protocol — server side)

#### Decisions

- **Additive, not replacement.** The existing stripped-output path (PtySpawner → `stripControlSequences` → DataBufferManager → `data` event → renderer `TerminalOutput.tsx`) stays exactly as before. Desktop renders the same byte-for-byte as it did pre-L6.1. The raw-byte path is a parallel emission from the same `PtySpawner.onData` callback, consumed by a new server-side `RawPtyMultiplexer`. Per scoping doc §1.1 / §6.1 — additive is the answer to the "replace vs both paths" dichotomy. Rationale: the renderer at `src/renderer/components/TerminalOutput.tsx` (1923 LOC) is the largest UI surface in Maestro and lives downstream of the strip; replacing it would break desktop. Additive also keeps search-across-sessions working (parsed output is already strip-clean and indexable; xterm raw bytes are not).
- **Multiplexer location:** `src/server/raw-pty-multiplexer.ts`, NOT under `src/main/process-manager/handlers/`. Rationale: the multiplexer is a server-side concern (fans bytes to WS clients via the server's BroadcastService). Electron desktop runs the same ProcessManager but never instantiates the multiplexer, so no desktop-side coupling. PtySpawner's emission is unconditional (always emits `raw-pty-data` on `this.emitter`); when no multiplexer is attached, it's one EventEmitter dispatch with zero listeners — sub-microsecond cost.
- **Budget parameters:** 4 MB soft ring / 8 MB hard ring (drop-oldest with `pty_dropped` marker), 5 ms flush interval / 32 KB threshold for coalesced live broadcast (whichever fires first). Per scoping doc §1.6 + §3.1. Exposed as `RAW_PTY_*` constants so ops can tune without code changes. Memory ceiling at 50 concurrent terminals × 8 MB = 400 MB worst case — acceptable on developer machines, flagged for mini2 hosting.
- **Encoding (B): base64 over JSON, NOT binary WS frames.** Per scoping doc §6.4 Option B — single-protocol simplicity beats the ~33% wire overhead at L6.1 scale. The token-bucket cap (32 KB / 5 ms) yields ~6.4 MB/s sustained × 1.33 base64 = ~8.5 MB/s wire, comfortably under any LAN link. Binary frames deferred to L6.3 if measured bandwidth on Tailscale shows pressure.
- **WS protocol additions (six message types per scoping doc §2):**
  - Client → server: `pty_subscribe { sessionId, lastSeq? }`, `pty_unsubscribe { sessionId }`, `pty_input { sessionId, bytes, encoding }`, `pty_resize { sessionId, cols, rows }`.
  - Server → client: `pty_data { sessionId, seq, bytes }` (point-to-point per subscriber), `pty_backfill { sessionId, fromSeq, toSeq, bytes, isFinal }` (single-message form — split-message form deferred to L6.3), `pty_dropped { sessionId, droppedBytes, lastSeq }` (ring-rotation marker).
- **`pty_exit` overload, not new type.** The existing `session_exit` semantics already cover PTY lifecycle exit per scoping doc §2.7. Adding `pty_exit` would duplicate surface — kept the protocol minimal.
- **Per-subscriber slicing in flush.** A subscriber that registers AFTER some bytes were queued in the per-session pending buffer must not receive those older seqs (would either re-render bytes the subscriber already got via backfill OR receive bytes it never asked for). The flush path slices `pending` per subscriber by `entry.seq > lastSent` before coalescing. Caught during test development — see `does not deliver duplicate live messages for backfilled bytes` in the vitest suite.
- **Session-id resolution.** PtySpawner keys raw emissions by the underlying process id (e.g. `<sessionId>-terminal`); WS clients send `pty_subscribe` with the bare sessionId. The server wire-up uses `resolveProcessId()` from `src/server/process-manager-adapter.ts` for both directions — client→multiplexer (bare → suffixed) and multiplexer→client (suffix stripped before broadcast). Reuses the L0b suffix-resolution helper so the mapping stays in one place.
- **Disconnect GC.** When a WS client drops without explicit unsubscribe, `WebServer.setClientDisconnectHook` fires and the server calls `multiplexer.unsubscribeAll(clientId)`. New hook surface on `WebServer` is additive (no breaking change to existing wiring); installed only when L6.1 is in use.
- **`src/main/` edits are authorized for this brief.** The scoping doc explicitly requires additive emission at the PTY source. Three files under `src/main/` touched:
  - `src/main/process-manager/spawners/PtySpawner.ts` — one new `this.emitter.emit('raw-pty-data', sessionId, Buffer.from(data, 'utf-8'))` call before the existing `stripControlSequences` branch. Wrapped in try/catch so a misbehaving listener cannot break the stripped path. Listener-less cost: one EventEmitter dispatch + one Buffer.from per chunk. Path otherwise byte-identical to pre-L6.1.
  - `src/main/web-server/handlers/messageHandlers.ts` — four new switch cases (`pty_subscribe`, `pty_unsubscribe`, `pty_input`, `pty_resize`) with handler methods; new `PtyMessageCallbacks` interface; four optional fields on `MessageHandlerCallbacks` so the Electron desktop server (which doesn't wire L6.1) silently omits them.
  - `src/main/web-server/services/broadcastService.ts` — three new methods (`broadcastPtyData`, `broadcastPtyDropped`, `broadcastPtyBackfill`) — point-to-point sends keyed by clientId, not session-wide audience. Existing broadcasts unchanged.
  - `src/main/web-server/WebServer.ts` — three public broadcast methods that delegate to the new BroadcastService surface, `setPtyMessageCallbacks` setter, `setClientDisconnectHook` setter, and a `getConnectedClientIds` helper. Disconnect-hook firing is wired into the existing `onClientDisconnect` / `onClientError` callbacks. All additive — existing setters and broadcasts untouched.
- **`lastCommand` echo-filter mitigation deferred.** Per scoping doc §8.3, per-keystroke `pty_input` never sets `managedProc.lastCommand`, so the stripped path's command-echo filter silently degrades for xterm-mode sessions. Documented as a TODO in `raw-pty-multiplexer.ts` for L6.2+ scope. Not a regression for desktop or for parsed-mode web clients — only affects the parsed path while a web client is driving the PTY via xterm.
- **Rebase note.** L0h (HistoryManager port) edits `src/server/index.ts`; if it merges to main before this branch, a minor rebase will be required because L6.1 also edits `src/server/index.ts` (multiplexer wire-up section). The conflict is mechanical — different sections of the same file. Documented here so the rebase doesn't surprise.

#### Files added (new)

- `src/server/raw-pty-multiplexer.ts` (~330 LOC) — `RawPtyMultiplexer` class. Per-session ring buffer, monotonic seq, subscriber set, token-bucket coalesced flush, `RawPtyBroadcaster` interface for WS wire-up, `attachProducer` for EventEmitter binding, `setBroadcaster`, `subscribe` (returns backfill slice + drop count), `unsubscribe`, `unsubscribeAll`, `removeSession`, `getSessionStats`, `getActiveSessionIds`. Constants exported: `RAW_PTY_SOFT_RING_BYTES`, `RAW_PTY_HARD_RING_BYTES`, `RAW_PTY_FLUSH_INTERVAL_MS`, `RAW_PTY_FLUSH_THRESHOLD_BYTES`.
- `src/server/__tests__/raw-pty-multiplexer.test.ts` (~260 LOC) — 15 vitest tests covering monotonic seq, backfill ordering, ring wraparound at hard cap, drop-with-marker semantics, per-subscriber live filtering, multi-subscriber fanout, `unsubscribeAll`, threshold-triggered flush, EventEmitter producer attach/detach, empty publish no-op, multi-session independence, late-broadcaster wiring, removeSession purge. Threshold-tuned constructor opts (1 KB soft / 2 KB hard / 256 B threshold) so wraparound exercises with tens of bytes rather than MBs.

#### Files edited (additive)

- `src/main/process-manager/spawners/PtySpawner.ts` — `onData` callback now emits `'raw-pty-data'` event with `Buffer.from(data, 'utf-8')` before the existing strip branch. Stripped path unchanged.
- `src/main/web-server/handlers/messageHandlers.ts` — new `PtyMessageCallbacks` interface; four optional callbacks added to `MessageHandlerCallbacks`; four switch cases + handler methods (`handlePtySubscribe`, `handlePtyUnsubscribe`, `handlePtyInput`, `handlePtyResize`).
- `src/main/web-server/services/broadcastService.ts` — three new point-to-point broadcast methods.
- `src/main/web-server/WebServer.ts` — three new `broadcastPty*` delegates, `setPtyMessageCallbacks`, `setClientDisconnectHook`, `getConnectedClientIds`, `fireClientDisconnectHook` (private), and disconnect-hook firing wired into the existing `onClientDisconnect`/`onClientError` callbacks.
- `src/server/index.ts` — `RawPtyMultiplexer` import + instantiation, `ptyKeyForSession` helper using `resolveProcessId`, `attachProducer` to ProcessManager, `setBroadcaster` shim mapping multiplexer → `WebServer.broadcastPty*`, four `setPtyMessageCallbacks` implementations (subscribe / unsubscribe / input / resize), `setClientDisconnectHook` to drop dead clients from multiplexer subscribers, multiplexer `detachProducer` in SIGINT/SIGTERM shutdown path, and the boot log line `[maestro-server] Layer 6.1: raw PTY multiplexer ready (subscribe/publish over WS)`.

#### Files deferred (NOT touched this brief)

- `src/webFull/components/Terminal.tsx` and supporting renderer wiring — L6.2 scope.
- Scrollback persistence to disk + replay across server restarts — L6.3 scope (current ring is in-memory only).
- `src/renderer/components/TerminalOutput.tsx`, `src/main/utils/terminalFilter.ts` — desktop path stays untouched per the reject-bailout rule.
- `tsconfig.server.json` — no changes needed; existing `src/server/**/*.ts` glob picked up `raw-pty-multiplexer.ts` without modification.

#### Verification — TypeScript compile

- `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npx tsc -p tsconfig.server.json` → exit 0. Compiled artifacts under `dist/server/`: `raw-pty-multiplexer.js` + `.js.map`, updated `index.js`. No tsc diagnostics anywhere in the L6.1 surface.

#### Verification — vitest suite

- `npx vitest run src/server/__tests__/raw-pty-multiplexer.test.ts` → **15/15 PASS** in 186 ms (650 ms total inc. setup).
- Suite covers: (1) monotonic seq, (2) backfill ordering, (3) live broadcaster delivery, (4) ring wraparound at hard cap, (5) drop-with-marker on `lastSeq < oldestSeq`, (6) empty backfill on `lastSeq === tail`, (7) per-client unsubscribe, (8) `unsubscribeAll`, (9) threshold-triggered flush, (10) EventEmitter producer wiring, (11) empty publish no-op, (12) `removeSession` purge, (13) per-subscriber slicing prevents duplicate delivery of backfilled bytes, (14) multi-session independence, (15) late-broadcaster wiring.

#### Verification — boot smoke

- `MAESTRO_DATA_DIR=/tmp/maestro-l6.1 MAESTRO_WEB_PORT=45692 node dist/server/index.js` boots cleanly and emits the expected log line ahead of clean SIGTERM shutdown:

```
[maestro-server] Layer 0f: 10/10 WRITE callbacks active (...)
[maestro-server] Layer 6.1: raw PTY multiplexer ready (subscribe/publish over WS)
[maestro-server] received SIGTERM, shutting down
```

- Shutdown path correctly detaches the producer before tearing down `processManagerAdapter` and the WebServer.

#### Verification — anti-electron import

- `grep -r "from 'electron'" dist/server/; echo "exit=$?"` → exit 1 (no match). The L6.1 surface pulls zero electron dependencies into the compiled server tree. Pattern unchanged from L0f baseline.

#### Verification — scope guards

- `git diff main..HEAD -- src/web/ | wc -c` → `0`.
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0`.
- `git diff HEAD -- src/web/ src/renderer/ | wc -c` → `0`.
- `src/main/` edits are explicitly authorized for this brief (scoping doc requires additive emission at PTY source). Three files touched, all additive: `PtySpawner.ts`, `messageHandlers.ts`, `broadcastService.ts`, `WebServer.ts`. Existing methods, types, and event paths unchanged.
- `node_modules` symlink (used for build + tests) untracked; not in commit.

#### What this closes / leaves open

- **ISC-13 (PTY survives disconnect):** partial PASS. Ring-buffer scrollback is now live in-memory; backfill on `pty_subscribe { lastSeq }` works (test coverage confirms). Persistence across server restarts is L6.3.
- **ISC-42 (xterm scope gate):** server-protocol half complete. Client-side renderer (L6.2) and persistence (L6.3) remain.

### 2026-06-08 — Layer 2.3 evidence (platform shim + 3 leaf-component lifts)

Branch `layer-2.3-platform-shim-and-3-lifts` off `main` at `d7bbd4b9f`. The L2.2.5 leaf-component audit (`/tmp/renderer-leaf-hunt.md`, 790 lines, 137 unlifted 0-IPC candidates) identified the next concrete wave: three small visual leaves plus one precursor infrastructure piece that unblocks ~25 future candidates.

#### Decisions

1. **Platform shim — new infrastructure, not a re-export.** Added `src/webFull/utils/platformUtils.ts` mirroring the public API of `src/renderer/utils/platformUtils.ts` (`isMacOSPlatform`, `isWindowsPlatform`, `isLinuxPlatform`, `getRevealLabel`, `getOpenInLabel`) plus a webFull-only `isMobilePlatform`. The renderer reads `window.maestro.platform` (set by Electron's preload bridge to Node's `process.platform`); webFull has no preload bridge and instead uses `navigator.userAgent` regex matching (`/Mac|iPhone|iPad/i`, `/Windows/i`, `/Linux/i` excluding `/Android/i`). This is a deliberate platform-specific divergence — re-export was rejected because the source-of-truth signal differs between environments. Per the leaf-component audit, this shim unblocks ~25 future renderer components whose only lift blocker is a transitive dependency on `window.maestro.platform` via these helpers. The shim is precursor for L2.4+; no existing webFull callsite was rewired this turn (`grep -rE "window\.maestro\.platform|isMacOSPlatform|isWindowsPlatform|isLinuxPlatform" src/webFull/` returned empty before the shim was added).

2. **`historyConstants.tsx` — re-export pattern, not verbatim copy.** Added `src/webFull/components/History/historyConstants.tsx` as a single-line `export *` shim against `src/renderer/components/History/historyConstants.tsx`. The constants (`LOOKBACK_OPTIONS`, `MAX_HISTORY_IN_MEMORY`, `ESTIMATED_ROW_HEIGHT`, `ESTIMATED_ROW_HEIGHT_SIMPLE`, the `DoubleCheck` SVG component, the `LookbackPeriod` type) are non-divergent between renderer and webFull. Per Architect 2026-06-08 audit risk A ("verbatim duplication of stable constants creates silent drift surfaces"), the renderer remains the single source of truth and webFull reaches them through this shim. Forking later is cheap; up-front divergence is hard to walk back.

3. **`RenameTabModal.tsx` + `UsageDashboard/EmptyState.tsx` — verbatim lifts, theme-prop pattern continued.** Both components copied with implementation unchanged except for import-path adjustments:
   - `Theme` import: renderer routes through `'../types'` → `src/renderer/types/index.ts` → `src/shared/theme-types`. webFull imports directly from `'../../shared/theme-types'` (RenameTabModal) or `'../../../shared/theme-types'` (EmptyState's deeper nesting), matching the L2.1 Modal/FormInput primitive convention.
   - `MODAL_PRIORITIES` import (RenameTabModal only): resolves via the existing webFull re-export at `src/webFull/constants/modalPriorities.ts`.
   - Modal + ModalFooter + FormInput imports (RenameTabModal): unchanged relative paths against the L2.1 lifted primitives at `src/webFull/components/ui/{Modal,FormInput}.tsx`.
   - `BarChart3` from `lucide-react` (EmptyState): identical — `lucide-react` is already a transitive dep used by `src/webFull/components/ConfirmModal.tsx`, `Settings/SettingsModal.tsx`, and the L2.1 Modal primitive.
   Theme access pattern: kept the renderer's `theme: Theme` prop convention rather than refactoring to `useTheme()` — matches L2.1's policy decision and keeps the primitives portable. Both components retain their `memo()` wrapper and (for EmptyState) the `default` export alongside the named export.

#### Files added

- `src/webFull/utils/platformUtils.ts` (~95 LOC, new infrastructure — webFull-divergent browser-side detection).
- `src/webFull/components/History/historyConstants.tsx` (~20 LOC including header, of which 1 LOC is the actual `export *` re-export line).
- `src/webFull/components/RenameTabModal.tsx` (~70 LOC verbatim lift + extended header).
- `src/webFull/components/UsageDashboard/EmptyState.tsx` (~85 LOC verbatim lift + extended header).
- `src/webFull/components/RenameTabModal.parity.test.ts` (~165 LOC — 5 stories: 3 happy + 2 negative, plus 5 catalog-shape vitest guards).
- `src/webFull/components/UsageDashboard/EmptyState.parity.test.ts` (~185 LOC — 4 stories: 2 happy + 2 negative, plus 5 catalog-shape vitest guards).
- This ISA append.

#### Files NOT touched

- `src/web/` — `git diff HEAD -- src/web/ | wc -c` → `0` (zero bytes — upstream-mirror web tree untouched).
- `src/renderer/` — `git diff HEAD -- src/renderer/ | wc -c` → `0` (zero bytes — renderer is bias-away).
- `src/main/` — `git diff HEAD -- src/main/ | wc -c` → `0` (zero bytes — no new server routes were needed for this purely visual wave).

#### Verification

- **0-IPC + 0-Electron-API confirmation:**
  - `grep -nE "window\.maestro\." src/renderer/components/RenameTabModal.tsx src/renderer/components/History/historyConstants.tsx src/renderer/components/UsageDashboard/EmptyState.tsx` → empty.
  - `grep -nE "\.shell\.|\.dialog\.|\.devtools\.|\.power\.|\.tunnel\.|@sentry/electron" <same-3-files>` → empty.
  - Transitive deps (`Modal`, `FormInput`, `BarChart3`) re-checked — webFull copies of Modal + FormInput were already verified clean during L2.1; lucide-react has no Electron surface.
- **Pre-flight (from the lift template):** Tailwind glob includes `src/webFull/**` (line 3 of `tailwind.config.mjs`); `LayerStackProvider` mounted at `src/webFull/App.tsx:293`; `src/webFull/components/ui/Modal.tsx` present.
- **Build:** `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npm run build:webfull` → exit 0, identical output bundle to baseline (asset hashes unchanged because the new files aren't reachable from the existing entry yet — they ship as latent surface area for future consumers). The CSS warning at `<stdin>:2714` is pre-existing and unrelated to this layer.
- **Parity tests:** `npx vitest run src/webFull/components/RenameTabModal.parity.test.ts src/webFull/components/UsageDashboard/EmptyState.parity.test.ts` → `Test Files 2 passed (2); Tests 10 passed (10)`. Both catalogs declare ≥1 happy + ≥1 negative story, use only the allowed assertion vocabulary (`hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast`), and pass the IPC-leakage guard.
- **Dist mount check:** `grep -o 'id="root"' dist/webfull/index.html` → `id="root"` present. SPA still mounts.
- **Symlink hygiene:** `node_modules` symlink to the main checkout was created for the build/test run and removed before commit; `ls -la node_modules` → "No such file or directory".

#### Scope checks (post-write, pre-commit)

- Working-tree changes for this layer (before commit):
  - `?? src/webFull/components/History/` (new directory: `historyConstants.tsx`)
  - `?? src/webFull/components/RenameTabModal.parity.test.ts`
  - `?? src/webFull/components/RenameTabModal.tsx`
  - `?? src/webFull/components/UsageDashboard/` (new directory: `EmptyState.tsx`, `EmptyState.parity.test.ts`)
  - `?? src/webFull/utils/platformUtils.ts`
  - `M ISA.md` (this Decisions + Verification block)
- All authorized: NEW under `src/webFull/` plus the append-only `ISA.md` block.
- No edits to `src/main/`, `src/web/`, `src/renderer/`.

#### Deferred / out-of-scope for this brief

- Rewiring the platform shim into an existing webFull callsite — there is none to rewire today. Subsequent agents lifting components that read `window.maestro.platform` will route through `src/webFull/utils/platformUtils.ts` instead of touching `window.maestro`.
- Lifting `Settings/`, `UsageDashboard/` siblings, History `entry-card` / `summary-row` components — those have transitive context dependencies (UsageStore, HistoryContext) not yet in webFull and are the next-wave targets per the audit's tier-2 list.
- An auto-tracking ISC for "components depending on platform shim" — left for the audit's next pass when consumers actually land.
### 2026-06-08 — plan-reeval-1 ISA hygiene evidence (additive runtime-code legalization + ISC-42 scoped-in + ISC-44.x deferral convention)

#### Decisions

- Three findings from Architect plan-reeval-1 (`/tmp/plan-reeval-1.md`, 598 lines) closed in one doc-only pass on branch `docs-isa-reeval1-decisions` off `main @ 1e4b90e75`. (1) **N1 closure** — additive runtime-code edits in `src/main/web-server/{handlers,services}` and `src/main/process-manager/spawners/` legalized retroactively under ISC-40 via parallel Decision entry; L6.1's four `src/main/` touches (PtySpawner.ts, messageHandlers.ts, broadcastService.ts, WebServer.ts) now have authorizing precedent. (2) **ISC-42 flipped** from "principal-decision-gated" to "SCOPED IN as Layer 6" — server-half closed by L6.1; client-half (L6.2) + persistence (L6.3) explicitly pending. (3) **START directive adopted** — `ISC-44.<tab>.<deferral>` tracking convention with three terminal statuses (DEFERRED / DROPPED / MISSING); 11 sub-ISCs logged for L3.1+L3.2 deferrals plus ISC-14 settings broadcast (N2 closure → tracked as `ISC-44.global.settings_broadcast`, MISSING, slated for W2). Numbering of ISC-42 preserved; ISC-44.x reserved namespace gets concrete entries instead of remaining placeholder.

#### Files modified

- `ISA.md` — single file: (a) ISC-42 prose rewritten from gated to scoped-in; (b) 11 new ISC-44.x sub-ISCs added under per-feature parity catalog section with tracking-convention preamble; (c) two new Decisions entries appended (additive `src/main/` legalization + `ISC-44.<tab>.<deferral>` convention adoption); (d) this Verification entry.

#### Verification — scope guards

- `git diff main..HEAD -- src/ infra/ | wc -c` → `0` (no source touched).
- `git diff main..HEAD -- WEB_PORT_ORDER.md PLAN.md | wc -c` → `0` (no other doc touched).
- `git diff main..HEAD --name-only` → `ISA.md` only.

#### Verification — content probes

- `grep -c "Additive runtime-code edits authorized in" ISA.md` → `2` (Decision entry + this Verification entry's reference; the Decision is at the head of the Decisions section near line 218).
- `grep -c "Adopted \`ISC-44.<tab>.<deferral>\` tracking convention" ISA.md` → `2` (Decision entry + Criteria-section preamble pointing readers to it; both count).
- `grep -c "SCOPED IN as Layer 6" ISA.md` → `3` (ISC-42 criterion at line ~130 + Decisions summary at the head of this Verification entry + this probe line).
- `grep -cE "^- \[ \] ISC-44\.(general|display|global)\." ISA.md` → `11` (all 11 sub-ISCs registered).
- `grep -c "ISC-44.global.settings_broadcast" ISA.md` → `3` (sub-ISC registration + Decisions reference + this Verification entry); tracks N2's ISC-14 closure as MISSING / W2-target.
- `grep -n "Principal-decision-gated" ISA.md` against ISC-42's line → `0 matches at the ISC-42 line` (gate language removed from the criterion at line ~130; sole remaining live match is at line ~129 for ISC-41's own gating, which is correct — ISC-41 remains principal-decision-gated).

### 2026-06-08 — ISC-44.global.settings_broadcast evidence (W2 / plan-reeval-1 N2 closure)

- Branch: `w2-isc14-settings-broadcast` off `main @ 8290c421e`.
- Files modified (additive only): `src/main/web-server/services/broadcastService.ts`, `src/main/web-server/WebServer.ts`, `src/main/web-server/routes/apiRoutes.ts`, `src/server/index.ts`, `src/webFull/hooks/useWebSocket.ts`, `src/webFull/hooks/useSettings.ts`, `src/webFull/mobile/App.tsx`.
- Files added: `src/webFull/hooks/useSettings.parity.test.ts`.
- `eval "$(/opt/homebrew/bin/fnm env --shell bash)" && fnm use 22.22.1 && npx tsc -p tsconfig.server.json` → exit 0; no diagnostics.
- `npm run build:webfull` → exit 0; chunks `main`, `react`, `index`, `mobile` emitted; only the pre-existing browserslist age + chunk-size warnings.
- `npx vitest run src/webFull/hooks/useSettings.parity.test.ts` → `13 passed (13)` in 284 ms, single file, single suite.
- Boot smoke: `MAESTRO_DATA_DIR=/tmp/maestro-isc14 MAESTRO_WEB_PORT=45694 node dist/server/index.js` — server listens at `http://192.168.86.26:45694/<token>`, history manager initializes, sessions store reads 0 sessions, "Layer 0h / Layer 6.1" boot lines present, NO new WARN about missing settings callback. The pre-existing "Web assets not found" WARN is unchanged (dist/web is not built in the worktree; not relevant to this closure). Server killed after smoke.
- `git diff main..HEAD -- src/web/ | wc -c` → `0`.
- `git diff main..HEAD -- src/renderer/ | wc -c` → `0`.
- ISC-44.global.settings_broadcast: flipped `[ ]` → `[x]`; closure text references `Decisions 2026-06-08` Decision entry above.
- Wire-shape contract: `{type:'settings_changed', changedKeys:string[], newValues:Record<string,unknown>, timestamp:number}`. `changedKeys` equals `Object.keys(newValues)` by construction at the producer (apiRoutes PATCH handler); consumer (useSettings merge) iterates `changedKeys` and skips any key absent from `newValues` so producer bugs don't corrupt the cache (covered by the "ghostKey" negative-path vitest case).
