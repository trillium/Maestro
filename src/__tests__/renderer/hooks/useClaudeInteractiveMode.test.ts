/**
 * Tests for useClaudeInteractiveMode hook
 *
 * Covers:
 *   - cycleFromInteractive pure helper (every persisted shape → cycle position)
 *   - nextClaudeModeCycle wrap-around
 *   - Hook returns 'auto' and a no-op setter when sessionId is undefined or
 *     the session is not Claude Code
 *   - Hook reflects the session's current pin
 *   - setMode updates the zustand store, calls the IPC write-through, and
 *     kills every AI tab process for the session
 *   - cycle() advances through the three positions and wraps
 *   - setMode is a no-op when the requested position already matches
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, cleanup } from '@testing-library/react';

import {
	useClaudeInteractiveMode,
	cycleFromInteractive,
	nextClaudeModeCycle,
	CLAUDE_MODE_CYCLE_ORDER,
} from '../../../renderer/hooks/agent/useClaudeInteractiveMode';
import { useSessionStore } from '../../../renderer/stores/sessionStore';
import type { Session } from '../../../renderer/types';

// ============================================================================
// Mocks for window.maestro.*
//
// The global test setup (src/__tests__/setup.ts) defines window.maestro with
// vi.fn()s for the whole API surface. We attach `setClaudeInteractiveMode`
// (not in the global mock) and override `kill` so we can assert call shape.
// ============================================================================

const setClaudeInteractiveMode = vi.fn().mockResolvedValue(true);
const kill = vi.fn().mockResolvedValue(true);

beforeEach(() => {
	vi.clearAllMocks();
	setClaudeInteractiveMode.mockResolvedValue(true);
	kill.mockResolvedValue(true);
	const maestro = (window as any).maestro;
	maestro.agents.setClaudeInteractiveMode = setClaudeInteractiveMode;
	maestro.process.kill = kill;
	useSessionStore.setState({
		sessions: [],
		groups: [],
		activeSessionId: '',
		cyclePosition: -1,
	} as any);
});

afterEach(() => {
	cleanup();
});

// ============================================================================
// Helpers
// ============================================================================

function makeClaudeSession(overrides: Partial<Session> & { id: string }): Session {
	return {
		name: overrides.id,
		toolType: 'claude-code',
		state: 'idle',
		cwd: '/tmp',
		fullPath: '/tmp',
		projectRoot: '/tmp',
		isGitRepo: false,
		aiLogs: [],
		shellLogs: [],
		workLog: [],
		contextUsage: 0,
		inputMode: 'ai',
		aiPid: 0,
		terminalPid: 0,
		port: 0,
		isLive: false,
		changedFiles: [],
		fileTree: [],
		fileExplorerExpanded: [],
		fileExplorerScrollPos: 0,
		fileTreeAutoRefreshInterval: 180,
		shellCwd: '/tmp',
		aiCommandHistory: [],
		shellCommandHistory: [],
		executionQueue: [],
		activeTimeMs: 0,
		aiTabs: [{ id: 'tab-1', name: 'main', state: 'idle', logs: [], readOnlyMode: false } as any],
		activeTabId: 'tab-1',
		closedTabHistory: [],
		filePreviewTabs: [],
		activeFileTabId: null,
		unifiedTabOrder: [],
		unifiedClosedTabHistory: [],
		autoRunFolderPath: '/tmp',
		...overrides,
	} as Session;
}

// ============================================================================
// Pure helper tests
// ============================================================================

describe('cycleFromInteractive', () => {
	it('returns auto when the block is undefined', () => {
		expect(cycleFromInteractive(undefined)).toBe('auto');
	});

	it('returns auto when modeReason is "auto"', () => {
		expect(cycleFromInteractive({ mode: 'api', modeReason: 'auto' })).toBe('auto');
		expect(cycleFromInteractive({ mode: 'interactive', modeReason: 'auto' })).toBe('auto');
	});

	it('returns auto when modeReason is "limit" (selector-driven, not a user pin)', () => {
		expect(cycleFromInteractive({ mode: 'api', modeReason: 'limit' })).toBe('auto');
	});

	it('returns force-interactive when the user pinned interactive', () => {
		expect(cycleFromInteractive({ mode: 'interactive', modeReason: 'user' })).toBe(
			'force-interactive'
		);
	});

	it('returns force-api when the user pinned api', () => {
		expect(cycleFromInteractive({ mode: 'api', modeReason: 'user' })).toBe('force-api');
	});
});

describe('nextClaudeModeCycle', () => {
	it('cycles auto → force-interactive → force-api → auto', () => {
		expect(nextClaudeModeCycle('auto')).toBe('force-interactive');
		expect(nextClaudeModeCycle('force-interactive')).toBe('force-api');
		expect(nextClaudeModeCycle('force-api')).toBe('auto');
	});

	it('CLAUDE_MODE_CYCLE_ORDER is exactly the three documented positions', () => {
		expect([...CLAUDE_MODE_CYCLE_ORDER]).toEqual(['auto', 'force-interactive', 'force-api']);
	});
});

// ============================================================================
// Hook tests
// ============================================================================

describe('useClaudeInteractiveMode', () => {
	it('returns auto and no-op setter when sessionId is undefined', async () => {
		const { result } = renderHook(() => useClaudeInteractiveMode(undefined));
		expect(result.current.mode).toBe('auto');
		expect(result.current.isClaudeCode).toBe(false);
		await act(async () => {
			await result.current.setMode('force-interactive');
		});
		expect(setClaudeInteractiveMode).not.toHaveBeenCalled();
		expect(kill).not.toHaveBeenCalled();
	});

	it('returns auto and isClaudeCode=false when the session is not Claude Code', async () => {
		useSessionStore.setState({
			sessions: [{ ...makeClaudeSession({ id: 's' }), toolType: 'codex' } as Session],
		} as any);
		const { result } = renderHook(() => useClaudeInteractiveMode('s'));
		expect(result.current.mode).toBe('auto');
		expect(result.current.isClaudeCode).toBe(false);
		await act(async () => {
			await result.current.setMode('force-interactive');
		});
		expect(setClaudeInteractiveMode).not.toHaveBeenCalled();
	});

	it('reflects the session current pin', () => {
		useSessionStore.setState({
			sessions: [
				makeClaudeSession({
					id: 's',
					claudeInteractive: { mode: 'interactive', modeReason: 'user' },
				}),
			],
		} as any);
		const { result } = renderHook(() => useClaudeInteractiveMode('s'));
		expect(result.current.mode).toBe('force-interactive');
		expect(result.current.isClaudeCode).toBe(true);
	});

	it('setMode updates the store, calls IPC, and kills every tab process', async () => {
		useSessionStore.setState({
			sessions: [
				makeClaudeSession({
					id: 's',
					aiTabs: [
						{ id: 'a', name: 'A', state: 'idle', logs: [], readOnlyMode: false } as any,
						{ id: 'b', name: 'B', state: 'idle', logs: [], readOnlyMode: false } as any,
					],
				}),
			],
		} as any);

		const { result } = renderHook(() => useClaudeInteractiveMode('s'));
		await act(async () => {
			await result.current.setMode('force-interactive');
		});

		// Store mutated
		const updated = useSessionStore.getState().sessions.find((sess) => sess.id === 's');
		expect(updated?.claudeInteractive).toEqual({
			mode: 'interactive',
			modeReason: 'user',
		});

		// Write-through called once with the resolved (mode, modeReason)
		expect(setClaudeInteractiveMode).toHaveBeenCalledTimes(1);
		expect(setClaudeInteractiveMode).toHaveBeenCalledWith('s', 'interactive', 'user');

		// Both tab processes killed via the documented `${sessionId}-ai-${tabId}` format
		expect(kill).toHaveBeenCalledTimes(2);
		expect(kill).toHaveBeenCalledWith('s-ai-a');
		expect(kill).toHaveBeenCalledWith('s-ai-b');
	});

	it('setMode going back to "auto" sets modeReason=auto and preserves prior mode', async () => {
		useSessionStore.setState({
			sessions: [
				makeClaudeSession({
					id: 's',
					claudeInteractive: { mode: 'interactive', modeReason: 'user' },
				}),
			],
		} as any);

		const { result } = renderHook(() => useClaudeInteractiveMode('s'));
		await act(async () => {
			await result.current.setMode('auto');
		});

		expect(setClaudeInteractiveMode).toHaveBeenCalledWith('s', 'interactive', 'auto');
		const updated = useSessionStore.getState().sessions.find((sess) => sess.id === 's');
		expect(updated?.claudeInteractive).toEqual({
			mode: 'interactive',
			modeReason: 'auto',
		});
	});

	it('setMode is a no-op when the requested position already matches current', async () => {
		useSessionStore.setState({
			sessions: [
				makeClaudeSession({
					id: 's',
					claudeInteractive: { mode: 'api', modeReason: 'user' },
				}),
			],
		} as any);

		const { result } = renderHook(() => useClaudeInteractiveMode('s'));
		await act(async () => {
			await result.current.setMode('force-api');
		});

		expect(setClaudeInteractiveMode).not.toHaveBeenCalled();
		expect(kill).not.toHaveBeenCalled();
	});

	it('cycle() advances through all three positions and wraps', async () => {
		useSessionStore.setState({
			sessions: [makeClaudeSession({ id: 's' })],
		} as any);

		const { result, rerender } = renderHook(() => useClaudeInteractiveMode('s'));
		expect(result.current.mode).toBe('auto');

		await act(async () => {
			await result.current.cycle();
		});
		rerender();
		expect(result.current.mode).toBe('force-interactive');

		await act(async () => {
			await result.current.cycle();
		});
		rerender();
		expect(result.current.mode).toBe('force-api');

		await act(async () => {
			await result.current.cycle();
		});
		rerender();
		expect(result.current.mode).toBe('auto');

		expect(setClaudeInteractiveMode).toHaveBeenCalledTimes(3);
	});

	it('setMode survives an IPC failure (logs, does not throw)', async () => {
		setClaudeInteractiveMode.mockRejectedValueOnce(new Error('disk full'));
		useSessionStore.setState({
			sessions: [makeClaudeSession({ id: 's' })],
		} as any);

		const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const { result } = renderHook(() => useClaudeInteractiveMode('s'));

		await act(async () => {
			await result.current.setMode('force-interactive');
		});

		// Store still updated locally
		const updated = useSessionStore.getState().sessions.find((sess) => sess.id === 's');
		expect(updated?.claudeInteractive?.modeReason).toBe('user');
		expect(warnSpy).toHaveBeenCalled();
		warnSpy.mockRestore();
	});
});
