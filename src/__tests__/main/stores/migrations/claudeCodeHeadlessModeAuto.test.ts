import { describe, it, expect, beforeEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type Store from 'electron-store';

import type { MaestroSettings } from '../../../../main/stores/types';

// Silence logger output; we don't assert on it (the migration is a marker +
// log, not a behavior-change), so spying is enough.
vi.mock('../../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	migrateClaudeCodeHeadlessModeToAuto,
	MIGRATION_KEY,
} from '../../../../main/stores/migrations/claudeCodeHeadlessModeAuto';
import { logger } from '../../../../main/utils/logger';

type SettingsStoreLike = Pick<Store<MaestroSettings>, 'get' | 'set' | 'path'>;

interface FakeStore {
	path: string;
	get: ReturnType<typeof vi.fn>;
	set: ReturnType<typeof vi.fn>;
	_state: Record<string, unknown>;
	_writeFile: (contents: unknown) => void;
	_removeFile: () => void;
	/**
	 * Cast helper — the migration only consults `get`/`set`/`path`, but the
	 * full electron-store types are too narrow for vi mocks. Tests use this
	 * to satisfy the parameter type without per-call casts.
	 */
	asStore: () => SettingsStoreLike;
}

/**
 * Minimal fake of the electron-store surface the migration consumes. State is
 * held in-memory; `path` points at a real temp file so the migration's raw
 * file read exercises the actual `fs` codepath.
 */
function makeFakeStore(initialState: Record<string, unknown> = {}): FakeStore {
	const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-migrate-'));
	const filePath = path.join(tmpDir, 'maestro-settings.json');
	const state: Record<string, unknown> = { ...initialState };
	const fake: FakeStore = {
		path: filePath,
		get: vi.fn((key: string) => state[key]),
		set: vi.fn((key: string, value: unknown) => {
			state[key] = value;
		}),
		_state: state,
		_writeFile: (contents: unknown) => {
			fs.writeFileSync(filePath, JSON.stringify(contents), 'utf-8');
		},
		_removeFile: () => {
			if (fs.existsSync(filePath)) {
				fs.unlinkSync(filePath);
			}
		},
		asStore: () => fake as unknown as SettingsStoreLike,
	};
	return fake;
}

describe('migrateClaudeCodeHeadlessModeToAuto', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('records the migration marker on first run when the user has no persisted value', () => {
		const fake = makeFakeStore();
		// No settings file on disk → user never wrote a value.
		fake._removeFile();

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(fake.set).toHaveBeenCalledWith(MIGRATION_KEY, true);
		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Flipped claudeCode.headlessMode default to 'auto'"),
			'Migration'
		);
	});

	it('records the migration marker and preserves an explicit user value', () => {
		const fake = makeFakeStore();
		// User explicitly chose `api` under the phase 2 default. The migration
		// must leave that value untouched on disk.
		fake._writeFile({ claudeCode: { headlessMode: 'api' } });

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(fake.set).toHaveBeenCalledWith(MIGRATION_KEY, true);
		expect(fake.set).not.toHaveBeenCalledWith('claudeCode.headlessMode', expect.anything());
		expect(fake.set).not.toHaveBeenCalledWith('claudeCode', expect.anything());

		// The on-disk file is left untouched — electron-store will keep serving
		// the explicit `'api'` value.
		const onDisk = JSON.parse(fs.readFileSync(fake.path, 'utf-8'));
		expect(onDisk.claudeCode.headlessMode).toBe('api');

		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Preserving explicit claudeCode.headlessMode='api'"),
			'Migration'
		);
	});

	it('preserves an explicit `interactive` choice', () => {
		const fake = makeFakeStore();
		fake._writeFile({ claudeCode: { headlessMode: 'interactive' } });

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Preserving explicit claudeCode.headlessMode='interactive'"),
			'Migration'
		);
		expect(fake.set).toHaveBeenCalledWith(MIGRATION_KEY, true);
	});

	it('preserves an explicit `auto` choice (no-op log, but marker still set)', () => {
		const fake = makeFakeStore();
		fake._writeFile({ claudeCode: { headlessMode: 'auto' } });

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Preserving explicit claudeCode.headlessMode='auto'"),
			'Migration'
		);
		expect(fake.set).toHaveBeenCalledWith(MIGRATION_KEY, true);
	});

	it('treats a missing `claudeCode.headlessMode` key as "no explicit value" even when other claudeCode subkeys exist', () => {
		const fake = makeFakeStore();
		// User toggled `autoFallbackToApiOnLimit` but never picked a headless
		// mode — the migration must still treat the headless mode as default-served.
		fake._writeFile({ claudeCode: { autoFallbackToApiOnLimit: false } });

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Flipped claudeCode.headlessMode default to 'auto'"),
			'Migration'
		);
		expect(fake.set).toHaveBeenCalledWith(MIGRATION_KEY, true);
	});

	it('handles a malformed settings file gracefully (treats as no explicit value)', () => {
		const fake = makeFakeStore();
		fs.writeFileSync(fake.path, '{not valid json', 'utf-8');

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(logger.info).toHaveBeenCalledWith(
			expect.stringContaining("Flipped claudeCode.headlessMode default to 'auto'"),
			'Migration'
		);
		expect(fake.set).toHaveBeenCalledWith(MIGRATION_KEY, true);
	});

	it('short-circuits on subsequent runs once the marker is set', () => {
		const fake = makeFakeStore({ [MIGRATION_KEY]: true });
		// Even with an explicit value on disk, the migration must not log or
		// re-write the marker on the second boot.
		fake._writeFile({ claudeCode: { headlessMode: 'api' } });

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(fake.set).not.toHaveBeenCalled();
		expect(logger.info).not.toHaveBeenCalled();
	});

	it('is idempotent across two consecutive calls', () => {
		const fake = makeFakeStore();
		fake._writeFile({ claudeCode: { headlessMode: 'api' } });

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());
		// Simulate the next boot: the marker is now set on the in-memory state.
		expect(fake._state[MIGRATION_KEY]).toBe(true);

		vi.mocked(logger.info).mockClear();
		fake.set.mockClear();

		migrateClaudeCodeHeadlessModeToAuto(fake.asStore());

		expect(fake.set).not.toHaveBeenCalled();
		expect(logger.info).not.toHaveBeenCalled();
	});
});
