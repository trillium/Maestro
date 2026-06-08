# MERGE_PROTOCOL.md

> Canonical reference for how branches land on `main` during the multi-agent fan-out waves (W2, Layer 2/4/6, leaf parade, doc work). Codifies the discipline that emerged across `layer-2.x`, `layer-6.x`, and `w2-*` merges. Pairs with `WEB_PORT_ORDER.md` (what ships), `ISA.md` (why), and the Delegation skill's `verify-and-merge-branches.md` template (the in-brief checklist).

---

## Why this exists

Three failure classes drove the convention:

1. **Agent-race file stomp** — Two implementation agents on disjoint feature lanes silently picked the same target file when the brief was sloppy. The cost was hours of unwind, not a clean revert.
2. **Push-race on `main`** — Two verify+merge agents both rebased, both pushed; second push lost. The implementation work was fine; the merge serialization was the bug.
3. **ISA.md collisions** — Every branch appends to `ISA.md` (Decisions / Verification entries). With the default 3-way merge driver, every concurrent append was a conflict. Fixed at the substrate by `.gitattributes` `merge=union` (see ISA Decisions 2026-06-08), but the append-only convention is what makes that driver semantically safe.

The protocol below is the load-bearing scaffold that keeps the fan-out wide while keeping `main` clean. Every phase exists to prevent a specific failure mode that has actually bitten us.

---

## Phase 0 — Pre-stage (orchestrator)

Before any implementation agent runs, the orchestrator (main-thread) does the worktree setup. Implementation agents never `git worktree add`; they receive a ready path.

- **Pre-stage a worktree at a known path** off `main`:
  ```
  git fetch origin
  git worktree add ../maestro-<slug> -b <branch-name> main
  ```
- **Pass the absolute cwd in the agent brief.** Every Bash command the agent emits must be prepended with `cd <abs-path> && ...`. Bash subshells don't preserve cwd, and a brief that omits this gets a stream of commands run against the wrong tree.
- **Why pre-stage instead of `isolation: "worktree"`?** The Architect/Engineer `isolation: worktree` frontmatter flag silently lost its default in commit `d8fb18e` (2026-05-31). Worktree mode now requires either a `WorktreeCreate` hook or git-repo cwd; sessions launched from `~/` fail. Pre-staging in the orchestrator side-steps that. Tracked in `~/.claude/PAI/USER/FRICTION.md` under "2026-06-03 [MacBook] Architect/Engineer agents lost `isolation: worktree` default."
- **`node_modules` strategy.** Fresh worktrees lack `node_modules`. Either symlink from the main checkout for the build session and remove before commit (the L0e / L0g / L0f Verification entries in `ISA.md` document the dance), or accept install cost. Symlink-and-remove is the standard.

---

## Phase 1 — Implementation agent (per-branch worktree)

The agent edits, commits, and stops. It does NOT push.

- **Semantic commit message + multi-line body.** Conventional Commits — `feat(scope):` / `fix(scope):` / `wip(scope):` / `chore(scope):` / `docs(scope):`. The body explains what changed AND why; the merge agent reads this verbatim and the orchestrator audits scope from it.
- **No emojis in subject or body.** No time estimates ("X hours" / "X days").
- **Commit-don't-push rule.** The agent finishes by reporting branch + final SHA + files touched + ISCs closed. The orchestrator decides when to push (typically via the verify+merge agent in Phase 2). Reasoning: pushing from a worktree before verification locks the main repo into a state the orchestrator hasn't audited, and a failed validate hook leaves the agent stuck mid-flow.
- **Scope guards self-check (recommended).** Before reporting done, the agent should run the relevant scope-guard greps from the canonical list below and include the results in its report. If `git diff main..HEAD -- src/web/ | wc -c` returns anything other than 0, the agent SHOULD halt and ask, not push the violation forward.
- **ISA appends only.** Decisions / Verification / Changelog entries are write-once-by-date, never edited in place. Union merge driver (`merge=union` in `.gitattributes`) handles concurrent appends correctly only under this discipline.

---

## Phase 2 — Verify+merge agent (main repo cwd)

Runs in the main checkout, NOT the worktree. Merges from `main`'s perspective. Serialized — only one verify+merge agent runs at a time because they race on `git push origin main`. Implementation agents fan out arbitrarily; verify+merge agents queue.

The full per-branch checklist lives in `~/.claude/skills/Delegation/templates/verify-and-merge-branches.md`. Summary:

1. **Read commit metadata.** Semantic format, multi-line body, no emojis, no time estimates.
2. **Diff scope vs merge-base** (NOT vs `main` — main advances while the agent runs):
   ```
   git diff $(git merge-base main <branch>)..<branch> --stat
   ```
   Capture file list + line counts. Cross-check against the original brief's authorized file set.
3. **Scope guards** (run every one; each must return 0 unless explicitly authorized):
   - `git diff $(git merge-base main <branch>)..<branch> -- src/web/ | wc -c` → 0 (read-only fork-hygiene; ISC-43 anti-criterion).
   - `git diff $(git merge-base main <branch>)..<branch> -- src/renderer/ | wc -c` → 0 unless the brief explicitly authorized renderer touches.
   - `git diff $(git merge-base main <branch>)..<branch> -- src/main/ | wc -c` → 0 unless the brief authorized upstream-config / additive `src/main/web-server/{handlers,services}` runtime touches per the 2026-06-08 ISC-40 legalization Decision.
   - `git diff $(git merge-base main <branch>)..<branch> -- package.json package-lock.json | wc -c` → 0 unless a dep change is the explicit scope.
4. **Clean rebuild** of the build target the branch touches. Each rebuild exits 0. (Symlink `node_modules` from the main checkout for the build session, remove before any commit operation.)
5. **Anti-import audits on the rebuilt dist.** Project-specific. For Maestro server builds:
   - `grep -r "from 'electron'" dist/server/` → empty.
   - `grep -r "@sentry/electron" dist/server/` → empty.
   - `grep -r "electron-store" dist/server/` → may match comments only.
6. **Boot smoke (when applicable).** Launch the rebuilt artifact on a unique port. `curl -is http://localhost:<port>/` returns expected status. `lsof -nP -iTCP:<port> -sTCP:LISTEN` shows the expected process, not the wrapping shell. Kill cleanly. Don't leak processes.
7. **ISA Verification entry exists and has concrete command output snippets**, not vague "verified working" lines. If missing or fabricated-looking, FAIL.
8. **Rebase clean, merge `--no-ff` with semantic merge message, push.**
   ```
   git checkout main
   git pull origin main                     # main may have advanced
   git merge --no-ff <branch> -m "merge(<scope>): <one-line summary>"
   git push origin main
   ```
   `Auto-merging ISA.md` in the merge output is expected (union driver) and OK. `CONFLICT` means stop.

**Failure mode handling.** If any check fails, STOP. Don't fix the branch. Don't attempt the next branch in a queued multi-branch run. Report which branch, which check (number from the list), exact command + actual output, one-line interpretation. The orchestrator handles the fix and re-spawns.

---

## Phase 3 — Cleanup

After successful push:

- `git worktree remove <abs-path>` (or `git worktree prune` later if the directory is gone).
- Branch delete on origin and local is optional; current practice retains the branch for audit trail. Local-only delete is fine: `git branch -D <branch>`.

---

## Common failure modes (and what to do)

- **Agent hangs in an optional compile / smoke step.** Tighten the brief. Skip non-load-bearing checks. Stuck-task window is ~10min small / ~20min large; orchestrator should `TaskStop` past that and re-spawn with a narrower scope. Original plist verify+merge hung ~57min before this discipline landed.
- **Push blocked by a validate:push hook.** Real debt to address, not a "--no-verify" call. Format failures: run `npm run format` (or per-project equivalent), commit on top, re-push. Lint failures: same. Validate hooks exist for a reason and skipping them produces the `chore/format-cleanup` debt-cleanup branches that the orchestrator has had to ship reactively.
- **Dirty working tree from a prior hung agent.** Don't bulldoze. `git status` first; reset specific files to HEAD before retrying. A stuck agent that wrote partial state into the main checkout has poisoned the merge agent's view.
- **Notification loss.** Task-notification stream is unreliable; the stats merge completion never surfaced as a `<task-notification>` and was only discovered via `git log`. Standing rule: poll `git log main` directly every ~3 ticks regardless of notifications.
- **`isolation: worktree` agent flag broken.** Pre-stage worktrees in the orchestrator (Phase 0). Don't rely on the agent frontmatter flag until the `WorktreeCreate` / `WorktreeRemove` hook pair lands (FRICTION.md open item, scope ~30-60min).
- **better-sqlite3 ABI mismatch.** Fresh worktrees only get the Electron-v119 prebuild. Manual `cp` of `build/Release/better_sqlite3.node` from the parent repo unblocks. Captured in orchestrator scratch as a known env gotcha.

---

## Scope guards — canonical list

Per the standing fork-hygiene rules, every verify+merge run greps these. Add new guards here when a new lane's invariant gets defined.

| Path | Allowed delta | Why |
|---|---|---|
| `src/web/` | **0 bytes** | Read-only verbatim mirror of upstream. Anti-criterion ISC-43. Fork-hygiene rule. Confirmed in `feedback_maestro_fork_only_edit_webfull.md`. |
| `src/renderer/` | **0 bytes** | Untouched during web-port unless the brief explicitly authorizes (e.g. a renderer-side bug fix surfaced by a port). Default: 0. |
| `src/main/` | **0 bytes** | Untouched during web-port unless the brief authorizes additive `src/main/web-server/{handlers,services}` runtime touches per the 2026-06-08 ISC-40 legalization Decision, or a documented upstream-config edit. |
| `src/webFull/` | Only the lifted target component(s) or their net-new neighbours | Composition layer. Where most port work lands. Scope is bounded by the brief's authorized file list. |
| `src/server/` | Only the additive server entrypoint changes (`src/server/index.ts`, `src/server/process-manager-adapter.ts`, `src/server/sessions-mutator.ts`, etc.) | Headless server graph. Layer 0 lives here. Additive only — no upstream-shape rewrites. |
| `ISA.md` | Append-only (Decisions / Verification / Changelog) | Union merge driver handles concurrent appends correctly only under append-only discipline. Never edit existing entries. |
| `package.json` / `package-lock.json` | **0 bytes** | Unless a dep change is the explicit scope of the brief (e.g. `@sentry/node` + `@sentry/browser` adds in L0e). Treat every diff here as a brief audit failure until proven otherwise. |

---

## Cross-references

- Delegation template: `~/.claude/skills/Delegation/templates/verify-and-merge-branches.md` (the in-brief checklist this protocol summarizes).
- Per-feature ordering: `WEB_PORT_ORDER.md`.
- ISC catalog + Decisions trail: `ISA.md` (especially the 2026-06-08 `merge=union` Decision and the 2026-06-08 ISC-40 legalization Decision).
- Orchestrator parallelism posture: `.orchestrator-scratch.md` "PARALLELISM POSTURE" block (load-bearing — re-read every tick).
- Fork-hygiene rule confirmation: `~/.claude/projects/-Users-trilliumsmith-code/memory/feedback_maestro_fork_only_edit_webfull.md`.
