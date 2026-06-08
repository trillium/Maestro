# WEB_PORT_ORDER.md

> Logical, dependency-ordered plan for porting Maestro's Electron desktop UX into the browser, landing in `src/webFull/`. No time estimates — order is by dependency, not duration. Pairs with `ISA.md` (constraints, ISCs, decisions), `WEB_CONVERSION_ASSESSMENT.md` (server-side IPC inventory), `WEB_PARITY_VERIFICATION.md` (the parity-catalog spec), and `WEB_FEATURE_PARITY_SCOPE.md` (per-surface scope deltas).
>
> **Working rule:** every layer item is built in `src/webFull/`, never in `src/web/` (which stays a verbatim mirror of upstream per anti-criterion ISC-43). Most items in Layer 3+ **COMPOSE the primitives lifted in Layer 2** rather than re-lifting renderer components. Each layer item ships with a parity catalog per `WEB_PARITY_VERIFICATION.md`. Each item is delegate-able to a worktree-isolated agent that drives Electron-as-oracle at `localhost:9222` and webFull at `localhost:5176` side-by-side.

---

## Layer 0 — Decouple the server from Electron

Goal: produce a vanilla-Node entrypoint that boots the existing Fastify+WebSocket server (`src/main/web-server/WebServer.ts`) with no `electron` import at runtime. This is the gate for everything below. Until L0 is green, no per-feature agent can run because the build target for `src/webFull/` has no server to talk to.

- **L0a — bootable headless server, read-only callbacks.** New `src/server/index.ts` wires READ callbacks (`getSessions`, `getSessionDetail`, `getTheme`, `getBionifyReadingMode`, `getCustomCommands`, `getHistory`) to file-backed stores. WRITE callbacks log a warning and return `false`. New files: `src/server/index.ts`, `src/shared/data-dir.ts`, `src/shared/file-store.ts`, `tsconfig.server.json`. Two-line `package.json` scripts addition (`build:server`, `start:web`). Covers ISC-28/29/33/36 at the bootstrap path. **Status: shipped (`2f2262cfa`).**
- **L0b — write/interrupt/execute callbacks via ProcessManager.** New `src/server/process-manager-adapter.ts` (~108 LOC) instantiates one `ProcessManager` at server startup; `setWriteToSessionCallback` / `setExecuteCommandCallback` / `setInterruptSessionCallback` route through it. Suffix logic mirrors `web-server-factory.ts:248-272` verbatim. **Status: shipped (`0cbd4df5c`).**
- **L0c — remaining writes.** `switchMode`, `selectSession`, `selectTab`, `newTab`, `closeTab`, `renameTab`, `starTab`, `reorderTab`, `toggleBookmark`. These need write-back to the sessions store plus WebSocket broadcast. `executeCommand`'s spawn-new-session semantics also lands here. **Status: in flight (branch `layer-0c-remaining-writes`).**

**Depends on:** nothing.
**Blocks:** every other layer.

---

## Layer 1 — Webfull build target

Goal: `src/webFull/` builds and dev-runs as its own bundle without touching `vite.config.web.mts` or anything under `src/web/`. This is the build target Layer 2+ agents land against.

- **L1.1 — `vite.config.webfull.mts` + dev/build scripts.** Sibling-config pattern: parallel Vite config drives `src/webFull/`. `root` and `publicDir` repointed to `src/webFull/` + `src/webFull/public/`; `outDir` → `dist/webfull/`; dev port 5176 (web stays on 5174), preview 5177; `@web` alias re-pointed at `src/webFull` so any future alias-using import stays self-contained. `manualChunks`, `optimizeDeps`, proxy config copied verbatim from `vite.config.web.mts`. NEW files only: `vite.config.webfull.mts`, two `package.json` script lines (`dev:webfull`, `build:webfull`). Not added to the aggregate `build` script — upstream `npm run build` stays compatible. **Status: shipped (`3963a6bc0`).**
- **L1.2 — Tailwind glob fix.** One-line change to `tailwind.config.mjs:3`: add `'./src/webFull/**/*.{js,ts,jsx,tsx}'` to the content glob. Without it, every Tailwind class introduced in webFull-only code is purged by the production build and dev mode silently masks the bug via HMR. Cited as the "single most likely failure mode" by the lift audit. **Prerequisite for Layer 2 — block all primitives-lift work until this lands.**

**Depends on:** L0 (so dev-server has an `/api` and `/ws` proxy target).
**Blocks:** Layer 2.

---

## Layer 2 — Lift UI primitives

Goal: lift the visually-shared atoms and leaf modals from `src/renderer/` into `src/webFull/` once, so every later feature port composes them rather than re-lifting them. These are the cheapest wins in the audit and they unblock every feature port that follows.

**Why primitives first.** The lift audit (`/tmp/web-ui-lift-scope.md` §B, §F1) identifies a thin set of renderer primitives with **0 IPC namespaces and 0 Electron-only APIs**. They lift verbatim and they're load-bearing for everything else — every renderer modal uses `<Modal>` and `<LayerStackContext>`, every form uses `<FormInput>`, every confirmation flow uses `<ConfirmModal>`. Lifting them once costs one PR; not lifting them costs N PRs each re-deriving the same component shape with the same theme-prop convention. The audit's words: "ALWAYS lift visually-shared primitives (Modal, Button, Card, GitStatusWidget) verbatim before any composition work."

**Prerequisite (L1.2):** the Tailwind glob must include `src/webFull/**` before any primitive is lifted. Otherwise the classes the primitives rely on will be purged from the production bundle.

**Candidates** (audit §B1, §B4):

- `src/renderer/components/ui/Modal.tsx` — Modal primitive (~200 LOC). Drags `LayerStackContext.tsx`, `useModalLayer`, `useLayerStack`, and the `MODAL_PRIORITIES` constant with it. All pure logic.
- `src/renderer/components/ui/FormInput.tsx` — pure, 0 IPC, 0 Electron API.
- `src/renderer/components/ui/EmojiPickerField.tsx` — pure, 0 IPC, 0 Electron API.
- `src/renderer/components/ConfirmModal.tsx` — 75 LOC, fixed 450px width, accepts `theme` as prop. Composes `<Modal>`. **Best first lift after Modal lands.**
- `src/renderer/components/GitStatusWidget.tsx` — 244 LOC, pure widget reading from `GitStatusContext`. Lift the widget verbatim; the context itself is L4/L5 work (wraps `useGitStatusPolling` which hits 3 git IPCs).
- `src/renderer/components/ui/index.ts` — barrel.

**Lift policy for primitives:**
- Preserve the renderer's `theme: Theme` prop interface (audit §A3). Each consumer can opt into `useTheme()` at composition time; primitives don't dictate.
- No IPC substitution work in this layer — by construction these have zero IPC.
- No `window.open(...)` substitution — by construction no `shell.openExternal` calls.

**Note on parity-test scope.** Primitives don't get their own parity catalog at lift time; they get a smoke test that asserts `hasElement` mount + theme-prop propagation. Functional parity is verified at the composition layer (Layer 3+).

**Subsequent layers COMPOSE these primitives — they do NOT re-lift renderer components.** If a Layer 4 feature port needs `<Modal>`, it imports it from `src/webFull/components/ui/Modal.tsx`. If it needs a confirmation dialog, it composes `<ConfirmModal>`. If a Layer 5 git-diff surface needs the widget, it composes `<GitStatusWidget>`. The decision rule at the bottom of this doc makes this explicit per-feature.

**Depends on:** L0, L1.1, L1.2.
**Blocks:** Layer 3 and every layer after.

---

## Layer 3 — Identity + Settings

Goal: a logged-in browser user can see their identity (active theme, font, name where applicable) and can read/write settings through webFull. This is the first composition layer — every feature after Layer 3 assumes a settings surface exists.

- **L3.1 — settings read path.** Wire `useSettings()` in webFull to `GET /:token/api/settings` (new server route). Compose `<FormInput>` (lifted in Layer 2) for the read-only display. No write callbacks yet.
- **L3.2 — settings write path.** `POST /:token/api/settings/:key` for write. Settings broadcast on change via new WS message type so a second browser sees the update without reload (covers ISC-14).
- **L3.3 — theme picker.** Theme selection lives in settings; on save, server broadcasts the new theme and `useTheme()` propagates. CSS custom properties re-inject per audit §A3.
- **L3.4 — General tab parity.** `GeneralTab.tsx` (1522 LOC, 17 IPC, 1 Electron-only). Per the decision rule below, this is **rewrite-with-lifted-primitives** — compose `<Modal>`, `<FormInput>`, `<ConfirmModal>` from Layer 2, write fresh hooks against new server endpoints. Do NOT literal-lift.

**Depends on:** Layer 2 (uses `<FormInput>`, `<Modal>`, `<ConfirmModal>`).
**Blocks:** Layer 4 (Auto Run UI reads settings; agent config reads settings).

---

## Layer 4 — Create + Navigate

Goal: a browser user can create a new session, see the session list, switch tabs, close tabs.

- **L4.1 — session list.** `GET /:token/api/sessions` already exists. Compose into a webFull session-list view. Reads `useSessions()` (already exists on web side as a sample — audit §C6). No write IPC.
- **L4.2 — tab switch / close / rename / star.** WS message types `select_tab`, `close_tab`, `rename_tab`, `star_tab` already exist; L0c lands the server-side handlers. webFull subscribes via `useWebSocket()`.
- **L4.3 — new session creation.** This is the deepest L4 surface — `NewInstanceModal.tsx` is 1822 LOC across 18 IPC calls plus `dialog.selectFolder` (no browser equivalent). Per the decision rule below, this is **rewrite-with-lifted-primitives** with the directory-picker decision deferred to a Decisions entry (typed text input + server-side validation vs server-rendered directory tree picker). Composes `<Modal>` from Layer 2.
- **L4.4 — Maestro-mode URL routing.** Renderer uses Zustand `activeSessionId`; webFull uses URL `${origin}/${token}/session/${sessionId}?tabId=${tabId}` parsed by `createMaestroModeContextValue` (audit §D2). When porting renderer code that reads `activeSessionId`, the adapter calls `useMaestroMode().sessionId`.

**Depends on:** Layer 3 (settings needed for default cwd, default agent), Layer 2 (modal primitives).
**Blocks:** Layer 5 (every subsequent surface assumes "I'm in session X tab Y").

---

## Layer 5 — Terminal output + git status

Goal: a browser user can see structured/parsed output from a running session and the git status of its workspace. **Does NOT include xterm.js raw-byte PTY rendering** — that's Layer 6, scope-gated.

- **L5.1 — MessageHistory render.** webFull subscribes to the existing `session_state_change` WS broadcast and renders parsed messages. No new server work — the broadcast already carries parsed output.
- **L5.2 — GitStatusContext lift.** Lift `src/renderer/contexts/GitStatusContext.tsx` (253 LOC) and `useGitStatusPolling.ts` (497 LOC, IPC-heavy). Replace 3 git IPCs with `GET /:token/api/git/{info,status,numstat}` (audit §C5). Compose `<GitStatusWidget>` (lifted in Layer 2). New server routes wrap `src/main/git-manager.ts`.
- **L5.3 — write-to-session via existing route.** `POST /:token/api/session/:id/send` already exists (wired in L0b). webFull composes a send-input control that uses it.

**Depends on:** Layer 4 (need a selected session to attach to), Layer 2 (`<GitStatusWidget>`).
**Blocks:** Layer 6 (xterm decision must be made before raw-byte WS multiplex work).

---

## Layer 6 — xterm.js + raw-byte WS multiplex (SCOPE-GATED)

Goal: a browser user can interact with a real terminal pty as if they were on the desktop. **Principal-decision-gated by ISC-42.** If the decision is "accept no raw PTY in browser; only parsed/structured output," this layer is **skipped** and Layer 5's MessageHistory render is the terminal surface.

If scoped in:
- Add `xterm.js` to webFull.
- Add a raw-byte WS multiplex (new WS message type carrying byte chunks per session ID).
- Survive disconnects: re-attach to the live pty on reconnect, replay scrollback from `ProcessManager` ring buffer (covers ISC-13).

**Depends on:** Layer 5 (MessageHistory is the fallback if scope-gate denies this layer).
**Blocks:** nothing below requires this layer if it's skipped.

*Note: prior to the 2026-06-08 doc restructure this surface was Layer 4. ISA.md line 129 references "Layer 4 in `WEB_PORT_ORDER.md`" for the xterm scope decision — that reference now resolves to this layer (Layer 6) under the primitives-first ordering. Updated cross-reference noted in ISA Decisions.*

---

## Layer 7 — History + AutoRun + Agents

Goal: feature-parity with desktop on the surfaces that aren't terminal-rendering.

- **L7.1 — HistoryManager port.** Currently stubbed empty in L0a. Lift `HistoryDetailModal.tsx` (693 LOC, 0 direct IPC) which composes `<Modal>` from Layer 2 and uses `MarkdownRenderer` (drag dep). Replace `shell.openPath` link behavior with copy-to-clipboard or disabled.
- **L7.2 — AutoRun UI.** Compose using Layer 2 primitives + Layer 3 settings + Layer 5 session state. Rewrite-with-lifted-primitives — do NOT literal-lift.
- **L7.3 — agent config + agent detect.** `AgentConfigPanel.tsx`, `AgentSelector.tsx`. Replace `agents.detect/getConfig/refresh/getModels` IPC with new HTTP routes.

**Depends on:** Layer 4 (session context), Layer 3 (settings), Layer 2 (primitives).

---

## Layer 8 — Markdown + Files + Diffs

Goal: parity on content-rendering surfaces.

- **L8.1 — MarkdownRenderer lift.** Audit flags `markdownConfig.ts:696,796` injecting `shell.openExternal` into link handlers. Substitute `window.open(url, '_blank', 'noopener,noreferrer')` per audit §F4. `shell.openPath` for local file links has no browser equivalent — drop or replace with download.
- **L8.2 — FilePreview.** Audit flags `FilePreview.tsx:954,2293` with `shell.openPath`. Same drop policy.
- **L8.3 — git diff view.** Compose `<GitStatusWidget>` (Layer 2) + new diff-rendering panel. Server-side diff endpoint.

**Depends on:** Layer 5 (git context), Layer 2 (primitives).

---

## Layer 9 — Polish, observability, leftovers

Goal: ErrorBoundary, LogViewer, About, ProcessMonitor.

- **L9.1 — ErrorBoundary swap.** `@sentry/electron/renderer` → `@sentry/browser` (covers ISC-33 fully on the client side).
- **L9.2 — LogViewer.** 717 LOC, 5 IPC (all `logger.*`). Rewrite-with-lifted-primitives. New `logger.*` HTTP routes + WS broadcast.
- **L9.3 — AboutModal.** 465 LOC, 9 IPC, 7 `shell.openExternal` calls. Compose `<Modal>` (Layer 2). Replace external opens with `window.open(...)`.
- **L9.4 — ProcessMonitor.** 1629 LOC, 2 IPC. Rewrite-with-lifted-primitives — file size suggests heavy desktop-layout assumptions that won't survive a literal lift.

**Depends on:** Layer 2 (primitives), Layer 7 (sentry swap depends on observability story being settled).

---

## Skip-list (explicit drop candidates)

Per ISA decision 2026-06-07 and audit §E:

- **Wizard** — too large to lift, dropped.
- **GroupChat** — too large to lift, dropped.
- **Symphony** — too large to lift, dropped.
- **DocumentGraph** — too large to lift, dropped.

Each can be reinstated as a separate scope-decision entry in ISA if Trillium later wants them.

---

## Lift vs Rewrite — decision rule

Every per-feature port lands one of three ways. The decision is made BEFORE the agent runs, based on a one-time grep of the renderer source for IPC and Electron-only API usage. The audit (`/tmp/web-ui-lift-scope.md` §E, §F) is the source.

**Lift verbatim** if:
- **0 IPC namespaces** AND
- **0 Electron-only APIs** (`dialog`, `power`, `devtools`, `shell.openExternal`, `shell.openPath`, `tunnel`, `@sentry/electron`, etc.)

The renderer file gets copied into `src/webFull/`, imports updated, theme handoff preserved. Lift candidates: `Modal.tsx`, `FormInput.tsx`, `EmojiPickerField.tsx`, `ConfirmModal.tsx`, `GitStatusWidget.tsx` (already enumerated in Layer 2). These are the audit's "verbatim-lift" candidates.

**Rewrite using lifted primitives** if:
- **≥1 IPC namespace** OR
- **≥1 Electron-only API**

The renderer file is **NOT** copied. A fresh `src/webFull/<feature>/` is composed using Layer 2 primitives (`<Modal>`, `<FormInput>`, `<ConfirmModal>`, theme prop convention) plus new hooks that talk to the WS protocol. Canonical examples from the audit:
- `NewInstanceModal.tsx` — 1822 LOC, **18 IPC calls**, 4+ Electron-only APIs. The audit verdict: "partial-rewrite or defer." This doc says: rewrite, don't lift.
- `Settings/tabs/GeneralTab.tsx` — 1522 LOC, **17 IPC calls**, 1 Electron-only. Rewrite, don't lift.
- `App.tsx` — 3357 LOC, three-pane orchestrator wired to 4 contexts and 11 Zustand stores. Audit verdict: "Don't lift that whole file — pick component fragments." This doc says: rewrite the webFull-equivalent orchestrator from scratch, composing lifted primitives and webFull-native hooks.

**Hybrid (lift the layout, rewrite the data hooks)** if:
- **1–3 IPC namespaces** are concentrated in a single hook the rest of the component doesn't touch (i.e. JSX layout is data-shape-independent).

In this mode, the component file gets lifted; the hook it imports is replaced with a webFull-native hook that produces the same shape. Audit-shaped examples: `LogViewer.tsx` (717 LOC, 5 IPC all in `logger.*`) — lift the JSX, write a new `useLogger()` for webFull. `AboutModal.tsx` (465 LOC, 9 IPC, all `shell.openExternal` or `agentSessions.*`) — lift the JSX, replace handlers.

**The dominating cost is server-surface growth.** The audit's bottom-line metric (§C2, "Concrete numbers" §): current server exposes 6 HTTP routes + 13 WS broadcast types + 13 WS inbound types. Renderer touches **38 IPC namespaces** across 886 callsites. Every per-feature port that's classified "rewrite" or "hybrid" drags new server routes / broadcasts with it. Each PR's scope-of-work is **the renderer surface PLUS the new server endpoints to feed it.** Budget accordingly.

---

## IPC substitution reference

For "rewrite" and "hybrid" features, the substitution is mechanical per the audit §F3:

| Renderer call | webFull replacement | Server work |
|---|---|---|
| `window.maestro.<ns>.<method>(args)` (read) | `fetch('/${token}/api/<ns>/<method>?args').then(r=>r.json())` | New `server.get` route in `src/main/web-server/routes/apiRoutes.ts` |
| `window.maestro.<ns>.<method>(args)` (write) | `fetch('/${token}/api/<ns>/<method>', { method: 'POST', body: JSON.stringify(args) })` | New `server.post` route |
| `window.maestro.<ns>.on<Event>(cb)` (subscribe) | `useWebSocket()` subscription to a new WS message type | New broadcast in `broadcastService.ts` + handler in `messageHandlers.ts` |

**The shorthand**: `window.maestro.X.Y(args)` → `fetch('/${token}/api/X/Y', ...)` (read), POST (write), or `useWebSocket()` subscription (event).

**The imbalance to budget for**: 6 HTTP + 13 WS inbound + 13 WS broadcast = **32 server-side IPC surfaces** today vs **38 renderer-side namespaces** with **886 callsites**. Most of the 32 are session/tab/theme surfaces; most of the 886 are feature surfaces with no server-side equivalent yet. Each per-feature port drags some N of new routes/broadcasts with it. The audit calls this "the part that compounds." Layer 0c's bookmark/star/tab-reorder WS handlers are the early wedge into closing the gap.

For Electron-only APIs, the substitution table per audit §F4:

| Renderer call | webFull replacement |
|---|---|
| `window.maestro.shell.openExternal(url)` | `window.open(url, '_blank', 'noopener,noreferrer')` |
| `window.maestro.shell.openPath(path)` | Drop (browser can't open local paths); replace with copy-to-clipboard or download link |
| `window.maestro.shell.copyImageToClipboard(dataUrl)` | `navigator.clipboard.write([new ClipboardItem({...})])` |
| `window.maestro.dialog.selectFolder()` | Typed text input + server-side validation, OR server-rendered directory tree picker |
| `window.maestro.devtools.toggle()` | Drop (browser has its own devtools) |
| `window.maestro.power.setEnabled(value)` | Drop (no browser equivalent; document in changelog) |
| `import * as Sentry from '@sentry/electron/renderer'` | `import * as Sentry from '@sentry/browser'` |

---

## How to pick the next feature

For an agent about to take the next port turn:

1. Read this doc, find the lowest-numbered layer whose dependencies are green and whose items aren't all shipped.
2. Within that layer, pick an item with no inter-item dependencies (or the next in sequence if there is one).
3. Apply the **Lift vs Rewrite** decision rule above against the renderer source. The output tells you whether to copy the file or compose from Layer 2 primitives.
4. Read the audit's per-component row in §E if your candidate is listed — the audit names the IPC count and Electron-API count for the heavy hitters.
5. Open the per-feature ISC in `ISA.md` as `ISC-44.<feature>` per the standing convention.
6. Run the parity catalog against Electron at `localhost:9222` and webFull at `localhost:5176`; both must pass.

---

## Cross-reference index

- ISA constraints, ISCs, decisions: `ISA.md`
- Server-side IPC inventory: `WEB_CONVERSION_ASSESSMENT.md`
- Parity-catalog spec + assertion vocabulary: `WEB_PARITY_VERIFICATION.md`
- Per-surface scope deltas (what's in / what's deferred): `WEB_FEATURE_PARITY_SCOPE.md`
- Lift audit (this doc's source for the lift-vs-rewrite rule): `/tmp/web-ui-lift-scope.md`
