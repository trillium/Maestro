# Maestro Web Port — Plan

> Single entry-point summary of this fork's web-port effort. Links to the load-bearing docs rather than restating them. Living doc; updates land here when execution state changes materially.

## What this is

This is Trillium's fork of [RunMaestro/Maestro](https://github.com/RunMaestro/Maestro), repointing the primary surface from the upstream Electron 28 desktop app to a web app served over Tailscale. Single-user, multi-device. One running instance on `mini2` (the always-on Mac in Trillium's tailnet), reachable from laptop, phone, or any tailnet-joined machine via the browser at `http://mini2.<tailnet>.ts.net:45678`. Upstream stays Electron; this fork diverges. No per-machine installs, no per-machine state, no per-machine updates — and crucially, no "which copy of Maestro has my work in it."

`PLAN.md` is the entry point. It is a **summary + index**, not a duplicate — quotes go stale, links don't. For depth on any topic, follow the links.

## Why (link to ISA Vision)

Trillium works across multiple machines on a tailnet and wants ONE Maestro instance reachable from any of them. Electron pins the app to a single host: per-machine installs, per-machine state, per-machine updates, no phone access. The conversion is structurally a **decoupling** problem rather than a rebuild — the codebase already ships a Fastify+WebSocket server (`src/main/web-server/WebServer.ts`) and a web bundle (`src/web/`); the work is extracting them from the Electron lifecycle, not building a server from scratch. This realization, captured in [ISA.md § Changelog 2026-06-07 — conversion is decoupling, not rebuilding](ISA.md#2026-06-07--conversion-is-decoupling-not-rebuilding), roughly halved the perceived effort and reshaped the plan from "add the server" to "remove the wrapper."

Full vision plus the euphoric-surprise statement: [ISA.md § Vision](ISA.md#vision).

## Out of scope (link to ISA Out of Scope)

- **Multi-tenant SaaS.** No accounts, billing, or workspace isolation. Single user forever.
- **Public-internet exposure.** No public TLS, no OAuth, no Cloudflare tunnel. Tailscale identity is auth.
- **Electron parity for upstream.** This fork does not promise green Electron CI.
- **Native mobile apps.** Mobile is mobile-responsive web from the same Fastify origin.
- **`electron-updater`, dmg/AppImage/nsis packaging.** Replaced by `git pull && build && launchd restart`.

Full list with context: [ISA.md § Out of Scope](ISA.md#out-of-scope).

## Architecture, in one paragraph

The existing Electron app already runs a Fastify HTTP + WebSocket server on port 45678 (`src/main/web-server/WebServer.ts`, factory at `src/main/web-server/web-server-factory.ts`) and ships a web bundle (`src/web/`) that acts as a mobile companion / remote control for an already-running desktop instance. This fork lifts that server out of Electron — a vanilla Node entrypoint (`src/server/index.ts`) constructs `WebServer` with no `electron` import in the runtime path, persists state via a file-backed `electron-store` shim (`src/shared/file-store.ts`), and resolves user-data paths via an env-var-driven resolver (`src/shared/data-dir.ts`). Terminal sessions stay server-owned: `node-pty` ptys live in the Node process, persist across browser disconnects, and stream over WebSocket. On the UI side, `src/web/` was forked verbatim to a sibling tree `src/webFull/` (ISA Decision 2026-06-07, commit `ee6274e1f`); all divergent UI growth happens in `src/webFull/`, while `src/web/` stays a verbatim mirror of upstream so `git pull upstream main` is mechanical. The desktop renderer's UI (`src/renderer/`, 236 component files, 886 `window.maestro.*` IPC callsites across 148 files) is being lifted-and-adapted into `src/webFull/` component-by-component, with the lift-vs-rewrite rule keyed on IPC namespace count and Electron-only API usage. State lives once on the host (SQLite + JSON store on mini2's disk); every browser session is a thin client; last-writer-wins via WebSocket events handles the "two browsers editing the same thing" case.

## Execution plan

The layered, dependency-ordered roadmap lives in [WEB_PORT_ORDER.md](WEB_PORT_ORDER.md). Summary table — see the file for per-item detail and the lift-vs-rewrite decision rule:

| Layer | Purpose | Status |
|---|---|---|
| 0 | Decouple Fastify server from Electron (vanilla-Node entrypoint) | L0a + L0b merged; L0c in flight on branch `layer-0c-remaining-writes` |
| 1 | Webfull build target (`vite.config.webfull.mts`, dev/build scripts, Tailwind glob) | L1.1 merged; L1.2 (Tailwind glob) pending — blocks Layer 2 |
| 2 | Lift UI primitives once (`Modal`, `FormInput`, `ConfirmModal`, `GitStatusWidget`) | In flight on branch `layer-2.1-primitives-lift` |
| 3 | Identity + Settings (settings read/write, theme picker, General tab) | Pending |
| 4 | Create + Navigate (session list, tab ops, new session, URL routing) | Pending |
| 5 | Terminal output + git status (parsed MessageHistory render, GitStatusContext) | Pending |
| 6 | xterm.js + raw-byte WS multiplex — **principal-decision-gated (ISC-42)** | Pending decision |
| 7 | History + AutoRun + Agents | Pending |
| 8 | Markdown + Files + Diffs | Pending |
| 9 | Polish, observability, leftovers (ErrorBoundary, LogViewer, About, ProcessMonitor) | Pending |

Skip-list (dropped per ISA Decision 2026-06-07): Wizard, GroupChat, Symphony, DocumentGraph. Each can be reinstated as a separate scope-decision entry.

## Where we are right now

As of 2026-06-08 on `main`:

- **Layer 0a shipped (`2f2262cfa`):** Bootable headless server. `src/server/index.ts` constructs `WebServer` with no `electron` runtime import. READ callbacks wired (`getSessions`, `getSessionDetail`, `getTheme`, `getBionifyReadingMode`, `getCustomCommands`); `getHistory` stubbed. WRITE callbacks log warnings and return `false`. New files only: `src/server/`, `src/shared/data-dir.ts`, `src/shared/file-store.ts`, `tsconfig.server.json`. Covers ISC-28/29/33/36 at the bootstrap path. Verification evidence in [ISA.md § 2026-06-08 — Layer 0a evidence](ISA.md#2026-06-08--layer-0a-evidence).
- **Layer 0b shipped (`0cbd4df5c`):** Write/interrupt/execute callbacks routed through a new `ServerProcessManagerAdapter` (`src/server/process-manager-adapter.ts`, ~108 LOC). Suffix logic (`-ai` / `-terminal`) mirrors `web-server-factory.ts:248-272` verbatim. ProcessManager confirmed electron-free. Still stubbed: `switchMode`, tab ops, bookmark toggle. Verification in [ISA.md § 2026-06-08 — Layer 0b evidence](ISA.md#2026-06-08--layer-0b-evidence).
- **Layer 1.1 shipped (`3963a6bc0`):** `vite.config.webfull.mts` sibling config + `dev:webfull` / `build:webfull` scripts. `root` → `src/webFull/`, `outDir` → `dist/webfull/`, dev port 5176, preview 5177, `@web` alias re-pointed at `src/webFull`. Build produces 5 hashed assets, `index.html` with `<div id="root">`, manifest + service worker copied from `src/webFull/public/`. Zero edits to `src/web/`, `vite.config.web.mts`, or `tsconfig.json`. Verification in [ISA.md § 2026-06-08 — Layer 1.1 evidence](ISA.md#2026-06-08--layer-11-evidence-webfull-vite-scaffold).
- **In-flight branches:** `layer-0c-remaining-writes` (remaining WRITE callbacks: tab ops, bookmark, switchMode), `layer-2.1-primitives-lift` (Modal + FormInput + ConfirmModal lift + Tailwind webFull glob).

Check `git log --oneline -10` and the ISA Decisions section for the freshest state — this section drifts.

## Verification approach

Function parity, not pixel parity. Every feature port ships with a user-story catalog of `(Given, When, Then)` triples using a fixed assertion vocabulary (`hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast`) chosen deliberately to be layout-independent. The catalog is recorded against the running Electron app (the test oracle at `localhost:9222`) and replayed against webFull (at `localhost:5176`); both must pass. Pixel-perfect, DOM-identical, and CSS-identical parity are explicitly rejected as the wrong bar — the bar is "the user can do the same things in the same situations and get the same observable results." The catalog IS the spec, not the renderer source — this protects against agent hallucination and against canonizing renderer bugs. Per-feature catalogs land at `src/webFull/<feature>/parity.test.ts` and tie to per-feature ISCs formatted as `ISC-44.<feature>: parity catalog passes against both Electron and webFull, ≥N stories, including ≥1 negative-path story per happy-path story`.

Full methodology, assertion grammar, and per-feature catalog template: function-parity verification methodology ([brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md)).

## Standing rules (most important)

- **`src/web/` is read-only on this fork.** Never edit, refactor, rename, lint-fix, or auto-format anything under `src/web/`. It is a verbatim mirror of upstream so `git pull upstream main` is mechanical. All divergent UI work — including bugfixes to the mobile-companion surface — happens in `src/webFull/`. Anti-criterion ISC-43 enforces; non-negotiable per Trillium's 2026-06-07 standing rule.
- **Bias new files; minimize edits to upstream files.** In a fork, every edit to an upstream-tracked file becomes a future rebase conflict. Prefer sibling configs (`vite.config.webfull.mts`), adapter modules (`src/server/process-manager-adapter.ts`), parallel directories (`src/server/`, `src/webFull/`) over patches to upstream code.
- **Tier 3 (multi-tenant SaaS) is explicitly out of scope.** Single user (Trillium) is the design assumption forever.
- **Tailscale is the perimeter.** No public TLS, no OAuth, no in-app session login. If reverse-proxying is ever needed it is a separate sub-project.
- **No time estimates anywhere.** Order is by dependency, not duration.

Full constraint list with context: [ISA.md § Constraints](ISA.md#constraints) and [ISA.md § Principles](ISA.md#principles).

## Companion docs

- [ISA.md](ISA.md) — Project source-of-truth. Constraints, ISCs, Decisions, Changelog, Verification log. Read this first; the Decisions section is the freshest narrative of what's been resolved.
- [WEB_PORT_ORDER.md](WEB_PORT_ORDER.md) — Layered execution roadmap. Per-layer item breakdown, lift-vs-rewrite decision rule, IPC substitution reference, skip-list.
- [brain-tlak](~/data/knowledge/entries/knowledge/maestro-web-port-codebase-conversion-assessment.md) — Maestro web-port: codebase conversion assessment. Codebase inventory + server-decoupling scoping (migrated from `WEB_CONVERSION_ASSESSMENT.md` to brain on 2026-06-08).
- [brain-8s3r](~/data/knowledge/entries/knowledge/maestro-web-port-feature-parity-scope-inventory.md) — Maestro web-port: feature parity scope inventory. Per-feature LOC + IPC inventory; what's in / what's deferred (migrated from `WEB_FEATURE_PARITY_SCOPE.md` to brain on 2026-06-08).
- [brain-aq5m](~/data/knowledge/entries/knowledge/maestro-web-port-function-parity-verification-methodology.md) — Maestro web-port: function-parity verification methodology. Catalog methodology + assertion grammar (migrated from `WEB_PARITY_VERIFICATION.md` to brain on 2026-06-08).
- `/tmp/web-ui-lift-scope.md` — Lift audit (445 lines, 2026-06-07) that informs the lift-vs-rewrite rule in `WEB_PORT_ORDER.md`. Not in the repo; treat as the audit's source.

## How to extend this fork

- **Read this file**, then read [ISA.md](ISA.md) Decisions and Changelog for the freshest project state. Don't trust the status table above without checking `git log --oneline -10` first.
- **Pick the lowest-numbered layer in [WEB_PORT_ORDER.md](WEB_PORT_ORDER.md)** whose dependencies are green and whose items aren't all shipped. Within that layer, pick an item with no inter-item dependencies.
- **Apply the lift-vs-rewrite rule** from `WEB_PORT_ORDER.md` against the renderer source: 0 IPC + 0 Electron-only APIs → lift verbatim; ≥1 IPC or ≥1 Electron-only API → rewrite-with-lifted-primitives; 1-3 IPC concentrated in one hook → hybrid (lift JSX, rewrite hook).
- **Pre-stage a worktree** off `main` on a `layer-<N>.<item>-<slug>` branch. Brief an agent per the [Delegation skill](https://github.com/anthropics/claude-code) pattern: hand them the absolute worktree path, the ISC range they own, the lift-vs-rewrite verdict, and the parity-catalog requirement. Do not pre-create branches in-session.
- **Commit, do not push.** Parent reviews the diff and merges. New ISCs append as `ISC-44.<feature>` per the ID-stability rule; never re-number.
- **Land verification evidence in [ISA.md § Verification](ISA.md#verification)** as a new dated subsection. Append a Decisions entry when behavior or constraints change.
