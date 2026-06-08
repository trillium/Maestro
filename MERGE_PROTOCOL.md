# MERGE_PROTOCOL.md

> Canonical checklist for how branches land on `main` during the multi-agent fan-out waves (W2, Layer 2/4/6, leaf parade, doc work). Codifies the discipline that emerged across `layer-2.x`, `layer-6.x`, and `w2-*` merges. Pairs with `WEB_PORT_ORDER.md` (what ships), `ISA.md` (why), and the Delegation skill's `verify-and-merge-branches.md` template (the in-brief checklist).

---

## Why this exists

Three failure classes drove the convention:

1. **Agent-race file stomp** — Two implementation agents on disjoint lanes silently picked the same target file. Cost was hours of unwind.
2. **Push-race on `main`** — Two verify+merge agents both rebased and pushed; second push lost. Merge serialization was the bug.
3. **ISA.md collisions** — Concurrent appends conflicted under the default 3-way driver. Fixed by `.gitattributes` `merge=union` (Decisions 2026-06-08), but only safe under append-only discipline.

Every phase below prevents a specific failure mode that has actually bitten us.

---

## Phase 0 — Pre-stage (orchestrator)

Orchestrator (main-thread) does worktree setup. Implementation agents never `git worktree add`; they receive a ready path.

- [ ] `git fetch origin`
- [ ] Pre-stage worktree at known path off `main`:
      `git worktree add ../maestro-<slug> -b <branch-name> main`
- [ ] Pass absolute cwd in the agent brief. Every Bash command the agent emits must be prepended with `cd <abs-path> && ...` (Bash subshells don't preserve cwd).
- [ ] Symlink `node_modules` from main checkout for the build session; remove before any commit. (Fresh worktrees lack `node_modules`; install cost is otherwise the price.)
- [ ] If a multi-branch chain: pre-stage all branches up front; do NOT rely on the agent's `isolation: worktree` frontmatter flag (broken since `d8fb18e` 2026-05-31; FRICTION.md open).

---

## Phase 1 — Implementation agent (per-branch worktree)

Agent edits, commits, and stops. It does NOT push.

- [ ] Conventional Commits subject: `feat(scope):` / `fix(scope):` / `wip(scope):` / `chore(scope):` / `docs(scope):`.
- [ ] Multi-line body explaining what changed AND why. Merge agent reads this verbatim; orchestrator audits scope from it.
- [ ] No emojis in subject or body. No time estimates ("X hours" / "X days").
- [ ] Commit-don't-push. Report branch + final SHA + files touched + ISCs closed.
- [ ] Run scope-guard greps from the canonical list below; include results in the report. If `git diff main..HEAD -- src/web/ | wc -c` is non-zero, HALT and ask — do not push the violation.
- [ ] ISA appends only — Decisions / Verification / Changelog entries are write-once-by-date, never edited in place. Union merge is safe only under this discipline.

---

## Phase 2 — Verify+merge agent (main repo cwd)

Runs in the main checkout, NOT the worktree. Serialized — only one verify+merge agent runs at a time (push race on `main`). Implementation agents fan out arbitrarily; verify+merge queues.

Full per-branch checklist lives in `~/.claude/skills/Delegation/templates/verify-and-merge-branches.md`.

For each branch in the queue:

- [ ] Read commit metadata: semantic format, multi-line body, no emojis, no time estimates.
- [ ] Diff scope vs merge-base (NOT vs `main` — main advances while the agent runs):
      `git diff $(git merge-base main <branch>)..<branch> --stat`
      Cross-check file list + line counts against the brief's authorized files.
- [ ] Run every scope guard; each must return 0 unless explicitly authorized:
      - `git diff $(git merge-base main <branch>)..<branch> -- src/web/ | wc -c` → 0
      - `git diff ... -- src/renderer/ | wc -c` → 0 unless brief authorized
      - `git diff ... -- src/main/ | wc -c` → 0 unless brief authorized (additive `src/main/web-server/{handlers,services}` per the 2026-06-08 ISC-40 legalization Decision)
      - `git diff ... -- package.json package-lock.json | wc -c` → 0 unless dep change is the explicit scope
- [ ] Clean rebuild of the build target the branch touches. Each rebuild exits 0. (Symlink `node_modules` from main checkout; remove before any commit op.)
- [ ] Anti-import audits on rebuilt dist. For Maestro server builds:
      - `grep -r "from 'electron'" dist/server/` → empty
      - `grep -r "@sentry/electron" dist/server/` → empty
      - `grep -r "electron-store" dist/server/` → may match comments only
- [ ] Boot smoke (when applicable): launch artifact on a unique port, `curl -is http://localhost:<port>/` returns expected status, `lsof -nP -iTCP:<port> -sTCP:LISTEN` shows expected process. Kill cleanly. Don't leak.
- [ ] ISA Verification entry exists with concrete command output, not vague "verified working" lines. Fabricated-looking → FAIL.
- [ ] Rebase clean, merge `--no-ff` with semantic merge message:
      `git checkout main && git pull origin main`
      `git merge --no-ff <branch> -m "merge(<scope>): <one-line summary>"`
      `Auto-merging ISA.md` is expected (union driver). `CONFLICT` means stop.

**Chain-merge optimization — single push at end.** For 3+ queued branches, defer `git push origin main` until ALL branches in the chain are merged locally. Saves one ~3min `validate:push` hook run per branch (e.g. 9min saved on a 3-branch chain). Loses nothing — verify+merge is already serialized, and a fail mid-chain is recovered the same way either way (reset to pre-chain SHA, re-spawn from the failed branch). Push pattern at chain end:
      `git push origin main`

**Barrel-collision resolution — `src/webFull/components/index.ts`.** When two branches both add export sections to the components barrel, the union driver produces a textually-correct file that may contain duplicate export lines. Resolution rule: keep BOTH sections; manually dedupe exports if (and only if) the same identifier is exported twice. Default action when in doubt: keep all sections, run `npx tsc --noEmit` — TS will flag any actual collision. (Confirmed pattern, chain-merges #2 + #3.)

**Bounded conflict-resolution authority.** When the orchestrator brief explicitly says "branch wins for file X" (e.g. an ISA Decision documents a deliberate replace), the verify+merge agent IS authorized to resolve that specific conflict in the named direction WITHOUT escalating. The brief must name (a) the exact file path, (b) the winning side (`--ours` / `--theirs` / specific branch SHA), and (c) cite the ISA Decision granting authority. Any conflict NOT named in the brief = STOP and escalate. This pattern keeps chain-merges flowing without per-conflict bounce-backs while preserving "no silent decisions."

**Failure mode handling.** If any check fails, STOP. Don't fix the branch. Don't attempt the next queued branch. Report which branch, which check, exact command + actual output, one-line interpretation. Orchestrator handles the fix.

---

## Phase 3 — Cleanup

After successful push:

- [ ] If the merged work touched `src/server/`, run `npm run build:server` from the main checkout and verify dist boots. Discipline failed twice in prior waves (audit #5 N2) — server builds are NOT covered by per-branch `validate:push` and can break silently when chain-merges land additive server code. One quick rebuild + smoke at chain-end catches it.
- [ ] `git worktree remove <abs-path>` (or `git worktree prune` later if directory is gone).
- [ ] Branch delete: local-only `git branch -D <branch>` is fine. Origin delete is optional; current practice retains origin branches for audit trail.

---

## Common failure modes

- **Agent hangs in optional compile / smoke.** Tighten brief; skip non-load-bearing checks. Stuck window: ~10min small, ~20min large. Orchestrator `TaskStop` past that, re-spawn narrower. (Original plist verify+merge hung ~57min before this landed.)
- **Push blocked by `validate:push`.** Real debt, not a `--no-verify` call. Format fails: run `npm run format`, commit on top, re-push. Same for lint.
- **Dirty working tree from a prior hung agent.** Don't bulldoze. `git status` first; reset specific files to HEAD before retrying.
- **Notification loss.** Task-notification stream is unreliable. Poll `git log main` every ~3 ticks regardless of notifications.
- **`isolation: worktree` flag broken.** Pre-stage in Phase 0. Don't rely on agent frontmatter until `WorktreeCreate`/`WorktreeRemove` hooks land (FRICTION.md open).
- **better-sqlite3 ABI mismatch.** Fresh worktrees only get the Electron-v119 prebuild. Manual `cp build/Release/better_sqlite3.node` from parent unblocks.

---

## Scope guards — canonical list

Every verify+merge run greps these. Add new guards here when a new lane's invariant gets defined.

| Path | Allowed delta | Why |
|---|---|---|
| `src/web/` | **0 bytes** | Read-only verbatim mirror of upstream. Anti-criterion ISC-43. Confirmed in `feedback_maestro_fork_only_edit_webfull.md`. |
| `src/renderer/` | **0 bytes** | Untouched during web-port unless the brief authorizes a renderer-side fix surfaced by a port. Default: 0. |
| `src/main/` | **0 bytes** | Untouched unless brief authorizes additive `src/main/web-server/{handlers,services}` per the 2026-06-08 ISC-40 legalization Decision, or a documented upstream-config edit. |
| `src/webFull/` | Lifted target component(s) or net-new neighbours | Composition layer. Where most port work lands. Bounded by the brief's authorized file list. |
| `src/server/` | Additive entrypoint changes only (`src/server/index.ts`, `process-manager-adapter.ts`, `sessions-mutator.ts`, etc.) | Headless server graph. Layer 0 lives here. Additive only — no upstream-shape rewrites. |
| `ISA.md` | Append-only (Decisions / Verification / Changelog) | Union merge driver safe only under append-only discipline. Never edit existing entries. |
| `package.json` / `package-lock.json` | **0 bytes** | Unless dep change is the explicit scope (e.g. `@sentry/node` + `@sentry/browser` adds in L0e). Treat every diff here as a brief-audit failure until proven otherwise. |

---

## Cross-references

- Delegation template: `~/.claude/skills/Delegation/templates/verify-and-merge-branches.md`.
- Per-feature ordering: `WEB_PORT_ORDER.md`.
- ISC catalog + Decisions trail: `ISA.md` (esp. 2026-06-08 `merge=union` and ISC-40 legalization Decisions).
- Orchestrator parallelism posture: `.orchestrator-scratch.md` "PARALLELISM POSTURE" block (re-read every tick).
- Fork-hygiene rule: `~/.claude/projects/-Users-trilliumsmith-code/memory/feedback_maestro_fork_only_edit_webfull.md`.
