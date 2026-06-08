# LIFT_REGISTRY.md

> Tracks `src/renderer/components/` → `src/webFull/components/` lift status.
> Update on every lift merge. Audit reeval-N consults this instead of re-grepping.
>
> Conventions:
>
> - **Lifted** — file exists at `src/webFull/components/<Name>.tsx` (or sub-tree).
> - **Reserved** — named in an audit as "needs dedicated brief"; do NOT pull into a leaf-parade.
> - **Available** — touches 0 `window.maestro.*` IPC namespaces and 0 Electron-only APIs; safe for leaf-parade lift.
> - **Skipped** — non-zero IPC touch count; deferred until a wave-specific brief decides on a webFull-side abstraction.
>
> Source of truth for IPC counts: pre-flight grep of `window.maestro\.` inside the component file. Re-run on each wave.

---

## Lifted (in `src/webFull/components/`)

Lift status as of chain-merge #8 (main @ `c51ff6e`). Branch / merge SHA tracked where known; otherwise marked "merged".

### Modals

- AgentErrorModal — merged (L2.5 wave)
- AutoRunnerHelpModal — merged
- ConfirmModal — merged (L2.1 wave)
- CreateGroupModal — merged
- DeleteAgentConfirmModal — merged
- DeleteGroupChatModal — merged
- DeleteWorktreeModal — merged
- HistoryHelpModal — merged
- PlaybookDeleteConfirmModal — merged
- PlaybookNameModal — merged
- QuitConfirmModal — merged
- RenameGroupChatModal — merged
- RenameGroupModal — merged
- RenameTabModal — merged (L2.x wave; wire-up completed in `chore/hygiene-wave`)
- ResetTasksConfirmModal — merged
- ShortcutsHelpModal — merged

### Leaves / primitives

- Badge — merged
- Button — merged
- Card — merged
- CollapsibleJsonViewer — merged (L2.5 wave; cross-fork import in `AgentErrorModal` retargeted in `chore/hygiene-wave`)
- ContextWarningSash — merged
- ExecutionQueueIndicator — merged
- FirstRunCelebration — merged
- GroupChatHeader — merged
- GroupChatMessages — merged
- Input — merged
- MarkdownRenderer — merged
- PullToRefresh — merged
- QRCode — merged
- SessionList — merged
- SessionListItem — merged
- SettingCheckbox — merged
- TabBar — merged
- ThemePicker — merged
- ThemeProvider — merged
- ToggleButtonGroup — merged
- WelcomeContent — merged

### UI primitives (`src/webFull/components/ui/`)

- Modal — merged (L2.1 wave)
- FormInput — merged
- EmojiPickerField — merged

---

## Reserved (need dedicated brief, NOT generic leaf-parade)

- **QuickActionsModal** (1526 LOC) — pending. Touches multiple IPC namespaces and embeds command-palette logic worth its own design pass.
- **MarketplaceModal** (1434 LOC) — pending. GitHub import + asset-pack handling; needs a webFull-side fetch story.
- **GroupChatInput** (662 LOC) — pending; **precondition: lift `QueuedItemsList` + `participantColors` first**, otherwise the lift drags renderer-only context with it.

---

## Available (0 IPC, ready for leaf-parade)

Pattern: pure presentational components with no `window.maestro.*` touches and no Electron-only APIs. Sample entries (not exhaustive — audits keep finding more as the tree gets pruned):

- AchievementCard
- AppOverlays
- CsvTableRenderer
- EmptyStateView
- ImageDiffViewer
- LightboxModal
- MaestroSilhouette
- MergeProgressOverlay
- MermaidRenderer
- ParticipantCard
- StandingOvationOverlay
- SummarizeProgressOverlay
- ThinkingStatusPill
- Toast
- ToolCallCard

Verify with a fresh `grep -lE 'window\.maestro\.|electron' <file>` before each wave; this list ages.

---

## Skipped (IPC > 0, deferred)

Pattern: non-trivial IPC touch count makes a clean lift require a webFull-side abstraction (HTTP/WS shim) rather than a copy-paste. Sample entries:

- AboutModal (9 IPC)
- UpdateCheckModal (8 IPC)
- AgentSessionsModal (multi-namespace)
- AutoRun (full Auto Run surface — own brief)
- CreatePRModal (git + GitHub IPC)
- CreateWorktreeModal (git IPC)
- DebugPackageModal (system IPC)
- FileSearchModal (file IPC)
- HistoryDetailModal (history IPC)
- LogViewer (process + system IPC)
- MainPanel (orchestrator — not a leaf)
- ProcessMonitor (process IPC)
- RightPanel (orchestrator — not a leaf)
- Settings/ (large sub-tree — own brief per panel)
- WorktreeConfigModal (git IPC)
- Wizard/ (onboarding sub-tree — own brief)

---

## Update protocol

When a lift merges:

1. Move the component name from **Available** (or **Skipped**, if abstraction landed) to **Lifted**, with the merge SHA or branch tag.
2. If a new component is identified during audit reeval, slot it into **Available** or **Skipped** based on its IPC touch count.
3. If audit reeval flags it as "too big / needs design", move it to **Reserved** with a one-line precondition.

This file is the canonical "what's left" view; audit reeval-N consults it before re-grepping `src/renderer/components/`.
