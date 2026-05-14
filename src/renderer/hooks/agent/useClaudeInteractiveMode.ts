/**
 * useClaudeInteractiveMode - per-session Claude headless-mode cycle hook
 *
 * Exposes a `[cycle, setCycle]` pair for cycling a Claude Code session through
 * three user-facing positions: `auto`, `force-interactive`, `force-api`.
 *
 * The cycle position is derived from `session.claudeInteractive`:
 *   - `auto`            → modeReason is 'auto' or 'limit' (i.e. selector-driven)
 *   - `force-interactive` → modeReason === 'user' && mode === 'interactive'
 *   - `force-api`       → modeReason === 'user' && mode === 'api'
 *
 * Writing a new position:
 *   1. Updates the zustand session store so UI reflects the choice immediately.
 *   2. Calls `window.maestro.agents.setClaudeInteractiveMode(...)` to write
 *      through to the on-disk sessions store synchronously — the spawner reads
 *      from disk on its next spawn, so without this write-through the new pin
 *      would be invisible until the renderer's debounced flush ran.
 *   3. Kills any in-flight AI process for every tab in the session, so a
 *      stale-mode turn doesn't keep streaming after the user changed the pin.
 *      The next user message will spawn under the new mode and use
 *      `--resume <agentSessionId>` to continue the conversation.
 *
 * Returning to `auto` keeps the persisted `mode` value as-is — the selector
 * only consults `mode` when `modeReason === 'user'`, so its value is irrelevant
 * under `auto`/`limit` and will be overwritten on the next spawn anyway.
 */

import { useCallback, useMemo } from 'react';
import { useSessionStore } from '../../stores/sessionStore';

export type ClaudeModeCycle = 'auto' | 'force-interactive' | 'force-api';

export const CLAUDE_MODE_CYCLE_ORDER: readonly ClaudeModeCycle[] = [
	'auto',
	'force-interactive',
	'force-api',
] as const;

/** Compute the next cycle position from the current one. */
export function nextClaudeModeCycle(current: ClaudeModeCycle): ClaudeModeCycle {
	const idx = CLAUDE_MODE_CYCLE_ORDER.indexOf(current);
	return CLAUDE_MODE_CYCLE_ORDER[(idx + 1) % CLAUDE_MODE_CYCLE_ORDER.length];
}

/**
 * Map the persisted `session.claudeInteractive` shape to the user-facing
 * cycle position. Defaults to `'auto'` when the block is absent.
 */
export function cycleFromInteractive(
	claudeInteractive:
		| { mode: 'interactive' | 'api'; modeReason: 'user' | 'auto' | 'limit' }
		| undefined
): ClaudeModeCycle {
	if (!claudeInteractive) return 'auto';
	if (claudeInteractive.modeReason !== 'user') return 'auto';
	return claudeInteractive.mode === 'interactive' ? 'force-interactive' : 'force-api';
}

/** Inverse of `cycleFromInteractive` — what the persisted block should look like. */
function interactiveFromCycle(
	cycle: ClaudeModeCycle,
	current: { mode: 'interactive' | 'api'; modeReason: 'user' | 'auto' | 'limit' } | undefined
): { mode: 'interactive' | 'api'; modeReason: 'user' | 'auto' } {
	if (cycle === 'force-interactive') return { mode: 'interactive', modeReason: 'user' };
	if (cycle === 'force-api') return { mode: 'api', modeReason: 'user' };
	// auto: preserve any prior `mode` value; selector ignores it under auto/limit.
	return { mode: current?.mode ?? 'api', modeReason: 'auto' };
}

export interface UseClaudeInteractiveModeReturn {
	/** Current cycle position. `'auto'` when no session is selected or session is not Claude Code. */
	mode: ClaudeModeCycle;
	/** Set the cycle position. Persists, then kills any in-flight AI tab processes. */
	setMode: (next: ClaudeModeCycle) => Promise<void>;
	/** Convenience: advance to the next cycle position. */
	cycle: () => Promise<void>;
	/** True when the session is Claude Code (menu item should be visible). */
	isClaudeCode: boolean;
}

/**
 * @param sessionId The session to read / mutate. `undefined` returns a no-op
 *   `setMode` and `mode === 'auto'`, so callers can use the hook
 *   unconditionally without prop-drilling guards.
 */
export function useClaudeInteractiveMode(
	sessionId: string | undefined
): UseClaudeInteractiveModeReturn {
	const session = useSessionStore((s) =>
		sessionId ? s.sessions.find((sess) => sess.id === sessionId) : undefined
	);
	const updateSession = useSessionStore((s) => s.updateSession);

	const isClaudeCode = session?.toolType === 'claude-code';
	const mode = useMemo<ClaudeModeCycle>(
		() => (isClaudeCode ? cycleFromInteractive(session?.claudeInteractive) : 'auto'),
		[isClaudeCode, session?.claudeInteractive]
	);

	const setMode = useCallback(
		async (next: ClaudeModeCycle) => {
			if (!sessionId || !isClaudeCode) return;
			if (next === mode) return;

			const current = session?.claudeInteractive;
			const resolved = interactiveFromCycle(next, current);

			// 1. Update the in-memory zustand store so UI reflects immediately.
			updateSession(sessionId, {
				claudeInteractive: {
					...(current ?? {}),
					mode: resolved.mode,
					modeReason: resolved.modeReason,
				},
			});

			// 2. Write through to the on-disk sessions store synchronously so the
			//    next spawn sees the new pin without waiting for the debounced flush.
			try {
				await window.maestro.agents.setClaudeInteractiveMode(
					sessionId,
					resolved.mode,
					resolved.modeReason
				);
			} catch (err) {
				// Persistence failures are non-fatal: the debounced renderer flush
				// will catch up eventually, and the next spawn just reads whatever
				// the store has. Log so a regression doesn't go silent.
				console.warn('[useClaudeInteractiveMode] write-through failed', err);
			}

			// 3. Kill any in-flight AI process for every tab in the session. The
			//    AI process ID format is `${sessionId}-ai-${tabId}` (see
			//    `processQueuedItem` in agentStore). If no process is running for
			//    a given tab, kill() resolves false and we continue. The next
			//    user message will respawn under the new mode + use
			//    `--resume <agentSessionId>` to continue the conversation.
			const tabs = session?.aiTabs ?? [];
			await Promise.all(
				tabs.map((tab) =>
					window.maestro.process.kill(`${sessionId}-ai-${tab.id}`).catch((err: unknown) => {
						console.warn(
							`[useClaudeInteractiveMode] failed to kill ${sessionId}-ai-${tab.id}`,
							err
						);
					})
				)
			);
		},
		[sessionId, isClaudeCode, mode, session?.claudeInteractive, session?.aiTabs, updateSession]
	);

	const cycle = useCallback(() => setMode(nextClaudeModeCycle(mode)), [setMode, mode]);

	return { mode, setMode, cycle, isClaudeCode };
}
