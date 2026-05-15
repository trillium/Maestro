/**
 * Tests for the `getStorageWatchSpec()` overrides on each agent's storage
 * class. Pure matcher unit tests — no chokidar / SessionFileWatcher
 * wiring is exercised here (that's covered by `session-file-watcher.test.ts`).
 *
 * For each agent the suite asserts:
 * - `getStorageWatchSpec()` returns a non-null spec
 * - `rootDir` matches the expected `os.homedir()`-relative path
 * - `fileMatcher` resolves a representative valid path to the right
 *   `{ sessionId, projectPath }`
 * - `fileMatcher` rejects several representative invalid paths (wrong depth,
 *   wrong suffix, sidecar files, etc.)
 *
 * Paths are built with `path.join` so the matcher's `path.sep` split is
 * exercised correctly on both POSIX and Windows.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import os from 'os';
import path from 'path';

// ============================================================================
// Mocks (must be declared before imports)
// ============================================================================

vi.mock('electron', () => ({
	app: { getPath: () => '/tmp' },
}));

vi.mock('electron-store', () => ({
	default: vi.fn().mockImplementation(() => ({
		get: vi.fn(),
		set: vi.fn(),
		store: {},
	})),
}));

vi.mock('../../../main/utils/logger', () => ({
	logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('../../../main/utils/sentry', () => ({
	captureException: vi.fn(),
	captureMessage: vi.fn(),
}));

vi.mock('../../../main/utils/remote-fs', () => ({
	readFileRemote: vi.fn(),
	readDirRemote: vi.fn(),
	statRemote: vi.fn(),
	listDirWithStatsRemote: vi.fn(),
	directorySizeRemote: vi.fn(),
	bulkStatFileInSubdirsRemote: vi.fn(),
}));

vi.mock('fs/promises', () => ({
	default: {
		access: vi.fn(),
		readdir: vi.fn(),
		stat: vi.fn(),
		readFile: vi.fn(),
		writeFile: vi.fn(),
	},
}));

vi.mock('../../../main/utils/statsCache', () => ({
	encodeClaudeProjectPath: vi.fn((p: string) => p.replace(/[^a-zA-Z0-9]/g, '-')),
}));

vi.mock('../../../main/utils/pricing', () => ({
	calculateClaudeCost: vi.fn(() => 0),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { ClaudeSessionStorage } from '../../../main/storage/claude-session-storage';
import type { ClaudeSessionOriginsData } from '../../../main/storage/claude-session-storage';
import { CodexSessionStorage } from '../../../main/storage/codex-session-storage';
import { CopilotSessionStorage } from '../../../main/storage/copilot-session-storage';
import { FactoryDroidSessionStorage } from '../../../main/storage/factory-droid-session-storage';
import type Store from 'electron-store';

/** Minimal stub that satisfies the Claude storage constructor's `Store<...>` parameter. */
function makeStubStore(): Store<ClaudeSessionOriginsData> {
	const data: Record<string, unknown> = {};
	return {
		get: (key: string, defaultValue?: unknown) => data[key] ?? defaultValue,
		set: (key: string, value: unknown) => {
			data[key] = value;
		},
		store: data,
	} as unknown as Store<ClaudeSessionOriginsData>;
}

// ============================================================================
// Tests
// ============================================================================

describe('ClaudeSessionStorage.getStorageWatchSpec()', () => {
	let storage: ClaudeSessionStorage;

	beforeEach(() => {
		storage = new ClaudeSessionStorage(makeStubStore());
	});

	it('returns a non-null spec rooted at ~/.claude/projects', () => {
		const spec = storage.getStorageWatchSpec();
		expect(spec).not.toBeNull();
		expect(spec!.rootDir).toBe(path.join(os.homedir(), '.claude', 'projects'));
	});

	it('matches <encoded-project>/<session-id>.jsonl', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('-Users-pedram-Projects-Maestro', 'abc123.jsonl');
		expect(spec.fileMatcher(relPath)).toEqual({
			sessionId: 'abc123',
			projectPath: '-Users-pedram-Projects-Maestro',
		});
	});

	it('rejects paths with the wrong depth (too shallow)', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher('abc123.jsonl')).toBeNull();
	});

	it('rejects paths with the wrong depth (too deep)', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('-Users-pedram', 'subdir', 'abc123.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects files without a .jsonl suffix', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('-Users-pedram', 'README.md');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects entries with an empty session-id segment', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('-Users-pedram', '.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});
});

describe('CodexSessionStorage.getStorageWatchSpec()', () => {
	let storage: CodexSessionStorage;

	beforeEach(() => {
		storage = new CodexSessionStorage();
	});

	it('returns a non-null spec rooted at ~/.codex/sessions', () => {
		const spec = storage.getStorageWatchSpec();
		expect(spec).not.toBeNull();
		expect(spec!.rootDir).toBe(path.join(os.homedir(), '.codex', 'sessions'));
	});

	it('matches YYYY/MM/DD/rollout-<ts>-<uuid>.jsonl', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join(
			'2026',
			'05',
			'15',
			'rollout-2026_05_15_12_34_56-019ccb6c-c0fd-7b70-92b7-558f514099c6.jsonl'
		);
		expect(spec.fileMatcher(relPath)).toEqual({
			sessionId: '019ccb6c-c0fd-7b70-92b7-558f514099c6',
			projectPath: '',
		});
	});

	it('rejects paths with the wrong depth (too shallow)', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('2026', '05', 'rollout-x-y.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects non-numeric date segments', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join(
			'202X',
			'05',
			'15',
			'rollout-2026_05_15-019ccb6c-c0fd-7b70-92b7-558f514099c6.jsonl'
		);
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects single-digit month/day segments', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join(
			'2026',
			'5',
			'15',
			'rollout-2026_05_15-019ccb6c-c0fd-7b70-92b7-558f514099c6.jsonl'
		);
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects filenames that do not match the rollout pattern', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('2026', '05', '15', 'notes.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});
});

describe('CopilotSessionStorage.getStorageWatchSpec()', () => {
	let storage: CopilotSessionStorage;
	let originalConfigDir: string | undefined;

	beforeEach(() => {
		originalConfigDir = process.env.COPILOT_CONFIG_DIR;
		delete process.env.COPILOT_CONFIG_DIR;
		storage = new CopilotSessionStorage();
	});

	afterEach(() => {
		if (originalConfigDir === undefined) {
			delete process.env.COPILOT_CONFIG_DIR;
		} else {
			process.env.COPILOT_CONFIG_DIR = originalConfigDir;
		}
	});

	it('returns a non-null spec rooted at ~/.copilot/session-state', () => {
		const spec = storage.getStorageWatchSpec();
		expect(spec).not.toBeNull();
		expect(spec!.rootDir).toBe(path.join(os.homedir(), '.copilot', 'session-state'));
	});

	it('matches <sessionId>/events.jsonl', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('sess-abc', 'events.jsonl');
		expect(spec.fileMatcher(relPath)).toEqual({
			sessionId: 'sess-abc',
			projectPath: '',
		});
	});

	it('rejects paths with the wrong depth (too shallow)', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher('events.jsonl')).toBeNull();
	});

	it('rejects paths with the wrong depth (too deep)', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('sess-abc', 'subdir', 'events.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects sibling files such as workspace.yaml', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('sess-abc', 'workspace.yaml');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});
});

describe('FactoryDroidSessionStorage.getStorageWatchSpec()', () => {
	let storage: FactoryDroidSessionStorage;

	beforeEach(() => {
		storage = new FactoryDroidSessionStorage();
	});

	it('returns a non-null spec rooted at ~/.factory/sessions', () => {
		const spec = storage.getStorageWatchSpec();
		expect(spec).not.toBeNull();
		expect(spec!.rootDir).toBe(path.join(os.homedir(), '.factory', 'sessions'));
	});

	it('matches <encoded-project>/<uuid>.jsonl', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join(
			'-Users-pedram-Projects-Maestro',
			'7c4a3e2b-5d6f-4a8b-9c0d-1e2f3a4b5c6d.jsonl'
		);
		expect(spec.fileMatcher(relPath)).toEqual({
			sessionId: '7c4a3e2b-5d6f-4a8b-9c0d-1e2f3a4b5c6d',
			projectPath: '-Users-pedram-Projects-Maestro',
		});
	});

	it('rejects the .settings.json sidecar next to a session file', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join(
			'-Users-pedram-Projects-Maestro',
			'7c4a3e2b-5d6f-4a8b-9c0d-1e2f3a4b5c6d.settings.json'
		);
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects paths with the wrong depth (too shallow)', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher('7c4a3e2b.jsonl')).toBeNull();
	});

	it('rejects paths with the wrong depth (too deep)', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('-Users-pedram', 'subdir', '7c4a3e2b.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects entries with an empty session-id segment', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('-Users-pedram', '.jsonl');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});
});
