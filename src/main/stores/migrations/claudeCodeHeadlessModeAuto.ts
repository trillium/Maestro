/**
 * One-time migration: flip `claudeCode.headlessMode` from the phase 2 default
 * `'api'` to phase 3's shipping default `'auto'` for users who never explicitly
 * chose a value. Users who explicitly picked `'api'`, `'interactive'`, or
 * `'auto'` are preserved.
 *
 * Mechanics
 * ---------
 * `electron-store` doesn't write defaults to disk — it merges them in-memory
 * on every `.get()`. So a user who never visited the Claude Interactive Mode
 * setting has no `claudeCode.headlessMode` key on disk and will automatically
 * pick up the new `'auto'` default once `SETTINGS_DEFAULTS` flips. A user who
 * explicitly chose `'api'` has the value persisted to disk, and that explicit
 * value continues to win over the new default.
 *
 * The migration therefore only needs to record a marker so we don't repeatedly
 * scan the file on every boot — but the marker + log are valuable for future
 * default flips and for confidence that the upgrade landed cleanly.
 *
 * To distinguish "user wrote this" from "electron-store served the default",
 * we read the raw JSON file via `store.path`. `store.has()` and `store.get()`
 * both fall through to defaults so they can't answer this question on their
 * own.
 */

import fs from 'fs';
import type Store from 'electron-store';

import type { MaestroSettings } from '../types';
import { logger } from '../../utils/logger';

/** Settings key that records whether this migration has already run. */
export const MIGRATION_KEY = 'claudeCodeHeadlessModeAutoMigrationApplied';

const LOG_CONTEXT = 'Migration';

interface RawSettingsFile {
	claudeCode?: { headlessMode?: unknown };
}

/**
 * Pick the slim Store surface the migration needs so tests can pass a fake
 * without dragging the full `electron-store` API into the mock.
 */
type SettingsStoreLike = Pick<Store<MaestroSettings>, 'get' | 'set' | 'path'>;

/**
 * Read the user's persisted `claudeCode.headlessMode` directly from disk.
 * Returns `undefined` when the file is missing, unreadable, malformed, or the
 * key isn't present — all of which mean "no explicit user value".
 */
function readPersistedHeadlessMode(filePath: string): unknown {
	try {
		const raw = fs.readFileSync(filePath, 'utf-8');
		const parsed = JSON.parse(raw) as RawSettingsFile;
		return parsed.claudeCode?.headlessMode;
	} catch {
		return undefined;
	}
}

/**
 * Apply the migration. Idempotent: short-circuits on subsequent boots via the
 * `claudeCodeHeadlessModeAutoMigrationApplied` marker.
 */
export function migrateClaudeCodeHeadlessModeToAuto(settingsStore: SettingsStoreLike): void {
	if (settingsStore.get(MIGRATION_KEY) === true) {
		return;
	}

	const explicitValue = readPersistedHeadlessMode(settingsStore.path);
	if (explicitValue === undefined) {
		logger.info(
			"Flipped claudeCode.headlessMode default to 'auto' (no explicit user value persisted)",
			LOG_CONTEXT
		);
	} else {
		logger.info(
			`Preserving explicit claudeCode.headlessMode='${String(explicitValue)}'`,
			LOG_CONTEXT
		);
	}

	settingsStore.set(MIGRATION_KEY, true);
}
