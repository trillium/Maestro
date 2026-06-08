# Plan re-eval #3 — Maestro web-port — 2026-06-07

> Architect read-only re-evaluation. Cadence trigger: +11 substantive commits to local main since `89fd6f797` (plan-reeval-2 base), 3 Engineer agents now fanning in parallel, queue thinning. Successor to `/tmp/plan-reeval-2.md`.
>
> Local `main` HEAD: `e6b28c4ba`. `origin/main` HEAD: `19048d2ec` (11 commits behind local — format-cleanup push chain still in flight).
> Worktrees active: 10. Branches with committed work past `main`: zero in flight (plist-template = `a29a570f7`, ahead of main but stale-headed deployprep ref).
> ISC ledger: 55 total, 3 closed (`[x]`), 52 open.

---

## TL;DR

Trajectory is **healthy and accelerating**. plan-reeval-2's entire Wave 1 + Wave 2 + half of Wave 3 landed on local `main` in one session — L6.3 (`e8816abe5`), L2.4 (`898eeaecc`), W2-wakatime (`f63342716`), W2-stats (`c0513d4d9`), infra deploy prep with postinstall guard + probe wiring + FIRST_DEPLOY_BRIEF (`19048d2ec`), and a repo-wide prettier baseline (`d7297478d`). The one thing to change: **the three live Engineer agents (format-cleanup push chain, Layer 4.1 session-list, W2 fonts) are not yet producing commits on their branches** — layer-4.1-session-list and w2-fonts-server-port both still point at `main` HEAD with only uncommitted scratch (a 176-LOC `src/server/fonts-manager.ts` on w2-fonts, nothing on layer-4.1) — so the parallelism is real but the throughput is still pre-commit. If those three don't ship within the next tick window, the orchestrator should suspect agent-stuckness rather than agent-progress and use TaskStop per its own stuck-task rule (`.orchestrator-scratch.md:17`).

## Recent shipped (since plan-reeval-2 base `89fd6f797`)

Eleven commits, six substantive merges:

- `e6b28c4ba` chore(format): strip trailing whitespace from 2 files
- `d7297478d` Merge chore/format-cleanup: prettier debt cleanup, unblocks push pipeline
- `3229174e2` chore(format): repo-wide prettier cleanup + ignore orchestration docs
- `c0513d4d9` Merge w2-stats-server-port: stats server-half (ISC-44.general.stats CLOSED)
- `c4d3ae73d` feat(w2-stats): port StatsDB to server-side + REST routes
- `19048d2ec` merge(infra): mini2 deploy prep — postinstall guard + probe wiring + FIRST_DEPLOY_BRIEF
- `04f81772a` feat(infra): mini2 deploy prep — postinstall guard + probe wiring + first-deploy brief
- `f63342716` merge(w2-wakatime): server-side WakaTime port + REST routes (ISC-44.general.wakatime server-half)
- `1f5fae10e` feat(w2-wakatime): port WakatimeManager to server-side + REST routes
- `898eeaecc` merge(layer-2.4): lift ResetTasksConfirmModal + PlaybookNameModal + CreateGroupModal
- `e8816abe5` merge(layer-6.3): disk-backed PTY scrollback + ISC-45 falsification probe (PASS local)

Closed three ISCs: `ISC-44.general.wakatime`, `ISC-44.general.stats`, `ISC-44.global.settings_broadcast` (already closed pre-reeval-2). ISA shows three `[x]` entries vs 55 total — counts confirm.

## Current parallelism posture

**Right-sized in spawn count, under-validated in throughput.** Three lanes are disjoint and correctly chosen:
- format-cleanup push chain → `chore/format-cleanup` (deploy infra: pushes 11 unpushed commits to origin)
- Layer 4.1 session list → `layer-4.1-session-list` (renderer lane — `src/webFull/components/SessionList/`)
- W2 fonts → `w2-fonts-server-port` (server lane — `src/server/fonts-manager.ts`)

Branches verified non-overlapping. **But:** as of this audit, `layer-4.1-session-list` HEAD = `e6b28c4ba` (= main) with `git status` clean (no work yet); `w2-fonts-server-port` HEAD = `e6b28c4ba` (= main) with one untracked file `src/server/fonts-manager.ts` (176 LOC, not committed); `chore/format-cleanup` HEAD = `3229174e2` (already merged at `d7297478d`). The push half of the format-cleanup chain is what's live; the layer-4.1 and w2-fonts agents are doing work but haven't committed yet.

**Concrete fan-out evidence the orchestrator is using parallelism correctly:**
- Wave 1 (verify+merge L6.3 + L2.4 from plan-reeval-2) → both done in one tick (`e8816abe5`, `898eeaecc`).
- Wave 2 from plan-reeval-2 (postinstall fix + probe wiring + FIRST_DEPLOY_BRIEF) → done in one merge (`19048d2ec`). The MAESTRO_HEADLESS=1 env guard is live in `package.json:45`; `infra/deploy.sh` exports it; `infra/probe-pty-survival.sh` is integrated via `--probe` / `--auto-probe` flags. This is exactly what plan-reeval-2 §5 Wave 2 prescribed.
- W2 server-side ports (wakatime + stats) → shipped serially, not in parallel. **This is the under-fanning surface**: wakatime and stats are independent server-side ports on disjoint files. They could have been spawned simultaneously. They weren't.

Net: the orchestrator is correctly identifying disjoint lanes but is sometimes shipping them sequentially when they could be parallel. The Wave 2 fan-out (deploy infra) was a single-agent task; W2 (wakatime then stats) was sequential when it could have been parallel.

## Drift check

- **N1 (real / monitor):** **Local main is 11 commits ahead of origin/main.** `e6b28c4ba` vs `19048d2ec`. The format-cleanup push chain has been "shipping it now" per scratch (line 4) since 23:43. If `git push` is stuck for an environmental reason (auth flake, network, hook), the orchestrator should TaskStop the agent and push directly. **Evidence:** `git rev-list --count origin/main..main` would return 11; format-cleanup worktree has no uncommitted state (working tree clean).
- **N2 (real / monitor):** **`dist/server/` is stale relative to live source.** `ls dist/server/` shows `history-manager.js`, `process-manager-adapter.js`, `raw-pty-multiplexer.js`, `sentry.js`, `index.js` — missing the post-W2 modules `wakatime-manager.js` and `stats-manager.js`. The source files exist at `src/server/wakatime-manager.ts` (`f63342716`) and `src/server/stats-manager.ts` (`c0513d4d9`) but `npm run build:server` has not been re-run on main since these landed. Anyone running `node dist/server/index.js` right now gets pre-W2 behavior. **This is the orchestrator's responsibility to surface** — the merges shipped without a post-merge `build:server` invocation. Should be a standing post-merge step for any `src/server/` touch.
- **N3 (real / monitor):** **`webFull/hooks/useSessions.ts` already exists at main `HEAD` (a 14931-byte hook on the `src/web/` mobile-companion side that was forked into `src/webFull/`).** Layer 4.1 brief presumably says "extend / replace the existing hook," but if the briefed agent treats it as new-file work they will either (a) write `useSessions.v2.ts` (drift) or (b) overwrite without realizing the existing imports route through `useWebSocket` and define `SessionData` / `AITabData` / `UsageStats` types other modules consume. **Evidence:** `head -50 src/webFull/hooks/useSessions.ts` shows full type exports and a real implementation. The Layer 4.1 brief should be explicit: "extend the existing hook; preserve type exports; add a session-list view component that consumes it." If the brief isn't explicit, the agent will produce drift.
- **N4 (real / monitor):** **The `merge=union` driver hasn't been stress-tested by parallel ISA edits since plan-reeval-2 flagged it.** Both L6.3 and L2.4 went through clean rebases (they had to — plan-reeval-2 N3-new predicted the L6.3 union-merge artifact). The drift item plan-reeval-2 flagged didn't fire because the verify+merge agent rebased L6.3 onto post-W2-ISC14 main first. Good — but no merge-protocol doc captures this; the next un-coached agent will repeat the conflict. plan-reeval-2 START directive named this; it has not landed.
- **N5 (real / not real):** Bundle-size budget — plan-reeval-2 N2-new flagged the mobile chunk at 1254 kB raw / 392 kB gzip. Layer 4.1 will add SessionList (1247 LOC) + dependencies. No `chunkSizeWarningLimit` was set in `vite.config.webfull.mts`. The post-W2-stats + Layer 4.1 build will be the first to test if Vite's default warning gets noisy. **Not yet observed as drift; will be observable after Layer 4.1 builds.**
- **N6 (real / not real):** Doc drift on `WEB_PORT_ORDER.md`. plan-reeval-2 §3 flagged: Layer 0 still says L0a/b/c only (reality is L0a-h), Layer 6 still says "principal-decision-gated" (reality is shipped). **Still not refreshed.** No agent picked up the doc-refresh in this round. WEB_PORT_ORDER.md HEAD-modification date unchanged. This is a quiet rotting surface — every new agent reads the stale doc.
- **N7 (real / surface, low severity):** mini2 deploy still hasn't been executed. Wave 2 from plan-reeval-2 prepped everything; Trillium has not yet run `./infra/deploy.sh` on mini2. ISC-45 still hasn't run end-to-end. The marquee Vision check (`ISA.md:31` — phone Safari sees scrollback after launchd respawn) remains the longest-lived deferral. **Not drift in agents' behavior — drift in waiting for the principal action that closes 6 ISCs at once.**

## STOP

- **Stop fanning out new feature ports until the three in-flight agents commit something.** layer-4.1 and w2-fonts have non-trivial briefs but zero commits. Spawning a 4th parallel agent now adds queue depth without adding throughput. Validate the existing fan-out first.
- **Stop merging `src/server/` changes without running `npm run build:server` post-merge.** N2 is live evidence that `dist/server/` is stale.
- **Stop deferring the `WEB_PORT_ORDER.md` doc refresh.** Two rounds of audits have flagged it. Spend one agent's turn on it. Doc rot compounds: every new agent reads the stale doc and absorbs the wrong layer numbering / Layer 6 scope wording.
- **Stop accepting "git push blocked" as a transient.** The format-cleanup chain has been "pushing now" since 23:43. If push is stuck, TaskStop and let the orchestrator push directly. Local main 11 ahead of origin is the worst-case state for parallel agents — every new branch they cut is off-origin and may need re-rebasing once push lands.

## START

- **Start a post-merge `build:server` validation step.** After any `src/server/*.ts` merge, the orchestrator (or a tiny verify agent) runs `npm run build:server && grep -r "from 'electron'" dist/server/` and confirms exit 0 + empty grep. Stale `dist/server/` is silent rot.
- **Start writing the merge-protocol doc plan-reeval-2 START directive named.** L6.3 demonstrated the rebase-onto-current-main-before-merge discipline; it's not captured anywhere. ~80 lines at `MERGE_PROTOCOL.md` or as a section in `PLAN.md`. The L2.4 + L6.3 + W2-* merges all worked because the verify+merge agent already knows this; it won't survive a new agent who hasn't been briefed.
- **Start the Layer 4.1 brief refinement** before the next agent picks it up. The existing `src/webFull/hooks/useSessions.ts` (14931 bytes) needs explicit "extend, don't replace; preserve type exports; layer the session-list view on top" framing. Without it, drift is predictable.
- **Start parallelizing within waves.** wakatime + stats were sequential. fonts + (next renderer leaf) could be parallel. The standing rule from `.orchestrator-scratch.md:11-15` is "fan out by default" — apply it to W2 remnants too, not just deploy-infra vs renderer.
- **Start counting against the bundle-size budget.** Set `build.chunkSizeWarningLimit: 1500` in `vite.config.webfull.mts` (the current actual size), commit it, and treat any subsequent Vite warning as a real signal that someone added weight. Otherwise the warning has been crying wolf since pre-L6.2 and is being ignored.

## CONTINUE

- **Continue the pre-merge falsification-probe discipline.** L6.3's `infra/probe-pty-survival.sh` is the canonical example. W2-wakatime and W2-stats both shipped without probes; the next server-side port (fonts) should ship with a probe: start server → hit `/api/fonts/detected` → kill -9 → restart → re-hit. Same pattern, three minutes per port.
- **Continue ISC-44.x deferral tracking.** The convention is paying off — every "Coming in subsequent layers" panel now has a tracked ISC. Three are now closed (`wakatime`, `stats`, `settings_broadcast`); 7 remain open (`sync`, `shells`, `font_family`, `bionify_info_modal`, plus 3 DROPPED). Keep it up; do not invent ISC-44.x as a way to defer harder work.
- **Continue the ISC-40 additive-runtime-edit Decision-per-touch convention.** L6.1 + W2-* server-side ports + L0h all touched `src/main/web-server/` or `src/main/process-manager/` additively. Each had a Decision entry naming the file + the rationale. This is the right shape; do not loosen it.
- **Continue worktree-isolation discipline.** 10 worktrees right now is fine because they're disjoint lanes. Prune merged ones (`maestro-isc14`, `maestro-stats`, `maestro-wakatime`, `maestro-l2.4`, `maestro-l6.3`, `maestro-deployprep`) at the next pruning pass.

## Falsifiable predictions

If any of these prove wrong in the next session, the strategy needs re-PLAN.

1. **Layer 4.1 session-list will need to add `<LayerStackProvider>` wiring** to `src/webFull/App.tsx` (still not mounted per ISA Decision 2026-06-08 "Wiring deferred — LayerStackProvider not yet mounted") OR will fail at first modal compose with a "no layer stack registered" error. If the agent ships L4.1 without touching App.tsx and the parity tests still pass, the LayerStackProvider deferral was a misdiagnosis and the primitives don't actually need it.
2. **The format-cleanup push chain will succeed without orchestrator intervention.** If origin/main remains at `19048d2ec` for another 2 ticks, the push is structurally blocked (auth / network / hook), not just slow. At that point TaskStop is the correct action.
3. **W2-fonts will close `ISC-44.display.font_family` server-half within this wave** without needing a `WEB_PORT_ORDER.md` doc-refresh first. The lift pattern from wakatime/stats is mechanical enough that the briefed agent should be able to complete it. If the agent stalls, the brief is the failure mode, not the pattern.

## Wave queue priority order

Reordered by impact-to-ideal-state, not by cheapness. The "ideal state" is full webFull parity, multi-machine, mini2-hosted, browser-from-anywhere.

1. **Push origin sync (currently in flight, format-cleanup chain).** Until this lands, every new branch is off-origin and parallel branches risk diverging from what consumers see. Highest-priority because it's the foundation under everything else and it's *stuck*.
2. **Trillium runs `./infra/deploy.sh --auto-probe` on mini2.** Principal-action-shaped. Unblocks ISC-8, ISC-9, ISC-10, ISC-11, ISC-12, ISC-13, ISC-45 in one shot. The orchestrator can't do this; the brief is already written (`infra/FIRST_DEPLOY_BRIEF.md`). The orchestrator's job is to surface that this is the next high-leverage move and stay out of the way. Equal-priority with #1 because they unblock different lanes.
3. **Layer 4.1 + 4.2 session-list + tab nav (currently in flight).** This is the first user-visible "real Maestro feature" port. Without it, mini2's webFull is a settings surface with no way to browse work. Highest user-felt impact among code-side work.
4. **W2 fonts (in flight) + W2 sync paths + the deferred-panel wiring.** Together close 4 of the remaining 6 deferred ISC-44.x. Cheap server ports — but only 4 of them moves Trillium 0% closer to "I can use Maestro on mini2." So this lane is high-throughput but lower per-unit impact than #3.
5. **MERGE_PROTOCOL.md + WEB_PORT_ORDER.md doc refresh.** Single agent. ~150 LOC total of markdown. Removes friction from every subsequent agent brief. Should run in parallel with #3 and #4 (zero source overlap).
6. **L2.5+ leaf parade continuation (~21 Tier A candidates remaining).** Compounding polish. Each leaf is small but the discipline of keeping them visible (via the brain-side `lift-registry` that plan-reeval-2 Wave 5 proposed and that still isn't written) is what makes the queue sustainable.
7. **NewInstanceModal port (plan-reeval-2 Hard-1).** Biggest single remaining feature port — 1822 LOC, 18 IPC, blocks "create a session in webFull." Sequenced after #3 (session list exists first; you can't create the second one if there's no first one to compare against).
8. **AutoRun port (plan-reeval-2 Hard-2).** Largest renderer surface. Wait until Hard-1 ships so the lift pattern from it informs this.

## Next leaf parade batch (concrete picks)

Six disjoint-lane lifts from the ~21 Tier A pool, picked for: (a) zero `window.maestro` IPC, (b) zero `shell.openExternal` / `shell.openPath`, (c) zero overlap with each other in file path, (d) cheap enough to verify in one agent turn each. All confirmed via `grep -c "window.maestro"`.

1. **`src/renderer/components/PlaybookDeleteConfirmModal.tsx`** (70 LOC, 0 IPC). Direct sibling of the L2.4 PlaybookNameModal lift; same `ConfirmModal` composition pattern. Mechanical.
2. **`src/renderer/components/DeleteGroupChatModal.tsx`** (77 LOC, 0 IPC). Same pattern as CreateGroupModal which shipped in L2.4.
3. **`src/renderer/components/RenameGroupChatModal.tsx`** (77 LOC, 0 IPC). Sibling of RenameTabModal (L2.3); reuses Modal + FormInput primitives already lifted.
4. **`src/renderer/components/RenameGroupModal.tsx`** (87 LOC, 0 IPC). Same shape as #3.
5. **`src/renderer/components/DeleteAgentConfirmModal.tsx`** (147 LOC, 0 IPC). ConfirmModal compose.
6. **`src/renderer/components/SessionListItem.tsx`** (318 LOC, 0 IPC). **High-strategic-value pick**: it's a pure-presentational leaf that the Layer 4.1 SessionList port will consume. Lifting it in parallel with L4.1 means the L4.1 agent has a webFull-native item component ready when it needs one, rather than re-deriving it from renderer source. If L4.1 finishes first, this lift becomes part of L4.1's parity coverage retroactively. Either way, no wasted work.

All six lifts are renderer→webFull-only — zero `src/main/` or `src/server/` touch. Disjoint lanes. Parity-test catalog for each is the same shape L2.3 + L2.4 established (assertion vocabulary restricted to `hasElement` + `hasText`, ≥3 stories, ≥1 negative-path).

**Sequencing note:** spawn 1, 2, 3, 4 first as a single parallel batch (smallest, most mechanical). Hold 5 and 6 for the second batch — #5 is medium size, #6 should be coordinated with whatever the L4.1 agent ships (the brief should say "use the webFull SessionListItem if it has landed; otherwise mark it as a follow-on lift target"). The orchestrator should NOT spawn #6 simultaneously with L4.1 itself — let L4.1 declare what shape it needs first.

---

End of re-evaluation #3.
