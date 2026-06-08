/**
 * sessions-mutator — createSession unit tests.
 *
 * Audit #13 / ISC-44.wiring.new_instance_modal_create_wired.
 *
 * Covers the new `createSession` mutator that backs the `create_session`
 * WS frame for webFull's `NewInstanceModal` onCreate. The mutator is a pure
 * data-in/data-out function: tests stay in-memory (no FileStore / no WS) and
 * just assert the produced session array + the returned session shape.
 */

import { describe, expect, it } from 'vitest';

import { createSession } from '../sessions-mutator';
import type { MutableSession } from '../sessions-mutator';

interface TestSession extends MutableSession {
	id: string;
	toolType?: string;
	cwd?: string;
}

describe('sessions-mutator: createSession', () => {
	it('appends a new session with an initial idle AI tab', () => {
		const sessions: TestSession[] = [];
		const result = createSession(sessions, {
			id: 'sess-1',
			name: 'My Agent',
			toolType: 'claude-code',
			cwd: '/Users/me/code/proj',
		});

		expect(result).not.toBeNull();
		expect(result!.sessions).toHaveLength(1);
		const created = result!.session;
		expect(created.id).toBe('sess-1');
		expect(created.name).toBe('My Agent');
		expect(created.toolType).toBe('claude-code');
		expect(created.cwd).toBe('/Users/me/code/proj');
		expect(created.state).toBe('idle');
		expect(created.inputMode).toBe('ai');
		expect(Array.isArray(created.aiTabs)).toBe(true);
		expect(created.aiTabs).toHaveLength(1);
		const tab = (created.aiTabs as Array<Record<string, unknown>>)[0];
		expect(tab.state).toBe('idle');
		expect(tab.starred).toBe(false);
		expect(tab.agentSessionId).toBeNull();
		expect(tab.logs).toEqual([]);
		expect(created.activeTabId).toBe(tab.id);
	});

	it('seeds inputMode=terminal for the terminal tool type', () => {
		const result = createSession([] as TestSession[], {
			id: 'sess-term',
			name: 'Terminal',
			toolType: 'terminal',
			cwd: '/tmp',
		});
		expect(result).not.toBeNull();
		expect(result!.session.inputMode).toBe('terminal');
	});

	it('preserves existing sessions and returns an immutable new array', () => {
		const existing: TestSession = { id: 'existing-1', toolType: 'codex', cwd: '/a' };
		const sessions: TestSession[] = [existing];
		const result = createSession(sessions, {
			id: 'sess-2',
			name: 'Another',
			toolType: 'codex',
			cwd: '/b',
		});
		expect(result).not.toBeNull();
		// Returned array contains both
		expect(result!.sessions).toHaveLength(2);
		expect(result!.sessions[0]).toBe(existing); // existing reference preserved
		// Input array is not mutated in place
		expect(sessions).toHaveLength(1);
	});

	it('persists custom spawn-config fields when provided', () => {
		const result = createSession([] as TestSession[], {
			id: 'sess-3',
			name: 'Custom',
			toolType: 'opencode',
			cwd: '/x',
			customPath: '/usr/local/bin/opencode',
			customArgs: '--verbose',
			customEnvVars: { FOO: 'bar' },
			customModel: 'gpt-4',
			customContextWindow: 200000,
			customProviderPath: '/opt/provider',
			nudgeMessage: 'hello',
			sessionSshRemoteConfig: { enabled: true, remoteId: 'remote-1' },
		});
		expect(result).not.toBeNull();
		const s = result!.session as Record<string, unknown>;
		expect(s.customPath).toBe('/usr/local/bin/opencode');
		expect(s.customArgs).toBe('--verbose');
		expect(s.customEnvVars).toEqual({ FOO: 'bar' });
		expect(s.customModel).toBe('gpt-4');
		expect(s.customContextWindow).toBe(200000);
		expect(s.customProviderPath).toBe('/opt/provider');
		expect(s.nudgeMessage).toBe('hello');
		expect(s.sessionSshRemoteConfig).toEqual({ enabled: true, remoteId: 'remote-1' });
	});

	it('omits optional fields when not provided (no undefined leaks)', () => {
		const result = createSession([] as TestSession[], {
			id: 'sess-4',
			name: 'Minimal',
			toolType: 'claude-code',
			cwd: '/y',
		});
		expect(result).not.toBeNull();
		const s = result!.session as Record<string, unknown>;
		expect(Object.prototype.hasOwnProperty.call(s, 'customPath')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(s, 'customArgs')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(s, 'sessionSshRemoteConfig')).toBe(false);
		expect(Object.prototype.hasOwnProperty.call(s, 'nudgeMessage')).toBe(false);
	});

	it('returns null on duplicate id collision', () => {
		const sessions: TestSession[] = [{ id: 'dup', toolType: 'codex', cwd: '/a' }];
		const result = createSession(sessions, {
			id: 'dup',
			name: 'Same',
			toolType: 'codex',
			cwd: '/b',
		});
		expect(result).toBeNull();
	});

	it('returns null on missing required fields', () => {
		expect(
			createSession([] as TestSession[], { id: '', name: 'x', toolType: 't', cwd: '/c' })
		).toBeNull();
		expect(
			createSession([] as TestSession[], { id: 'i', name: '', toolType: 't', cwd: '/c' })
		).toBeNull();
		expect(
			createSession([] as TestSession[], { id: 'i', name: 'x', toolType: '', cwd: '/c' })
		).toBeNull();
		expect(
			createSession([] as TestSession[], { id: 'i', name: 'x', toolType: 't', cwd: '' })
		).toBeNull();
	});

	it('forwards groupId when provided, defaults to null otherwise', () => {
		const r1 = createSession([] as TestSession[], {
			id: 's-g1',
			name: 'In Group',
			toolType: 'codex',
			cwd: '/g',
			groupId: 'group-1',
		});
		expect(r1!.session.groupId).toBe('group-1');

		const r2 = createSession([] as TestSession[], {
			id: 's-g2',
			name: 'No Group',
			toolType: 'codex',
			cwd: '/g',
		});
		expect(r2!.session.groupId).toBeNull();
	});
});
