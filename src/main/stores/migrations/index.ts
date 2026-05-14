/**
 * Settings-store migrations.
 *
 * Each migration is idempotent — it persists a marker key in the settings
 * store the first time it runs and short-circuits on subsequent boots. Call
 * `runSettingsMigrations()` once from `app.whenReady()` in
 * `src/main/index.ts`, after `initializeStores()` has resolved the settings
 * store instance.
 */

import type Store from 'electron-store';

import type { MaestroSettings } from '../types';
import { migrateClaudeCodeHeadlessModeToAuto } from './claudeCodeHeadlessModeAuto';

export { migrateClaudeCodeHeadlessModeToAuto, MIGRATION_KEY } from './claudeCodeHeadlessModeAuto';

/**
 * Run every registered settings migration in declaration order.
 */
export function runSettingsMigrations(settingsStore: Store<MaestroSettings>): void {
	migrateClaudeCodeHeadlessModeToAuto(settingsStore);
}
