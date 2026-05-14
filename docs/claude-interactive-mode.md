---
title: Claude Interactive Mode
description: Run Claude Code through your Max plan quota instead of API billing, with transparent auto-fallback when limits hit.
icon: shuffle
---

Claude Interactive Mode lets Maestro drive Claude Code through its **TUI** so each turn counts against your **Claude Max plan quota** instead of being billed per token to the Anthropic API. When the Max quota is exhausted, Maestro transparently falls back to API mode mid-conversation, then switches back once the quota window resets.

This is opt-in per tab via a badge in the agent row and tab strip header, but the default behavior — `auto` — picks the cheapest viable mode for you on every turn.

<Note>
Interactive mode only applies to Claude Code agents. Other providers (Codex, OpenCode, Factory Droid) are unaffected. See [Provider Notes](/provider-notes) for per-provider feature support.
</Note>

## What It Is

Without interactive mode, Maestro spawns Claude Code with `--print` (a.k.a. headless / batch / API mode). Every turn is billed against your Anthropic API key.

With interactive mode, Maestro spawns a small wrapper binary called **`maestro-p`** instead. `maestro-p` mimics `claude --print` on the outside (same CLI surface, same `stream-json` on stdout) but drives the real Claude **TUI** on the inside. Because the underlying session is interactive, the turn counts against your Claude Max plan quota — the same one you'd consume by running `claude` in a terminal yourself.

The result: while you still have Max plan headroom, you pay nothing extra to run Claude through Maestro.

## How It Works

Two layers cooperate:

1. **The `maestro-p` binary** — bundled with Maestro. Spawns Claude's interactive TUI, sends the user's prompt, watches stdout, and emits a stream-json transcript that's shape-compatible with `claude --print`. Exits `0` on success, `2` if the Max quota is hit mid-turn, `3` on idle timeout.
2. **Maestro's mode selector** — decides per turn whether to spawn `maestro-p` (interactive) or `claude --print` (API). The decision flows from your `headlessMode` setting, the per-tab override, and the most recent quota snapshot for the agent's `CLAUDE_CONFIG_DIR`.

When `maestro-p` exits with code `2` (quota hit during the turn), Maestro refreshes the usage snapshot, flips the tab to API mode, respawns the **same turn** under `claude --print` with `--resume`, and replays the original prompt. You see one continuous response with a single mode badge transition mid-stream — no duplicated message, no manual retry.

## Auto-Switching Behavior

The `auto` mode picks per turn using these rules:

| Condition                                                    | Mode chosen   | Badge reason     |
| ------------------------------------------------------------ | ------------- | ---------------- |
| No usage snapshot yet (first turn on this account)           | `interactive` | `auto`           |
| Snapshot below the **95%** threshold on every tracked window | `interactive` | `auto`           |
| Snapshot at or above 95% on any window, fallback enabled     | `api`         | `auto`           |
| Quota was hit mid-turn last time, reset window still open    | `api`         | `limit` (sticky) |
| You force a mode via the badge menu                          | per choice    | `user`           |

The 95% threshold applies independently to: session quota, weekly all-models quota, and weekly Sonnet-only quota. Tripping any one window flips the tab to API mode for that turn.

Once the next sampled snapshot shows the relevant reset has passed and you're back below 95%, `auto` picks interactive again on the next turn — no user action needed.

### Manual Override

Click the **mode badge** on either the agent row or the tab strip header to open the three-state menu:

- **Auto** — let Maestro pick (default).
- **Force Interactive** — pin the tab to interactive, even if the snapshot says you're at the threshold. Useful when you have headroom Maestro hasn't sampled yet.
- **Force API** — pin the tab to API, even if you have Max plan quota available. Useful for benchmarking or when you specifically want tool-call cards (see [tradeoffs](#tradeoffs--limitations) below).

The badge icon and tooltip always reflect the current state:

| Badge                   | Meaning                                           |
| ----------------------- | ------------------------------------------------- |
| Green terminal icon     | Interactive, using your Max plan quota            |
| Green terminal + lock   | Interactive, manually pinned                      |
| Blue cloud icon         | API mode (auto-selected, billed per token)        |
| Blue cloud + lock       | API mode, manually pinned                         |
| Orange warning triangle | Auto-fell back to API after hitting the Max quota |

The orange warning tooltip also shows the relative reset time, e.g., "resets in 2h 14m," so you know when the tab will swing back to interactive on its own.

## Multi-Account Support

Interactive mode honors the same `CLAUDE_CONFIG_DIR` environment variable that powers [multiple Claude accounts](/multi-claude). Each Maestro agent can point at a different account directory:

1. Open agent settings (`Cmd+E` / `Ctrl+E` on the agent row, or right-click → **Edit Agent**).
2. Expand **Environment Variables**.
3. Set `CLAUDE_CONFIG_DIR` to the account's config path (e.g., `/Users/you/.claude-personal`).

Maestro tracks one usage snapshot per `CLAUDE_CONFIG_DIR` — your personal and work accounts have independent quotas, independent reset windows, and independent badges. The Usage Dashboard ("Claude Plan Usage" section in the **Agents** tab) shows one row per account so you can see at a glance which account has headroom.

The mode badge labels itself with the basename of the config dir (e.g., `~/.claude-personal` → `personal`, `~/.claude-work` → `work`, plain `~/.claude` → `default`).

## Settings

**Settings → General → Claude Interactive Mode** exposes:

- **Headless mode** (`claudeCode.headlessMode`) — `interactive`, `api`, or `auto`. Default `auto`. The global default that every new tab inherits before any per-tab override.
- **Auto-fall back to API on limit** (`claudeCode.autoFallbackToApiOnLimit`) — when on (default), `auto` mode flips to API when the 95% threshold is crossed and on `maestro-p` exit code 2. When off, `auto` mode stays on interactive and the turn fails normally if the quota is hit.
- **Refresh now** — re-samples usage snapshots for every known `CLAUDE_CONFIG_DIR` without needing to send a turn. Useful after authenticating a new account or to confirm a reset has landed.

## Tradeoffs & Limitations

Interactive mode trades a few things for the quota savings:

- **Cold-start latency** — each interactive turn pays ~2–5s of TUI startup before bytes start streaming. API mode launches noticeably faster. For tight, repeated micro-prompts, force API mode if latency matters more than cost.
- **No structured tool-call cards** — the TUI emits tool invocations as inline text rather than the `tool_use` events Maestro renders as code/diff cards in API mode. Interactive-mode turns get a small **"Captured via interactive TUI (no tool cards)"** footer pill explaining the visual difference. The tool _output_ is still there, just formatted as part of the assistant's prose rather than collapsed into a card.
- **Mixed rendering in one tab** — a single tab's scrollback can contain both interactive turns (plain Markdown stream) and API turns (structured cards). This is normal and expected — `auto` may flip the mode mid-conversation when the quota crosses 95%. Each turn renders in its own style; scrollback stays coherent.
- **Per-account quota only** — interactive mode does nothing for accounts that don't have an active Max subscription. If you're on the pay-as-you-go API tier exclusively, leave `headlessMode` set to `api`.

## Related

- [Multiple Claude Accounts](/multi-claude) — set up `CLAUDE_CONFIG_DIR` per agent.
- [Provider Notes](/provider-notes) — Claude Code feature matrix and per-provider quirks.
- [Usage Dashboard](/usage-dashboard) — the "Claude Plan Usage" section breaks down quota burndown per account.
