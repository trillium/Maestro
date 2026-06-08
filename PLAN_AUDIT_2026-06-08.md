# Plan Audit — 2026-06-08

> Architect audit of the Maestro web-port project, conducted after L0a, L0b, L1.1 merged to `main` and with Layer 2 primitives + Layer 0c work in flight. Read-only review of source + planning state.
>
> Audit boundary: `ISA.md`, `/tmp/web-ui-lift-scope.md`, all in-tree worktrees, all `src/` under `/Users/trilliumsmith/code/maestro`. No code edits, no ISA edits.
>
> Methodology: trace claims in `ISA.md` Decisions / Verification against actual files and git state; cross-check stated constraints against actual constraints; pressure-test the wave structure now that the bottom three layers have shipped.

---

## 0. Headline findings

1. **Three of the four planning docs the ISA references do not exist on disk anywhere.** `WEB_PORT_ORDER.md`, `WEB_PARITY_VERIFICATION.md`, `WEB_CONVERSION_ASSESSMENT.md`, `WEB_FEATURE_PARITY_SCOPE.md` — none of them are present in `/Users/trilliumsmith/code/maestro/`, in any of the six worktrees (`-l0b`, `-l0c`, `-l1.1`, `-portorder`, `-primitives`), or anywhere under `/Users/trilliumsmith/`. Only `/tmp/web-ui-lift-scope.md` exists. The ISA repeatedly cites these docs as if they were on disk (`ISA.md:129` for `WEB_PORT_ORDER.md`, `ISA.md:155` and `:185` for `WEB_PARITY_VERIFICATION.md`, `ISA.md:69`, `:177`, `:182`, `:204`, `:206` for `WEB_CONVERSION_ASSESSMENT.md`, `ISA.md:182` for Tier-numbered references). This is a load-bearing inconsistency.
2. **The principle "src/web/ is read-only on this fork" (ISA.md:53) is intact but quietly compromised at the build layer.** The pending tailwind glob fix (Layer 2.1 in `maestro-primitives` worktree) modifies `tailwind.config.mjs`, which is an upstream file. This is the first upstream-config edit since the fork. It is justified, but it sets a precedent — and it is not yet acknowledged anywhere in the ISA's Constraints or Decisions as an exception to the "bias new files" rule (ISA.md:124 ISC-40: "Bias edits to NEW files; minimize touches to upstream's `src/main/` and `src/main/web-server/`.").
3. **The server's `FileStore` is not byte-equivalent to `electron-store` and will silently desync from Electron when `customSyncPath` is set.** `FileStore` reads from `MAESTRO_DATA_DIR` only (`src/shared/data-dir.ts:32-34`, `src/shared/file-store.ts:37-42`). Electron's stores route through `getCustomSyncPath` (`src/main/stores/instances.ts:86`) which can redirect `_syncPath` to a user-specified directory. If a user has set a custom sync path in Electron, the headless server will read defaults silently. The ISA-36 verification (`ISA.md:241-244`) only checked the trivial case (empty data dir).

---

## 1. Vision coherence

The stated vision (`ISA.md:27-31`) is "single Maestro instance on mini2, reachable from any device on the tailnet, same UI, no installs." That vision is internally consistent against the principles (`ISA.md:42-49`) and the out-of-scope list (`ISA.md:35-40`).

Where it gets shaky:

- **Vision vs. shipped UX gap.** The ISA's Conjecture-2026-06-07 (`ISA.md:202-209`) admits the existing `src/web/` bundle is a mobile-companion remote control, NOT a full Maestro UI. The vision text on line 31 ("same Maestro UI") is therefore aspirational — what ships today after L0a+L0b is the mobile-companion surface in a browser. The Tier 0/1/1.5 split in the Conjecture entry resolves this honestly, but the top-of-doc Vision still reads as if Tier 1.5 is the assumed target. **The Vision should explicitly acknowledge that what ships in L0 is mobile-companion-UX-from-a-browser, and that desktop-class web is a deferred decision (ISC-41).**
- **Principle 5 vs. webFull divergence.** Principle 5 (`ISA.md:48`) says "Don't fork code, fork posture. Stay close to upstream." Decision 2026-06-07 (`ISA.md:181`) explicitly accepts forking `src/web/ → src/webFull/`. This is internally inconsistent until you read the qualification "any UX work the upstream maintainer does on `src/web/` will need to be cherry-picked into `src/webFull/`." The principle should be revised to "fork the web UI tree by intent, keep the server tree close to upstream" — the current wording says one thing and the practice does another.
- **Vision vs. Principle 3 (terminals).** Principle 3 (`ISA.md:46`) declares ptys server-owned and persistent across browser disconnects. But Decision-2026-06-07 (`ISA.md:182`) point (5) says "no xterm.js anywhere in renderer — PTY-in-browser is a separate sub-project," and ISC-42 (`ISA.md:129`) is principal-decision-gated. Until ISC-42 is resolved, Principle 3 cannot be honored: there is no path from server-owned pty to user-visible terminal in a browser without xterm.js or an equivalent. This is a principle that is aspirationally true and operationally blocked.

---

## 2. Wave structure soundness

### What landed cleanly

- **L0a** (`ISA.md:186`, commit `7530a134b`, merge `2f2262cfa`): clean. Added 3 new files (`src/server/index.ts`, `src/shared/data-dir.ts`, `src/shared/file-store.ts`) + `tsconfig.server.json` + 2-line `package.json` scripts addition. Zero upstream edits. `grep "from 'electron'" dist/server/` empty per `ISA.md:281-283`.
- **L0b** (`ISA.md:187`, commit `67bb39e91`, merge `0cbd4df5c`): clean. Added `src/server/process-manager-adapter.ts` (108 LOC). Widened `tsconfig.server.json` `include` to pick up `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts`. Verified electron-free (`grep -rn "from 'electron'"` against `src/main/process-manager/` and `src/main/parsers/` returns empty). Three of ten WRITE callbacks now wire through real ProcessManager.
- **L1.1** (`ISA.md:188`, commit `3d0fab668`, merge `3963a6bc0`): clean. Added `vite.config.webfull.mts` + 2-line scripts addition.

### What's brittle

- **The dependency claim "L0 before everything else" is correct but underspecified.** The ISA says L0 unblocks the delegation pipeline (`ISA.md:184`), but L0a's READ callbacks for `getHistory` (`src/server/index.ts:221-225`) stub to `[]`. Any agent porting the History UI gets empty data from the dev server. The ISA acknowledges this (`ISA.md:225`: "the last stubbed to `[]` pending HistoryManager port") but does not list "HistoryManager port" as a layer. It belongs in L0c or L1.
- **The widened tsconfig.server.json (L0b) is a silent invasive change.** `tsconfig.server.json:21-22` now includes `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts`. Both subtrees are electron-free today, but any upstream commit that adds an `import { app } from 'electron'` to either tree will break `npm run build:server` silently — and we have no CI step that runs `build:server` against upstream main. This is a soft rebase-killer waiting in the weeds.
- **The Layer 2 primitives lift will pass the bar but introduce ambiguity.** The inflight `maestro-primitives` worktree has lifted `MODAL_PRIORITIES` and `Layer` types verbatim. These are pure constants/types — no IPC, no Electron, no renderer-only Tailwind classes. But the practice of "lift verbatim" creates two copies of the same constant table (`src/renderer/constants/modalPriorities.ts` and `src/webFull/constants/modalPriorities.ts`). If upstream adds a new priority (Layer.MARKETPLACE, say), the webFull copy will silently miss it. There is no mechanism documented to detect that drift. **Either (a) re-export from `src/renderer/` instead of copying, or (b) move the source-of-truth to `src/shared/` and re-export from both.** Lift-verbatim into webFull creates a duplicate that the constraint system does not catch.
- **The proposed Layer 2 unblock claim is partially right.** `/tmp/web-ui-lift-scope.md:243-247` says lift `LayerStackContext` + `useModalLayer` + `useLayerStack` + `MODAL_PRIORITIES` + `Modal.tsx` once, then "every other renderer modal that uses `<Modal>` becomes liftable in one step." This is true for layout-independent leaf modals, NOT for orchestrator modals (NewInstanceModal, Settings tabs) which depend on Zustand stores and 18-IPC surfaces per `/tmp/web-ui-lift-scope.md:231-233`. Layer 2 unblocks **the leaf-modal sub-class only**. The plan should not over-promise.

### Will the planned Layer 2 actually unblock Layer 3+?

For leaf modals (ConfirmModal, GitStatusWidget, AboutModal): yes.
For orchestrator surfaces (Settings, NewInstanceModal, SessionList): no — they need server-side endpoint sprawl per `/tmp/web-ui-lift-scope.md:185` ("every IPC namespace touched by lifted code grows the server surface by N routes"), which is server-side work, not primitives work.

**Recommendation: split the proposed Layer 2 into "Layer 2a — visual primitives (low-IPC, fast)" and "Layer 2b — server-side endpoint groups (per-IPC-namespace, slow)" so the parallelization story is honest.**

---

## 3. Verification methodology fitness

### The catalog approach is fit for UI ports

`WEB_PARITY_VERIFICATION.md` (referenced at `ISA.md:155`, file not on disk) defines a fixed-vocabulary assertion language for per-feature parity. The vocabulary (`hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`, `broadcast`) is the right level for UI ports: it's layout-independent, behavior-oriented, and can be recorded against Electron and replayed against webFull.

### The catalog approach is over-bar for plumbing work

L0a/L0b/L1.1 are server-side plumbing, not user-visible features. L0a's verification (`ISA.md:217-250`) used smoke probes: `curl`, `lsof`, `grep`, `ps`. L0b used a `POST /:token/api/session/:id/send` smoke (`ISA.md:266-273`). L1.1 used `npm run build:webfull` exit code + asset hash check + `lsof` (`ISA.md:288-339`). None of these are user-story catalogs and they shouldn't be — there is no user to author a story for at the L0b/L1.1 level.

The ISA already implicitly recognizes this: the parity-catalog requirement is scoped to "Per-feature function-parity ISCs (added when each port lands)" (`ISA.md:154`). The Tier-1 table (`ISA.md:136-152`) uses curl/probe/lsof, not catalog.

**Verdict: the catalog bar is correct for what it's scoped to. It should NOT be relaxed for plumbing — it should be explicitly NOT-applied to plumbing, and the ISA should grow an explicit note "Layer 0/1 plumbing ISCs are smoke-probe + grep — they don't get parity catalogs because there is no user story." Otherwise a future agent will read the methodology and demand a parity catalog for the next server-side wire-up.**

### Methodology gap

There is no documented way to detect when a parity catalog's reference recording goes stale. If a renderer-side bug is fixed in upstream and the webFull port was based on the buggy behavior, the catalog will pass on the post-fix Electron (now correct) and the pre-fix webFull (now wrong), and the agent will not know. `WEB_PARITY_VERIFICATION.md` does not (per the referenced text in `ISA.md:185`) document a re-recording cadence. **Recommend: every Nth (e.g. monthly) `git pull upstream main` triggers re-recording of all parity catalogs against Electron and a diff against the prior recordings; a non-trivial diff blocks the merge.**

---

## 4. Standing rules — internal contradictions

### "Bias new files" vs. Layer 2.1 tailwind edit

`ISC-40` (`ISA.md:124`) says "Bias edits to NEW files; minimize touches to upstream's `src/main/` and `src/main/web-server/`." This is read as "stay on additive changes to keep rebases mechanical."

The Layer 2.1 work in `maestro-primitives` modifies `tailwind.config.mjs` (`/Users/trilliumsmith/code/maestro-primitives/tailwind.config.mjs`, single-line glob addition) — and this is the FIRST upstream-file edit on this fork. The change is correct and one-line (`/tmp/web-ui-lift-scope.md:30-36`), but the ISA does not yet have a Decision entry that says "we will modify upstream config files when the modification is purely additive and rebase-safe."

Without that explicit decision:
- The principle reads "bias new files" without exception.
- The practice now diverges on tailwind.config.mjs.
- A future agent reading the ISA will be confused about whether to add the next config glob (Vite alias, postcss plugin, eslint ignore) or whether tailwind was a one-off.

**Recommendation: ISA should add a Decision entry: "Upstream config files (tailwind.config.mjs, postcss.config.mjs, eslint config) may be edited when the edit is (a) purely additive — only adds new entries to lists/objects, never modifies existing — AND (b) the edit is necessary to make a new file (which we own) work. ISC-40 still rules for runtime code under `src/main/`, `src/main/web-server/`, `src/renderer/`."**

### tsconfig.server.json widening is also an upstream-adjacent edit

`tsconfig.server.json` is new (we own it), but Layer 0b widened its `include` to point at `src/main/process-manager/**/*.ts` and `src/main/parsers/**/*.ts` (`ISA.md:259`). This is not editing upstream files, but it is binding our build to upstream files we don't own. If upstream refactors `src/main/process-manager/` to import electron (per §2), our build breaks. **Recommendation: add a smoke test `bun run build:server` on every `git pull upstream main` in the rebase workflow, OR vendor the touched files into `src/server/`.**

### "Catalog is the spec, not the renderer source" vs. lift-verbatim

`ISA.md:185` says "catalog IS the spec — not the renderer source — to protect against agent hallucination and renderer-bug canonization." `/tmp/web-ui-lift-scope.md` proposes lift-verbatim for visual primitives and leaf modals. **Lift-verbatim renderer code WILL canonize whatever renderer-side bugs exist in those files at lift time.** The catalog approach (record-then-replay) doesn't help here because the recording itself would inherit the bug if both sides have it.

**Recommendation: lift-verbatim PRs must include an "Upstream review note" — the agent reviews the lifted file's last 90 days of upstream commits for bugfixes and either cherry-picks them into the webFull copy or files a "TODO: cherry-pick" comment.**

---

## 5. Delegation pipeline scaling

### Current state: 4 active worktrees + 2 stale

Per `git worktree list`:
- `/Users/trilliumsmith/code/maestro` → `main` (`3963a6bc0`)
- `/Users/trilliumsmith/code/maestro-l0b` → `layer-0b` (`67bb39e91`, behind main — merged but worktree not pruned)
- `/Users/trilliumsmith/code/maestro-l0c` → `layer-0c-remaining-writes` (clean, on `3963a6bc0` = main HEAD, no commits yet)
- `/Users/trilliumsmith/code/maestro-l1.1` → `layer-1.1-vite-webfull` (`3d0fab668`, behind main)
- `/Users/trilliumsmith/code/maestro-portorder` → `docs-port-order-lift-first` (clean, on main HEAD, no commits)
- `/Users/trilliumsmith/code/maestro-primitives` → `layer-2.1-primitives-lift` (uncommitted: tailwind glob + 2 new files in `src/webFull/constants/` and `src/webFull/types/`)

**Observations:**

- `maestro-l0b` and `maestro-l1.1` should be pruned now that their branches are merged. They are taking 4-8 GB of disk and adding to the visual sprawl in `git worktree list`. **Action: `git worktree remove maestro-l0b maestro-l1.1` after confirming they're upstreamed.**
- `maestro-l0c` and `maestro-portorder` are sitting at main HEAD with no work yet. They are placeholder worktrees waiting for an agent to spawn. That is fine but invisible — the brief mentioned "4-6 parallel worktrees" but only 2 (`primitives`, in-progress) have actual deltas right now. **The actual concurrency is lower than the worktree count suggests.**
- Three stashes (per `git stash list`) — including `stash@{0}: On layer-1.3-workspace: stray-l1.1-isa-edit-from-collision` — indicate that a prior round of parallel work already produced a merge-collision artifact. The branch `layer-1.3-workspace` doesn't exist in `git branch -a`, so the stash is orphaned. **This is the first concrete evidence that parallel-agent merge resolution has cost time. Drop the orphaned stashes after confirming with Trillium.**

### When does parallel parallel-agent eat more time than it saves?

Threshold heuristic: when two or more branches touch the same file. Today:
- `tailwind.config.mjs` is touched by primitives. No other inflight branch touches it. No collision.
- `package.json` `scripts` block has been touched by L0a (added `build:server`/`start:web`), L1.1 (added `dev:webfull`/`build:webfull`). Both already merged. The next branch that touches `scripts` (e.g. a Layer 2 dev script for a primitives-only build) will be in collision territory if it lands before reasonably new branches rebase.
- `ISA.md` is touched by every layer (Decision entries land in chronological order). The orphan stash `stash@{0}` is exactly an ISA-collision artifact. **ISA.md is currently the most collision-prone file in the project.**

**Recommendations:**

1. **ISA.md edits should land as appended Decision/Verification entries only — never edit prior entries.** When two branches both add a Decision entry under the same date, the merge is trivial (both append). When one branch edits a prior entry and the other appends, the merge gets ugly. This is implicit today (the format invites append) but should be explicit in the workflow rules.
2. **Run a "rebase fan" after every merge to main.** After `merge(layer-X)` lands on main, every inflight branch should `git rebase main` immediately. Today they don't — `maestro-l1.1` is behind main and `maestro-l0b` is too. This is fine when nothing on main touches their files, but it leaves a trap for the next merge.
3. **Cap concurrent inflight branches at 3 with overlapping file scope.** Hard limit prevents the matrix of pairwise rebases from exploding.

### Can primitives and Identity (Layer 3) go in parallel?

Per `/tmp/web-ui-lift-scope.md:243-247`, Layer 2 primitives (Modal, LayerStackContext, MODAL_PRIORITIES) are PREREQUISITES for any modal port in Layer 3+. So strictly speaking, Identity (a Layer 3 candidate) cannot start its modal work until primitives merge. BUT: Identity work that doesn't touch modals (auth token flow, login form built fresh in webFull idiom) can absolutely fan out in parallel.

**Recommendation: the ISA / WEB_PORT_ORDER should explicitly call out which Layer 3+ sub-features have modal dependencies (serial with primitives) vs. which don't (parallel-safe).**

---

## 6. Risks not yet on the radar

### Tailwind / PostCSS / theme risks

- **G1: JIT-mode arbitrary-value classes.** Tailwind v3.4.1's JIT mode generates classes from string literals in source. The current content glob (`tailwind.config.mjs:3`) misses `src/webFull/`. Even after the glob fix, **classes interpolated at runtime** (e.g. `` `bg-${color}-500` ``) never appear as static strings and are never generated. `grep -rn "className=\\\`" src/webFull/` to find these is a pre-flight check that's not in `/tmp/web-ui-lift-scope.md`'s F1 checklist. Add it.
- **G2: PostCSS plugin order.** `postcss.config.mjs:1-7` runs `tailwindcss` then `autoprefixer`. If a future lift adds a CSS-in-JS or PostCSS-Nesting plugin in front of tailwind, classes that depend on tailwind-resolved variables can break. No risk today; add to the "lift checklist" so a future agent doesn't reorder.
- **G3: Theme custom property collisions.** Per `/tmp/web-ui-lift-scope.md:57`, `src/web/index.css:13-26` declares fallback CSS custom properties (`--color-background: #1a1a2e` etc.) with a NAMING CONVENTION different from theme keys. The renderer uses `theme.colors.bgMain` (JS object access). The webFull tree uses BOTH `var(--color-background)` (CSS) AND inline `style={{ color: theme.colors.X }}` (JS). When a lifted renderer component uses inline JS theme access and a sibling webFull-native component uses CSS-var theme access, they're fed by the same theme but through two different code paths — a theme change can desync if the JS-side update fires before the CSS-var injection (or vice versa). The `cssCustomProperties.ts` injector debounce timing is not documented. **Add a verification probe: change theme in webFull, confirm both `var(--color-...)` consumers and `style={{}}` consumers update within a render frame.**
- **G4: Tailwind purge on production but not dev.** `bun run build:webfull` invokes the full Tailwind purge. `bun run dev:webfull` uses JIT mode + HMR which is more lenient. **A class that works in dev mode can be silently stripped in production.** Add a CI step: every webFull lift PR builds production and diffs the asset CSS for the lifted component's required classes. Without this, "works in dev, broken in deploy" is one PR away.

### Renderer → webFull silent failures

- **G5: CSS class collision via Tailwind's `@layer base`.** Renderer's `index.css` (714 lines, per `/tmp/web-ui-lift-scope.md:387`) has prose styles in `@layer base`. WebFull's `index.css` (429 lines) has different `@layer base` rules. When a Modal is lifted from renderer into webFull, the lifted component's expected base styles may not be present — the modal renders, but font sizes, link colors, and `<p>` margins all subtly drift. **Verification gap: the parity-catalog vocabulary (`hasElement`, `hasText`, etc.) does not assert on CSS computed values, so a typography drift passes the catalog but fails the human-eye test.** Add `computedStyleMatches` to the vocabulary, OR mandate an Interceptor screenshot diff per lifted component.
- **G6: Portal/modal stacking with two LayerStackContexts.** If Layer 2 primitives lift `LayerStackContext` into `src/webFull/contexts/` and the lifted modal imports it from there, but some lifted-without-refactor renderer component imports it from `../../renderer/contexts/LayerStackContext`, you get TWO independent LayerStack registries in the same DOM. Z-index ordering becomes order-of-mount-dependent (random). **Add a grep guard pre-build: `! grep -rn "from '@renderer/contexts/LayerStackContext'" src/webFull/` (no webFull file imports renderer-side context).**
- **G7: Theme prop vs context, partial adoption.** `/tmp/web-ui-lift-scope.md:46-50` notes the renderer threads `theme` as a prop, webFull uses `useTheme()` context. The recommended "pick a policy per-lift" leaves you with a tree where some lifted components want `theme` prop and some want `useTheme()`. The first time a lifted component is rendered inside another lifted component, you must remember which one you decided for the inner — type errors will catch some but not all (e.g. `theme: theme || useTheme().theme` patterns silently squash errors and randomly pick).

### Branch sprawl + "commit don't push"

- **G8: Trillium's stated working pattern (forgetful, scattered) is documented (`PRINCIPAL_IDENTITY.md` "Forgetfulness", `TELOS/CHALLENGES.md` C1).** With 6 worktrees and 7 layer-branches (some merged, some not), the visual surface of "which branch to merge next" exceeds his working memory. The orphaned `stash@{0}` is evidence. **Action: `~/.claude/PAI/USER/PROJECTS/PROJECTS.md` should add a "Maestro web port" project entry with a CURRENT-WORK pointer to the active branch. Right now, there is no entry for the Maestro web port in PROJECTS.md.**
- **G9: Push lag → mini2 doesn't see merged work.** Per `ISA.md` Vision, mini2 is the deployment target. If main is merged locally but not pushed (the policy is "commit don't push"), mini2 cannot `git pull` to update its deployed instance. The Vision is "open the URL on phone, it just works" — but the deploy pipeline from local commit → mini2 working tree is not documented anywhere in the ISA. Today there is no L0 deploy: the server has only ever run on the laptop. **The "Tier 2 — Tailscale-hosted, multi-device" criterion ISC-8 (`ISA.md:84`) is currently the most underspecified ISC.**

### Multi-agent node_modules contention

- **G10: Concurrent builds against symlinked node_modules.** Per `ISA.md:254`: "node_modules symlinked from the main repo (`/Users/trilliumsmith/code/maestro/node_modules`) for the test session; symlink removed before commit." This is OK for L0b's single-test scenario. With 4-6 parallel worktrees, if two agents simultaneously run `npm install` on different branches (each agent's harness might do this defensively), they both write to the same shared `node_modules` because the symlink resolves to one shared directory — concurrent `npm install` is not lock-safe. **Standard mitigation: per-worktree `node_modules` (hard `npm ci` per worktree) and accept the disk cost. Alternative: explicit lock file `.maestro-build.lock` and per-agent serialization of `npm install` invocations.**
- **G11: Native-module ABI lock-in.** `node-pty` and `better-sqlite3` are native modules. They are built against ONE specific Node ABI at install time. The main worktree's `node_modules/` was built against whatever Node was active at install. If an agent in a different worktree runs `nvm use 22.something-different && bun start:web`, the native modules may load wrong-ABI binaries silently. **ISC-1 (`ISA.md:73`) covers the install step but not the "different worktree, different Node version" scenario.**

### Upstream-upstream propagation

- **G12: When RunMaestro updates Modal.tsx, does it flow into webFull?** Upstream churn in `src/renderer/components/ui/` over the last 30 days: 1 commit. Upstream churn in `src/web/`: 1 commit. Low. But after Layer 2 lifts Modal.tsx into `src/webFull/components/ui/`, any upstream Modal.tsx bugfix lands ONLY in `src/renderer/components/ui/Modal.tsx`. The webFull copy doesn't get it. **No mechanism exists to detect this drift.** Recommend: monthly `git log upstream/main -- src/renderer/components/ui/Modal.tsx` review pass per lifted file, with a checklist that lives somewhere persistent (ISA Changelog? a new `LIFT_REGISTRY.md`?).
- **G13: `MAESTRO_DATA_DIR` doesn't honor `customSyncPath`.** Major. `src/main/stores/instances.ts:86` shows Electron-side stores use `getCustomSyncPath(_bootstrapStore) || app.getPath('userData')`. The server's `getDataDir()` returns ONLY `MAESTRO_DATA_DIR ?? ~/.config/maestro` (`src/shared/data-dir.ts:32-34`) — it never reads `maestro-bootstrap.json` for `customSyncPath`. If a user has set a custom sync path in Electron (deliberately, to put session data on iCloud Drive or a sync folder), the headless server reads defaults and they're invisible. ISC-36's verification in `ISA.md:241-244` only tested the empty-data-dir case. **Fix: `getDataDir()` should, when running headless, first read the `maestro-bootstrap.json` at `~/Library/Application Support/maestro` (or env-overridden) and use `customSyncPath` if present. Or document the limitation in the README.fork.md (ISC-25) so users know to set `MAESTRO_DATA_DIR` to their sync path manually.**

### The four planning docs that don't exist

- **G14: ISA cites non-existent planning docs as the methodology source.** `WEB_PARITY_VERIFICATION.md` (the "the catalog vocabulary lives here" doc per `ISA.md:155`) is not on disk anywhere. The ISA describes the methodology inline at `ISA.md:185`, so the methodology IS captured — but the cross-reference is broken. If a future agent reads `ISA.md:155` and goes to look at `WEB_PARITY_VERIFICATION.md` to understand the vocabulary in more detail, they will find nothing.
- The same applies to `WEB_PORT_ORDER.md` (`ISA.md:129`, `ISA.md:183`, `ISA.md:184`, `ISA.md:206`, `ISA.md:207`), `WEB_CONVERSION_ASSESSMENT.md` (cited 6 places), and `WEB_FEATURE_PARITY_SCOPE.md` (cited in the audit brief but not in the ISA).
- **Either write the docs OR remove the cross-references and inline the content.** The current state (cite-but-don't-write) is the worst of both worlds.

---

## 7. What to STOP doing

1. **Stop citing planning docs that don't exist.** Either write them now (Trillium reads them, agents reference them) or fold their content into the ISA inline.
2. **Stop using ISA.md as a single-writer file across multiple inflight branches.** `stash@{0}: stray-l1.1-isa-edit-from-collision` is the canary. Mandate "ISA.md edits are append-only Decision/Verification entries with no edits to prior text" — enforced by a pre-merge grep that asserts the diff on ISA.md is additive-only.
3. **Stop creating placeholder worktrees that don't have work in them.** `maestro-l0c` and `maestro-portorder` are at main HEAD with no commits. Create the worktree when the agent starts work; remove when merged. No "waiting" worktrees.
4. **Stop lift-verbatim without an "upstream-bugfix audit" line in the PR.** Lifting code as of a SHA without recording that SHA loses the ability to detect upstream bugfix drift.
5. **Stop assuming the parity catalog covers visual regressions.** The vocabulary (`hasElement`, `hasText`, ...) does not assert on computed styles. Add a screenshot probe OR a `computedStyleMatches` assertion type.

---

## 8. What to START doing

1. **Write the four missing planning docs OR delete the references.** Pick one. Make the ISA self-consistent.
2. **Add a Decision entry to ISA explicitly authorizing upstream-config-file edits when purely additive.** This regularizes the tailwind.config.mjs edit and gives future agents a clear rule.
3. **Add `bun run build:server` to the CI/rebase smoke loop.** The widened `tsconfig.server.json:21-22` include list is a silent rebase trap.
4. **Maintain a `LIFT_REGISTRY.md` at the repo root.** Each lifted file gets one row: `path-in-renderer`, `path-in-webFull`, `lift-SHA`, `last-upstream-review-date`. Monthly review pass scans the registry and runs `git log <lift-SHA>..upstream/main -- <path-in-renderer>` for each row.
5. **Stand up a mini2 deploy probe now, not after Layer 9.** ISC-8/9/10/11 (Tier 2 Tailscale-hosted) are the actual Vision criteria. Doing them after every UI port is shipped means the deploy story is the last thing you'll learn about — and the first thing that will block actual use. Spike: run the `start:web` artifact on mini2 today with the data-dir pointed at an empty directory. Verify ISC-8/9 against a stub. Surface unknowns now.
6. **Add a project row to `~/.claude/PAI/USER/PROJECTS/PROJECTS.md` for the Maestro web port.** Tail-pointer: "CURRENT BRANCH: <branch>. NEXT MERGE: <branch>." With 6 worktrees, Trillium needs this in his startup context.
7. **Make ISA.md edits append-only in workflow.** Pre-merge hook: `git diff --stat main..HEAD -- ISA.md` must show only additions to Decisions/Verification/Changelog sections, never mods to prior lines.
8. **For each lift, run a grep guard against cross-tree imports.** `! grep -rn "from '@renderer/" src/webFull/` (or equivalent for relative paths). Catches G6 (dual LayerStackContext) and similar.
9. **For each lifted component, screenshot-diff via Interceptor against Electron baseline.** The parity catalog vocabulary misses visual regressions; per `CLAUDE.md` standing rule, Interceptor is mandatory for web verification anyway.
10. **Handle `customSyncPath` in `getDataDir()` OR document the limitation prominently.** Today the server silently ignores user sync-path settings.

---

## 9. What's right that the plan should preserve under pressure

1. **The Tier 0/1/1.5 split (`ISA.md:202-209`).** The honest acknowledgment that the existing web bundle is mobile-companion, not full Maestro, is the most important Decision in the project. Under timeline pressure, do NOT let the "Vision" text on `ISA.md:31` quietly become the assumed deliverable. The shipped Tier 0/1 UX is mobile-companion-in-a-browser and that's a meaningful Vision delivery on its own.
2. **`src/web/` is read-only on this fork (ISC-43, `ISA.md:130`).** This is the load-bearing rebase-safety invariant. Even when a webFull bug correlates 1:1 with an `src/web/` bug, do not fix it in `src/web/`. Fix in `src/webFull/` and file the upstream PR.
3. **"Catalog is the spec, not the renderer source" (`ISA.md:185`).** Protects against renderer-bug canonization in the long run. Don't let a frustrated agent decide "the catalog is what the renderer does today" and check in a recording of the buggy behavior as the spec. The catalog should be written from the user-story, not from the recorded behavior.
4. **`tsconfig.server.json` as the electron-leak guard.** `grep -r "from 'electron'" dist/server/` returning empty (`ISA.md:281-283`) is the cleanest possible post-build invariant. Treat it as a tripwire — any commit that adds an electron import to a server-included subtree breaks the invariant.
5. **`ServerProcessManagerAdapter` is the right abstraction shape.** A thin server-side wrapper around the existing `ProcessManager` (`src/server/process-manager-adapter.ts:43-108`) keeps the renderer-side code path unchanged while letting the headless server share the implementation. Don't replace ProcessManager — keep wrapping. Same shape will work for HistoryManager (L0c?), SettingsManager, etc.
6. **No time estimates anywhere (`ISA.md:183`).** Trillium has a documented memory for this exact preference. Don't slip estimates back in under any pressure.

---

## 10. Falsification check

Two concrete observations that would refute the strategy:

### Falsification 1: A lifted leaf modal fails the parity catalog because of orchestrator-only state

If a lifted ConfirmModal (the supposed easiest lift) needs to read `useSessionStore` from the renderer (a Zustand store with 444 lines per `/tmp/web-ui-lift-scope.md:445`) to decide whether to render its "discard changes?" message, then the "low-IPC leaf component" claim is wrong. Observation: `git log` the lifted ConfirmModal's PR and check whether the diff adds a Zustand-store import or a new `useState` shim. If Zustand, the lift cost was higher than the strategy predicts, and the "lift modal+LayerStackContext once unlocks all modals" claim is too rosy.

### Falsification 2: After Layer 0c lands the remaining write callbacks, a phone-side user action still doesn't survive a server restart

The pty-persistence claim (Principle 3, `ISA.md:46`; ISC-13, `ISA.md:88`) is the load-bearing user-visible promise that distinguishes this work from "run Electron headless on mini2." Observation: spawn a pty session from phone, send a command, watch it run, kill the server process, restart it, reload the phone tab. If the pty did NOT survive — if the user sees a fresh terminal with no scrollback — then the whole "decouple from Electron" investment was for nothing the user can feel. The mobile-companion UX would have given the same result without any of this work.

If either falsification fires, the strategy needs a re-PLAN turn, not a continuation.

---

## 11. One-line recommendation

**Keep executing the plan, but pause for a one-merge "consistency turn" before Layer 3 — write the four missing planning docs OR inline-and-delete the references; add the upstream-config Decision entry to legalize the tailwind glob fix; spike the mini2 deploy story to derisk Tier 2; then resume the per-layer port pipeline.**

---

## File path index for this audit

- `/Users/trilliumsmith/code/maestro/ISA.md` — project ISA, principal artifact under audit
- `/tmp/web-ui-lift-scope.md` — UI lift audit (sole on-disk planning doc)
- `/Users/trilliumsmith/code/maestro/src/server/index.ts` — L0a/L0b entrypoint (318 LOC)
- `/Users/trilliumsmith/code/maestro/src/server/process-manager-adapter.ts` — L0b adapter (108 LOC)
- `/Users/trilliumsmith/code/maestro/src/shared/data-dir.ts` — L0a data-dir resolver (45 LOC); customSyncPath gap at lines 32-34
- `/Users/trilliumsmith/code/maestro/src/shared/file-store.ts` — L0a electron-store shim (103 LOC)
- `/Users/trilliumsmith/code/maestro/tsconfig.server.json` — server-only TS build config; widened in L0b at `include` lines 17-25
- `/Users/trilliumsmith/code/maestro/tailwind.config.mjs` — upstream config; L2.1 inflight one-line glob edit in `maestro-primitives` worktree
- `/Users/trilliumsmith/code/maestro/src/main/web-server/web-server-factory.ts:6` — only electron import in the web-server subtree (renderer-side factory, not used in headless path)
- `/Users/trilliumsmith/code/maestro/src/main/web-server/WebServer.ts` — server class (649 LOC); electron-free
- `/Users/trilliumsmith/code/maestro/src/main/web-server/services/broadcastService.ts` — 13 broadcast types; the WS write fan-out
- `/Users/trilliumsmith/code/maestro/src/main/web-server/handlers/messageHandlers.ts` — 13 WS message types received from clients
- `/Users/trilliumsmith/code/maestro/src/main/web-server/routes/apiRoutes.ts:88-302` — 6 HTTP routes (sessions, session detail, session send, theme, session interrupt, history)
- `/Users/trilliumsmith/code/maestro/src/main/stores/instances.ts:86` — electron-store `getCustomSyncPath` indirection NOT mirrored in `data-dir.ts`
- `/Users/trilliumsmith/code/maestro-primitives/src/webFull/constants/modalPriorities.ts` — inflight Layer 2.1 lift, duplicates `src/renderer/constants/modalPriorities.ts`
- `/Users/trilliumsmith/code/maestro-primitives/src/webFull/types/layer.ts` — inflight Layer 2.1 lift, duplicates `src/renderer/types/layer.ts`
- `/Users/trilliumsmith/code/maestro/package.json:scripts` — added by L0a (`build:server`, `start:web`) and L1.1 (`dev:webfull`, `build:webfull`)
- Git state: `git worktree list` returns 6 worktrees, 4 with merged-or-empty branches; `git stash list` shows 3 entries including an orphaned ISA-collision stash on a non-existent `layer-1.3-workspace` branch
- Upstream churn: 1 commit to `src/web/` and 1 commit to `src/renderer/components/ui/` in last 30 days (low risk today; not zero)
