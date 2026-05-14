import { describe, it, expect, beforeEach, vi } from 'vitest';
import os from 'os';
import path from 'path';

// Mock electron-store with a stateful in-memory implementation. The
// claudeUsageStore module lazily instantiates a single Store; this mock matches
// the real `get(key, defaultValue)` / `set(key, value)` API surface that
// claudeUsageStore relies on.
vi.mock('electron-store', () => {
	class MockStore<T extends Record<string, unknown>> {
		private state: Record<string, unknown>;
		constructor(options: { defaults?: T } = {}) {
			this.state = { ...(options.defaults ?? {}) };
		}
		get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
			const value = this.state[key as string];
			return (value === undefined ? defaultValue : value) as T[K];
		}
		set<K extends keyof T>(key: K, value: T[K]): void {
			this.state[key as string] = value;
		}
	}
	return { default: MockStore };
});

import {
	setSnapshot,
	getSnapshot,
	getAllSnapshots,
	clear,
	resolveConfigDirKey,
	type UsageSnapshot,
} from '../../../main/stores/claudeUsageStore';

const MS_PER_HOUR = 60 * 60 * 1000;

function buildSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
	return {
		sampledAt: new Date().toISOString(),
		configDirKey: '/Users/test/.claude',
		session: { percent: 10, resetsAt: '2099-12-31T00:00:00Z' },
		weekAllModels: { percent: 20, resetsAt: '2099-12-31T00:00:00Z' },
		weekSonnetOnly: { percent: 30, resetsAt: '2099-12-31T00:00:00Z' },
		...overrides,
	};
}

describe('claudeUsageStore', () => {
	beforeEach(() => {
		clear();
	});

	describe('setSnapshot / getSnapshot', () => {
		it('stores a snapshot and retrieves it by configDirKey', () => {
			const snap = buildSnapshot({ configDirKey: '/path/a' });
			setSnapshot(snap);
			expect(getSnapshot('/path/a')).toEqual(snap);
		});

		it('returns null for an unknown configDirKey', () => {
			expect(getSnapshot('/never-stored')).toBeNull();
		});

		it('overwrites an existing snapshot for the same configDirKey', () => {
			const first = buildSnapshot({
				configDirKey: '/path/a',
				session: { percent: 5, resetsAt: '2099-12-31T00:00:00Z' },
			});
			const second = buildSnapshot({
				configDirKey: '/path/a',
				session: { percent: 80, resetsAt: '2099-12-31T00:00:00Z' },
			});
			setSnapshot(first);
			setSnapshot(second);
			expect(getSnapshot('/path/a')).toEqual(second);
		});

		it('returns null when the stored sampledAt is unparseable', () => {
			setSnapshot(
				buildSnapshot({
					configDirKey: '/path/bad-timestamp',
					sampledAt: 'not-a-real-iso-string',
				})
			);
			expect(getSnapshot('/path/bad-timestamp')).toBeNull();
		});
	});

	describe('getAllSnapshots', () => {
		it('returns an empty object when nothing has been stored', () => {
			expect(getAllSnapshots()).toEqual({});
		});

		it('returns every live snapshot keyed by configDirKey', () => {
			const a = buildSnapshot({ configDirKey: '/path/a' });
			const b = buildSnapshot({ configDirKey: '/path/b' });
			setSnapshot(a);
			setSnapshot(b);
			expect(getAllSnapshots()).toEqual({ '/path/a': a, '/path/b': b });
		});
	});

	describe('TTL pruning (24h)', () => {
		it('returns null for a snapshot older than 24h', () => {
			const stale = buildSnapshot({
				configDirKey: '/path/stale',
				sampledAt: new Date(Date.now() - 25 * MS_PER_HOUR).toISOString(),
			});
			setSnapshot(stale);
			expect(getSnapshot('/path/stale')).toBeNull();
		});

		it('still returns snapshots within the 24h window', () => {
			const fresh = buildSnapshot({
				configDirKey: '/path/fresh',
				sampledAt: new Date(Date.now() - 23 * MS_PER_HOUR).toISOString(),
			});
			setSnapshot(fresh);
			expect(getSnapshot('/path/fresh')).toEqual(fresh);
		});

		it('excludes expired entries from getAllSnapshots', () => {
			const stale = buildSnapshot({
				configDirKey: '/path/stale',
				sampledAt: new Date(Date.now() - 25 * MS_PER_HOUR).toISOString(),
			});
			const fresh = buildSnapshot({ configDirKey: '/path/fresh' });
			setSnapshot(stale);
			setSnapshot(fresh);
			expect(getAllSnapshots()).toEqual({ '/path/fresh': fresh });
		});

		it('setSnapshot prunes expired neighbors when writing', () => {
			// Seed a stale entry, then write a fresh one for a different key. The stale
			// entry should be dropped from the underlying store as a side effect.
			setSnapshot(
				buildSnapshot({
					configDirKey: '/path/stale',
					sampledAt: new Date(Date.now() - 30 * MS_PER_HOUR).toISOString(),
				})
			);
			setSnapshot(buildSnapshot({ configDirKey: '/path/fresh' }));
			expect(Object.keys(getAllSnapshots())).toEqual(['/path/fresh']);
		});
	});

	describe('multi-account isolation', () => {
		it('keeps separate snapshots for different configDirKey values', () => {
			const gmail = buildSnapshot({
				configDirKey: '/Users/x/.claude-gmail',
				session: { percent: 10, resetsAt: '2099-12-31T00:00:00Z' },
			});
			const smash = buildSnapshot({
				configDirKey: '/Users/x/.claude-smash',
				session: { percent: 80, resetsAt: '2099-12-31T00:00:00Z' },
			});
			setSnapshot(gmail);
			setSnapshot(smash);
			expect(getSnapshot('/Users/x/.claude-gmail')).toEqual(gmail);
			expect(getSnapshot('/Users/x/.claude-smash')).toEqual(smash);
			expect(getAllSnapshots()).toEqual({
				'/Users/x/.claude-gmail': gmail,
				'/Users/x/.claude-smash': smash,
			});
		});

		it('updating one account does not affect another', () => {
			const a = buildSnapshot({ configDirKey: '/acc/a' });
			const b = buildSnapshot({ configDirKey: '/acc/b' });
			setSnapshot(a);
			setSnapshot(b);
			const aUpdated = buildSnapshot({
				configDirKey: '/acc/a',
				session: { percent: 60, resetsAt: '2099-12-31T00:00:00Z' },
			});
			setSnapshot(aUpdated);
			expect(getSnapshot('/acc/a')).toEqual(aUpdated);
			expect(getSnapshot('/acc/b')).toEqual(b);
		});
	});

	describe('clear', () => {
		it('removes every stored snapshot', () => {
			setSnapshot(buildSnapshot({ configDirKey: '/a' }));
			setSnapshot(buildSnapshot({ configDirKey: '/b' }));
			clear();
			expect(getAllSnapshots()).toEqual({});
			expect(getSnapshot('/a')).toBeNull();
			expect(getSnapshot('/b')).toBeNull();
		});
	});

	describe('resolveConfigDirKey', () => {
		it('uses CLAUDE_CONFIG_DIR when set', () => {
			expect(resolveConfigDirKey({ CLAUDE_CONFIG_DIR: '/custom/.claude' })).toBe(
				path.resolve('/custom/.claude')
			);
		});

		it('falls back to ~/.claude when CLAUDE_CONFIG_DIR is unset', () => {
			expect(resolveConfigDirKey({})).toBe(path.resolve(path.join(os.homedir(), '.claude')));
		});

		it('canonicalizes the input path via path.resolve', () => {
			expect(resolveConfigDirKey({ CLAUDE_CONFIG_DIR: '/abs/./.claude' })).toBe(
				path.resolve('/abs/./.claude')
			);
		});

		it('returns identical keys for two envs pointing at the same directory in different forms', () => {
			const a = resolveConfigDirKey({ CLAUDE_CONFIG_DIR: '/Users/x/.claude' });
			const b = resolveConfigDirKey({ CLAUDE_CONFIG_DIR: '/Users/x/./.claude' });
			expect(a).toBe(b);
		});
	});
});
