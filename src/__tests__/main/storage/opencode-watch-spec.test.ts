/**
 * Tests for `OpenCodeSessionStorage.getStorageWatchSpec()`.
 *
 * OpenCode's shape differs from the other four watched agents: instead of
 * appending to a single session file, the CLI writes one `.json` file per
 * message under `<storage>/message/<sessionId>/`. The matcher therefore
 * keys off the parent directory name, and the spec's `activityEvent` is
 * `'create'` so consumers bind to the new-file event rather than the
 * grow event.
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
		unlink: vi.fn(),
		rmdir: vi.fn(),
	},
}));

// better-sqlite3 is a native module compiled for Electron's Node version;
// it's imported at module load but never invoked by the matcher itself.
// Stub it so the import doesn't fault under vitest.
vi.mock('better-sqlite3', () => ({
	default: vi.fn().mockImplementation(() => ({
		prepare: vi.fn(),
		close: vi.fn(),
	})),
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { OpenCodeSessionStorage } from '../../../main/storage/opencode-session-storage';
import { isWindows } from '../../../shared/platformDetection';

// ============================================================================
// Tests
// ============================================================================

describe('OpenCodeSessionStorage.getStorageWatchSpec()', () => {
	let storage: OpenCodeSessionStorage;

	beforeEach(() => {
		storage = new OpenCodeSessionStorage();
	});

	it('returns a non-null spec', () => {
		const spec = storage.getStorageWatchSpec();
		expect(spec).not.toBeNull();
	});

	it('reports activityEvent: "create" (file-per-message shape)', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.activityEvent).toBe('create');
	});

	it('roots watching at the XDG opencode storage dir on the current platform', () => {
		const spec = storage.getStorageWatchSpec()!;
		const expected = isWindows()
			? path.join(
					process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
					'opencode',
					'storage'
				)
			: path.join(os.homedir(), '.local', 'share', 'opencode', 'storage');
		expect(spec.rootDir).toBe(expected);
	});

	describe('Windows rootDir branch', () => {
		const ORIGINAL_PLATFORM = process.platform;
		const ORIGINAL_APPDATA = process.env.APPDATA;

		afterEach(() => {
			Object.defineProperty(process, 'platform', { value: ORIGINAL_PLATFORM });
			if (ORIGINAL_APPDATA === undefined) {
				delete process.env.APPDATA;
			} else {
				process.env.APPDATA = ORIGINAL_APPDATA;
			}
		});

		it('matches the constant captured at import time on Windows', () => {
			// The storage module reads APPDATA at import time, so the live spec
			// reflects whichever platform was active when the module first
			// loaded. We can still assert the platform-conditional shape: when
			// running on Windows, the rootDir must end with `opencode\storage`;
			// on POSIX, with `opencode/storage`.
			const spec = storage.getStorageWatchSpec()!;
			const expectedSuffix = path.join('opencode', 'storage');
			expect(spec.rootDir.endsWith(expectedSuffix)).toBe(true);
		});
	});

	it('matches message/<sessionId>/<messageId>.json and reports the session', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join(
			'message',
			'ses_4d585107dffeO9bO3HvMdvLYyC',
			'msg_01HZQ8X7K2BNCD3W5T9F6PYRGV.json'
		);
		expect(spec.fileMatcher(relPath)).toEqual({
			sessionId: 'ses_4d585107dffeO9bO3HvMdvLYyC',
			projectPath: '',
		});
	});

	it('rejects a top-level global.json at the root', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher('global.json')).toBeNull();
	});

	it('rejects a .txt file inside a per-session message dir', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('message', 'ses_abc', 'notes.txt');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects an empty relative path', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher('')).toBeNull();
	});

	it('rejects non-message categories (session/, part/, project/)', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher(path.join('session', 'proj-abc', 'ses_xyz.json'))).toBeNull();
		expect(spec.fileMatcher(path.join('part', 'msg_abc', 'part_xyz.json'))).toBeNull();
	});

	it('rejects paths with the wrong depth (too shallow)', () => {
		const spec = storage.getStorageWatchSpec()!;
		expect(spec.fileMatcher(path.join('message', 'ses_abc.json'))).toBeNull();
	});

	it('rejects paths with the wrong depth (too deep)', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('message', 'ses_abc', 'subdir', 'msg.json');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects entries with an empty session-id segment', () => {
		const spec = storage.getStorageWatchSpec()!;
		// Manually construct the path so `path.join`'s empty-segment
		// collapsing doesn't hide the case we're trying to exercise.
		const relPath = `message${path.sep}${path.sep}msg.json`;
		expect(spec.fileMatcher(relPath)).toBeNull();
	});

	it('rejects a bare .json file with no message body', () => {
		const spec = storage.getStorageWatchSpec()!;
		const relPath = path.join('message', 'ses_abc', '.json');
		expect(spec.fileMatcher(relPath)).toBeNull();
	});
});
