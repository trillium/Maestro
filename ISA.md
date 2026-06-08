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

> **DRAFT.** Background research agent is producing `WEB_CONVERSION_ASSESSMENT.md` with the full IPC inventory, native-module map, and tiered effort estimate. The granular ISCs (target ≥128 at E4) will be appended when that report lands. Initial scaffold below covers the load-bearing structural criteria.

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
- [ ] ISC-42: **Principal-decision-gated.** Either accept "no real PTY rendering in browser; only parsed/structured output via existing MessageHistory" OR scope adding xterm.js + raw-byte WS multiplex (the single hardest feature; Layer 4 in `WEB_PORT_ORDER.md`).
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

Every feature ported into `src/webFull/` gets a parity catalog at `src/webFull/<feature>/parity.test.ts` per `WEB_PARITY_VERIFICATION.md`. The catalog is recorded against Electron at `localhost:9222` (the reference oracle), replayed against webFull at `localhost:5176`, and must pass on both. The allowed assertion types are `hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast` — see `WEB_PARITY_VERIFICATION.md` for the full vocabulary and the standing "catalog is the spec, not the renderer source" rule. Per-feature ISCs will land in this ISA at the time each port commits, formatted as: `ISC-44.x: <feature-name> parity catalog passes against both Electron and webFull, ≥N stories, including ≥1 negative-path story per happy-path story`.

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
- **2026-06-07** — refined: Initial ISC count is 40 (well below E4 ≥128 floor). Reason: granular per-IPC-channel and per-native-module ISCs require the background agent's inventory of `src/main/web-server/web-server-factory.ts` IPC channels and the native-module callsite list. Floor will be revisited when `WEB_CONVERSION_ASSESSMENT.md` lands; new ISCs append as `ISC-N.M` per ID-stability rule, never re-number.
- **2026-06-07** — Substantial web target already exists upstream: `src/web/`, `src/main/web-server/{WebServer.ts, web-server-factory.ts, routes/{api,static,ws}Routes.ts}`, Fastify on port 45678, `vite.config.web.mts` proxying `/api` and `/ws`. This means conversion is more "decouple the server from `app.whenReady`" than "build a server from scratch." Adjusted PLAN scope accordingly.
- **2026-06-07** — `AskUserQuestion` tool will NOT be used to ask Trillium to pick Tier 1 vs Tier 2; per his standing feedback, the agent presents the plan in prose and stops, letting him redirect.
- **2026-06-07** — Plan-Means-Stop: this ISA-establishing run completes at PLAN. EXECUTE/BUILD does not start until Trillium reviews the tiered plan and approves a first probe.
- **2026-06-07** — Fork-hygiene decision: duplicated `src/web/` → `src/webFull/` (71 files, 1.1 MB). All "grow the web bundle to desktop-class features" work happens in `src/webFull/`; `src/web/` stays a verbatim mirror of upstream so `git pull upstream main` is mechanical. Trade-off: the two trees will diverge — any UX work the upstream maintainer does on `src/web/` will need to be cherry-picked into `src/webFull/`, not auto-inherited. Accepted because Trillium is explicitly aiming for a different product (desktop-equivalent web), not the upstream mobile-companion.
- **2026-06-07** — Background agent's `WEB_CONVERSION_ASSESSMENT.md` (~14 KB) materially changed the picture. Key new findings: (1) shipped web bundle is mobile-remote-control, not full Maestro; (2) `src/cli/` is electron-free, proving Node-only execution path is structurally already there; (3) 303 `ipcMain.handle` channels across 30 files but web client has ZERO direct IPC (talks only HTTP/WS via token-in-URL); (4) `tunnel-manager.ts` (Cloudflare tunnel) already exists upstream and proves the "browser-from-anywhere" mental model is precedented; (5) no xterm.js anywhere in renderer — PTY-in-browser is a separate sub-project. **New Tier 0 ("use what's there") added to plan** — run upstream Electron headless on mini2, expose existing dashboard URL over Tailscale. May be the right first answer.
- **2026-06-07** — All time estimates stripped from this ISA and the support docs per principal's standing instruction. Plan is ordered by dependency, not by duration. Logical port order lives in `WEB_PORT_ORDER.md`. See feedback memory `feedback_no_time_estimates`.
- **2026-06-07** — **Delegation-first execution model adopted.** Trillium's framing: this whole port project is delegate-able because we have a working Electron app as a golden reference. Per-feature agents read `src/renderer/<surface>`, drive both Electron (via CDP at `localhost:9222`) and `src/webFull/` (via Vite dev server) side-by-side, port the UI to talk to the existing WS protocol, and verify by comparing observed behavior. Each agent runs in a worktree-isolated branch. Layer 0 from `WEB_PORT_ORDER.md` must complete BEFORE the delegation pipeline starts — agents need a vanilla-Node server entrypoint to run their builds against. After Layer 0, Layers 1-9 fan out cleanly: most features within a layer have no inter-feature dependencies and can run in parallel agents. The delegation harness itself (per-feature agent contract, comparison loop, merge protocol) is the next concrete artifact to design once Layer 0 work begins.
- **2026-06-07** — **Function parity is the verification bar, not structural/protocol parity.** Methodology lives in `WEB_PARITY_VERIFICATION.md`: every feature port ships with a user-story catalog of (`Given`, `When`, `Then`) triples; assertions use a fixed vocabulary (`hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast`) that's deliberately layout-independent; the catalog is recorded against the running Electron app (the test oracle) and replayed against webFull; pass criteria = every catalog story passes on both targets. Pixel-perfect, DOM-identical, and CSS-identical parity are explicitly rejected as the wrong bar. The catalog IS the spec — not the renderer source — to protect against agent hallucination and renderer-bug canonization.
- **2026-06-08** — **Layer 0a shipped: bootable headless server with read-only callbacks.** The Fastify+WebSocket server in `src/main/web-server/WebServer.ts` now boots from a vanilla Node entrypoint (`src/server/index.ts`) with no `electron` import in the runtime path. What landed: (1) `src/shared/data-dir.ts` — dual-mode userData resolver that returns `app.getPath('userData')` under Electron else `MAESTRO_DATA_DIR ?? ~/.config/maestro` (covers ISC-29); (2) `src/shared/file-store.ts` — `electron-store`-shape JSON file store that preserves on-disk schema so a desktop data dir is portable into headless mode (covers ISC-36); (3) `src/server/index.ts` — entrypoint that constructs `WebServer`, wires READ callbacks (`getSessions`, `getSessionDetail`, `getTheme`, `getBionifyReadingMode`, `getCustomCommands`, `getHistory` — the last stubbed to `[]` pending HistoryManager port) to file-backed stores; WRITE callbacks (`writeToSession`, `executeCommand`, `interruptSession`, `switchMode`, `selectSession`, `selectTab`, `newTab`, `closeTab`, `renameTab`, `starTab`, `reorderTab`, `toggleBookmark`) log a warning and return `false`; (4) `tsconfig.server.json` — server-only TS build (rootDir `src`, outDir `dist`) so `dist/server/index.js` is the runnable artifact; (5) `package.json` scripts `build:server` + `start:web`. **Upstream files touched:** zero — every change is in NEW files (`src/server/`, `src/shared/`, `tsconfig.server.json`) plus a two-line `package.json` scripts addition.
- **2026-06-08** — **Layer 0b shipped: write/interrupt/execute callbacks wired via ProcessManager.** `src/server/process-manager-adapter.ts` (108 LOC) instantiates a single `ProcessManager` at server startup; `src/server/index.ts` routes `setWriteToSessionCallback` / `setExecuteCommandCallback` / `setInterruptSessionCallback` through it. Suffix logic (`-ai` / `-terminal`) mirrors `src/main/web-server/web-server-factory.ts` lines 248-272 verbatim — the adapter reads the live sessions store on every call (lookup closure), matches by `s.id`, and resolves `inputMode === 'ai' ? '${id}-ai' : '${id}-terminal'`. ProcessManager confirmed electron-free (grep across `src/main/process-manager/`, `src/main/parsers/`, `src/shared/` returned zero `from 'electron'` hits). `tsconfig.server.json` `include` widened to add `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts`; build still emits cleanly and `grep -r "from 'electron'" dist/server/` stays empty. **Out of scope (still stubbed, deferred to Layer 0c):** `switchMode`, `selectSession`, `selectTab`, `newTab`, `closeTab`, `renameTab`, `starTab`, `reorderTab`, `toggleBookmark` — these need write-back to the sessions store and WebSocket broadcast plumbing. `executeCommand`'s "spawn new session if none exists" semantics also deferred — full session-creation flow lives in the renderer today and needs a server-side port plus a UI surface in Layer 3.
- **2026-06-08** — **Layer 1.1 shipped: `vite.config.webfull.mts` sibling config + dev/build scripts.** Pattern: a parallel Vite config file (sibling to `vite.config.web.mts`) drives the `src/webFull/` divergent tree without touching `vite.config.web.mts`, `tsconfig.json`, or any file under `src/web/`. Surgical changes from the original: `root` and `publicDir` repointed to `src/webFull/` (+ `src/webFull/public/`); `outDir` → `dist/webfull/`; dev port 5174 → 5176, preview 5175 → 5177 (both `strictPort: true`); `@web` alias re-pointed at `src/webFull` so any import that resolves through the alias stays inside the webfull tree (no new `@webfull` alias added — keeping import sites stable across the two trees). All other settings (`define`, `esbuild`, build target, manualChunks logic, css, optimizeDeps, proxy) carried over verbatim. The `mobile/` and `desktop/` path-based chunk naming continues to work because `src/webFull/` was forked verbatim from `src/web/`. Files touched: NEW `vite.config.webfull.mts`; 2-line scripts addition in `package.json` (`dev:webfull`, `build:webfull`). NOT added to the aggregate `build` script — that stays upstream-compatible. No edits to `src/web/`, `vite.config.web.mts`, or `tsconfig.json`. Plumbing only — subsequent web-UI port agents now have a `src/webFull/` build target to land against.
- **2026-06-08** — **mini2 deploy spike pre-staged in `infra/` directory.** The Architect's 2026-06-08 audit flagged the mini2 deploy story as the most underspecified part of the plan and pointed out it is the actual Vision target (a Tailscale-reachable Maestro server running on `mini2`). This commit pre-stages the artifacts so the first real deploy is one command, not a debugging expedition. Three files land under a new `infra/` directory at the repo root: (1) `infra/DEPLOY_SPIKE.md` — Trillium-readable runbook covering prerequisites on mini2 (Tailscale, Node 22.x via fnm, Python 3.11 for `node-gyp`, Xcode CLT), one-time setup (clone path `~/code/maestro`, `npm install`, `npm run build:server`, verify-and-edit plist, bootstrap launchd), the steady-state deploy sequence (`./infra/deploy.sh`), four post-deploy verification checks (service state, loopback HTTP, Tailscale HTTP, browser load), data-dir backup/restore commands, log location, rollback procedure, and six explicit open questions for the first real run; (2) `infra/com.maestro.server.plist` — launchd LaunchAgent (not LaunchDaemon — runs as Trillium's user, no privileged listener) with `KeepAlive=true`, `RunAtLoad=true`, `ProcessType=Background`, `ThrottleInterval=10`, env vars wired (`MAESTRO_DATA_DIR=~/.config/maestro`, `MAESTRO_WEB_PORT=45678`, `NODE_ENV=production`, `PATH` including the fnm Node prefix), and stdout/stderr piped to `~/Library/Logs/maestro/`; (3) `infra/deploy.sh` — executable git pull + `npm ci` (fallback `npm install`) + `npm run build:server` + `launchctl bootout` + `launchctl bootstrap` + 3-second sleep + curl health probe + error-log tail on failure. The plist hard-codes the absolute node path (`/Users/trillium/.local/share/fnm/node-versions/v22.22.1/installation/bin/node`) with a TODO comment block at the top of the file documenting that the path needs verification on mini2 because launchd does not expand `$HOME` or PATH lookups in `ProgramArguments`. **NOT executed in this commit** — the agent authoring this does not have access to mini2. Trillium runs the first real deploy manually and reports findings back via a follow-on Decisions entry. **Six open questions surfaced for the first run:** Q1 data-dir migration from existing Electron `maestro-dev/` (untested per the audit); Q2 `customSyncPath` not consulted by `src/shared/data-dir.ts` so the server silently reads the wrong directory if Trillium has set it in Electron; Q3 exact fnm Node binary path on mini2; Q4 deploy-tag convention for rollback (`git tag deploy-...` in `deploy.sh` or `git reflog`?); Q5 `postinstall` electron-rebuild behavior on a host that never runs Electron; Q6 Tailscale port-exposure model (`0.0.0.0:45678` bind verified mini2-safe because no public IPv4, but should it be locked to the Tailscale interface?). **Files touched in this turn:** three NEW files under `infra/` plus this Decisions entry + the Verification entry below in `ISA.md`. **No source touched** — `git diff main..HEAD -- src/web/ | wc -c` and `git diff main..HEAD -- src/main/ | wc -c` both 0.
- **2026-06-08** — **`WEB_PORT_ORDER.md` restructured for primitives-first lift strategy.** The doc was rewritten on branch `docs-port-order-lift-first` to reflect findings from `/tmp/web-ui-lift-scope.md` (445-line lift audit). Three structural changes: (1) **inserted a new Layer 2 — Lift UI primitives** between the existing Layer 1 (webfull build target) and the existing Layer 2 (Identity + Settings). Layer 2 lifts `ui/Modal.tsx` (+ `LayerStackContext` + `useModalLayer` + `useLayerStack` + `MODAL_PRIORITIES`), `ui/FormInput.tsx`, `ui/EmojiPickerField.tsx`, `ConfirmModal.tsx`, and `GitStatusWidget.tsx` — all with 0 IPC and 0 Electron-only APIs per audit §B4. The Tailwind glob fix (`src/webFull/**` added to `tailwind.config.mjs:3`) is L1.2, a hard prerequisite for L2; (2) **renumbered subsequent layers** — old Layer 2 (Identity + Settings) → Layer 3; old Layer 3 (Create + Navigate) → Layer 4; old Layer 4 (xterm.js / raw-byte PTY) → Layer 6 and made explicitly scope-gated by ISC-42; History/AutoRun/Agents → Layer 7; Markdown/Files/Diffs → Layer 8; polish (LogViewer/About/ProcessMonitor/Sentry swap) → Layer 9; (3) **added a Lift-vs-Rewrite decision rule** as a top-level subsection: lift verbatim if 0 IPC ∧ 0 Electron-only API; rewrite-with-lifted-primitives if ≥1 IPC ∨ ≥1 Electron-only API; hybrid (lift JSX, rewrite hook) if 1–3 IPCs are isolated in one hook. Cites the audit's NOT-easy examples (`NewInstanceModal.tsx` 1822 LOC / 18 IPC, `GeneralTab.tsx` 1522 LOC / 17 IPC, `App.tsx` 3357 LOC) as canonical "rewrite, don't lift" cases. Also updated the IPC-substitution reference with the audit's one-line rule (`window.maestro.X.Y(args)` → `fetch('/${token}/api/X/Y', ...)` / POST / `useWebSocket()` subscription) and the 32-vs-886 server/renderer-surface imbalance the lift work compounds against. The "Working rule" at the top now reads "every layer item is built in `src/webFull/` and most items COMPOSE the primitives lifted in Layer 2 rather than re-lifting renderer components." **Cross-reference impact:** ISA.md line 129 (ISC-42) still reads "Layer 4 in `WEB_PORT_ORDER.md`" — the doc's Layer 6 self-notes the rename, but the ISA wording is intentionally left as-is per the brief's scope guard (the only ISA edit permitted in this turn was this Decisions append). When the ISC-42 scope decision is made, that line gets updated then; for now the layer-rename is one-line-documented at the bottom of `WEB_PORT_ORDER.md` Layer 6. **Files touched in this turn:** `WEB_PORT_ORDER.md` (new file at repo root reflecting the restructured plan) + this Decisions entry in `ISA.md`. No source touched.
- **2026-06-08** — **Drift fix: `MODAL_PRIORITIES` and `Layer` types in webFull converted from verbatim copies to re-exports from `src/renderer/`.** Architect's 2026-06-08 audit (risk A) flagged that L2.1 lifted `src/renderer/constants/modalPriorities.ts` and `src/renderer/types/layer.ts` into `src/webFull/constants/modalPriorities.ts` and `src/webFull/types/layer.ts` as byte-for-byte copies. Verbatim copies create silent-drift risk: any new modal priority or layer-kind added to the renderer source will fail to propagate, and TypeScript can't catch the mismatch because the two files are independent type sources. The drift-prevention pattern adopted: **for types/constants that are explicitly shared between renderer and webFull and have no semantic reason to diverge, the webFull file becomes a single-line `export * from '../../renderer/...';` re-export.** Rationale: (1) the rendering target is irrelevant — modal stacking semantics are determined by application logic, not by Electron-vs-browser; (2) the layer-stack discriminated union is a domain model, not a target-specific concern; (3) vite's resolver already handles cross-directory imports cleanly (webFull/vite config aliases `@renderer` to `src/renderer/`, and existing webFull files like `mobile/App.tsx`, `mobile/WebReadingContent.tsx`, `mobile/MobileMarkdownRenderer.tsx`, `mobile/SessionStatusBanner.tsx` already use `'../../renderer/...'` relative imports against `utils/contextUsage` and `utils/bionifyReadingMode` in production). tsconfig.json `include` covers `src/renderer` (the source) but NOT `src/webFull` — type-checking for webFull rides on vite/esbuild, not tsc, so the re-export resolves at bundle time without a tsc-level include change. **When to use this pattern:** the type/constant is named identically on both sides, the semantics are identical, divergence has no use case, and the audit/diff workflow would treat divergence as a bug. **When NOT to use:** anything that genuinely diverges (e.g. components with different DOM trees, hooks with different store dependencies, types with different optional fields). For divergent surfaces, the lift-and-adapt pattern from L2.1 remains correct. **Files touched:** `src/webFull/constants/modalPriorities.ts` (242 LOC of body replaced with 1 re-export line + 2 comment lines citing risk A), `src/webFull/types/layer.ts` (107 LOC of body replaced with 1 re-export line + 2 comment lines). No edits to `src/renderer/`, `src/web/`, `src/main/`, vite config, or tsconfig — the existing vite alias and resolver are sufficient. The renderer-side files remain the single source of truth; the webFull files are now derived artifacts that cannot drift by construction.
- **2026-06-08** — **Layer 2.1 shipped: visual primitives (Modal + FormInput + ConfirmModal) lifted from `src/renderer/` into `src/webFull/`, plus webFull added to Tailwind content glob.** This wave proves the lift-and-adapt pattern from the `/tmp/web-ui-lift-scope.md` audit by lifting the leaf-most visual atoms that have zero IPC and zero Electron API — subsequent feature ports now have UI building blocks already in `src/webFull/`. **Tailwind config:** one-line edit to `tailwind.config.mjs:3` adds `'./src/webFull/**/*.{js,ts,jsx,tsx}'` to the content array (the audit-flagged blocker — without it any Tailwind class in webFull files gets purged at build). This is the ONLY upstream-file edit in this wave; rationale for selecting it as the single allowed upstream edit: the content glob is the most rebase-stable part of a Tailwind config (Tailwind itself authoring guidance frames it as "add your source paths here"), so the rebase-conflict cost is minimal vs the alternative of leaving the bug in place and shipping broken CSS in production. **Lifted primitives (3 files):** `src/webFull/components/ui/Modal.tsx` (200 LOC), `src/webFull/components/ui/FormInput.tsx` (189 LOC), `src/webFull/components/ConfirmModal.tsx` (74 LOC). **Lifted supporting infra (the audit's "pre-flight" set — required because all three primitives transitively depend on the layer stack system, and webFull had no layer stack of its own yet):** `src/webFull/types/layer.ts` (108 LOC), `src/webFull/constants/modalPriorities.ts` (243 LOC), `src/webFull/hooks/useLayerStack.ts` (300 LOC), `src/webFull/contexts/LayerStackContext.tsx` (90 LOC), `src/webFull/hooks/useModalLayer.ts` (124 LOC). **Theme access pattern decision:** primitives keep the renderer's `theme: Theme` prop convention rather than calling `useTheme()` internally. Rationale per `/tmp/web-ui-lift-scope.md` A3: the renderer threads `theme` as a prop from `App.tsx` while webFull provides theme via `useTheme()` context, but the primitives themselves are tree-shape-agnostic — by accepting `theme` as a prop they work identically under either pattern. Consumers in webFull call `const { theme } = useTheme()` at the feature-component level and pass `theme` into the primitive; that keeps the primitive's diff vs the renderer source minimal (smaller rebase surface) and avoids coupling the primitive's signature to webFull's specific ThemeProvider. Trade-off accepted: feature consumers in webFull have one extra line of code vs reading theme from context directly inside the primitive. **Import path adapts (the only non-verbatim changes vs renderer source):** Modal.tsx — `Theme` from `'../../types'` became `'../../../shared/theme-types'` (webFull has no `types/index.ts` aggregator yet), and `useModalLayer` / `UseModalLayerOptions` from `'../../hooks'` became `'../../hooks/useModalLayer'` (webFull keeps `hooks/` flat; renderer routes through `hooks/ui/` barrel). FormInput.tsx — same `Theme` path adapt only. ConfirmModal.tsx — `Theme` from `'../types'` became `'../../shared/theme-types'`; everything else (Modal/ModalFooter import, MODAL_PRIORITIES import) stays at the same relative path. `useLayerStack.ts` — `Layer`/`LayerInput` import path from `'../../types/layer'` became `'../types/layer'` (webFull hooks/ is one level shallower than renderer hooks/ui/). `useModalLayer.ts` — `useLayerStack` from `'../../contexts/LayerStackContext'` became `'../contexts/LayerStackContext'`; `FocusTrapMode` from `'../../types/layer'` became `'../types/layer'`. `LayerStackContext.tsx` — `useLayerStack`/`LayerStackAPI` import from the renderer's `'../hooks'` barrel became a direct file import `'../hooks/useLayerStack'` (no barrel in webFull/hooks yet — direct imports keep the surface explicit until more hooks land). **Barrel exposure:** `src/webFull/components/index.ts` gained 8 lines re-exporting Modal/ModalFooter/FormInput/ConfirmModal (plus their prop types). This is an in-fork divergent-tree edit (NOT an upstream-tracked file — `src/webFull/` was forked specifically to support divergence), not counted as a second upstream-file edit. **Wiring deferred — LayerStackProvider not yet mounted in webFull/App.tsx:** the lifted primitives compile and are tree-shaken-only-because-no-feature-consumer-imports-them-yet; first feature port that lifts a modal will need to wrap the App tree in `<LayerStackProvider>` once (around `<ThemeProvider>` at `src/webFull/App.tsx:285`). That edit was scoped out of this wave because it's a runtime wiring change with no consumer yet to validate it. Documented here so the next port agent doesn't repeat the discovery. **No FAIL-OUT cases:** none of the three primitives transitively touched IPC, an Electron API, a Zustand store, or a context that didn't lift cleanly. The audit's predicted "lift verbatim" verdict for these three held exactly. **Scope guard:** `git diff main..HEAD -- src/web/ | wc -c` → 0 (verified). Only upstream-file edit in this wave is the tailwind.config.mjs one-liner; everything else is new files under `src/webFull/` (or the in-fork barrel edit).
- **2026-06-08** — **ISA.md marked `merge=union` in `.gitattributes` to eliminate parallel-branch conflicts.** Architect's 2026-06-08 audit flagged ISA.md as the most collision-prone file in the project: every layer ships a Decisions entry and a Verification entry on its own branch, and the default git 3-way merge driver treats parallel appends to the same file as a conflict requiring manual resolution. The textbook fix is git's built-in `union` merge driver — when two branches both append to ISA.md, the driver takes the union of both sides (keeping every line from both parents) instead of emitting conflict markers. Applied via a new `.gitattributes` at the repo root with a single rule `ISA.md merge=union` plus a comment block explaining the append-only convention that makes the driver semantically safe. **The convention is the load-bearing piece:** ISA.md edits must be append-only — Decisions/Verification/Changelog entries are write-once-by-date, never edited in place. Under that discipline, union merge produces correct results (the union of two append sets equals the intended combined history). If someone violates the convention by editing an existing entry on a branch, union merge will silently keep both versions side-by-side rather than flagging a conflict; that's the accepted trade-off for zero-friction parallel appends. **Files touched in this turn:** NEW `.gitattributes` at repo root (single rule + comment block) + this Decisions entry + a Verification evidence entry below. No source touched.
- **2026-06-08** — Added `PLAN.md` at the repo root as a single entry-point summary linking to ISA, WEB_PORT_ORDER, and the three assessment docs. Living doc; updates land here when execution state changes materially.

## Changelog

> Conjecture / refuted_by / learned / criterion_now entries land here as the project evolves.

### 2026-06-07 — conversion is decoupling, not rebuilding

- **conjectured**: Converting Maestro to a web app means writing a new Fastify server, a new client, and a new IPC story.
- **refuted_by**: First-pass repo scan: `src/web/` exists with mobile/desktop split; `src/main/web-server/{WebServer.ts, web-server-factory.ts, routes/*}` already runs Fastify on port 45678 with WS upgrade; `vite.config.web.mts` already proxies `/api` and `/ws` to that port; integration tests exist at `src/__tests__/main/web-server/`.
- **learned**: The Electron→web work is structurally a **decoupling** problem — extracting the existing Fastify server from `BrowserWindow`/Electron lifecycle — not a greenfield rebuild. This roughly halves the perceived effort and reshapes the PLAN around "remove the wrapper" rather than "add the server."
- **criterion_now**: ISC-7 (IPC bridge collapse — stub vs rewrite) is the keystone criterion. Resolving it unblocks F1 (vanilla-node launcher) and most of Tier 2.

### 2026-06-07 — the existing web bundle is the mobile-remote-control surface, not full Maestro

- **conjectured**: Opening the existing web URL gives Trillium the same Maestro UX he uses on desktop — same session-create, agent config, file browse, git diff, Auto Run UI, settings.
- **refuted_by**: Background agent's `WEB_CONVERSION_ASSESSMENT.md` §1.3, §6.1 (lines 36-53, 223-240) — the shipped `src/web/` PWA is a **mobile companion / remote control** for an already-running desktop instance. It can list sessions, send commands, switch tabs, interrupt. It **cannot** create new sessions, configure agents, browse the filesystem, view git diffs, edit settings, or use the Auto Run UI. The desktop renderer has 132 components; the mobile/web bundle has a small fraction.
- **learned**: A web target that ships from this codebase has THREE materially different shapes:
  1. **"Maestro Server" (Tier 1 in WEB_CONVERSION_ASSESSMENT.md):** Decouple the existing Fastify server from Electron. UX is the existing mobile/PWA bundle. Trillium loses ~80% of desktop UI features but gets browser-from-anywhere immediately. Honest, shippable. Maps to Layer 0 in `WEB_PORT_ORDER.md`.
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
