/**
 * Server-side History Manager — headless variant of `src/main/history-manager.ts`.
 *
 * Ported for Layer 0h. Differences from the renderer-side `HistoryManager`:
 *
 *   1. **No `electron` import.** `app.getPath('userData')` is replaced with
 *      `getDataDir()` from `src/shared/data-dir.ts`. That helper already
 *      handles the headless precedence chain (`MAESTRO_DATA_DIR` env →
 *      `customSyncPath` in bootstrap JSON → `~/.config/maestro`) and is
 *      lazy-resolved, so importing this module never touches electron.
 *
 *   2. **No `src/main/utils/logger` import.** Falls back to `console.*`
 *      to match the rest of `src/server/`, which standardizes on
 *      `console.log/warn/error` with a `[maestro-server]`-style prefix. The
 *      renderer-side wrapper layers a structured-log buffer + Sentry
 *      breadcrumb path that has no equivalent in headless mode; keeping that
 *      dependency would re-pull the entire `src/main/utils/` tree (sentry →
 *      `@sentry/electron`) into the server graph for zero functional gain.
 *
 *   3. **No `src/main/utils/sentry` import.** Uses `captureException` from
 *      `src/server/sentry.ts`, which is the headless `@sentry/node` wrapper
 *      with the same fire-and-forget call shape. No-op when
 *      `MAESTRO_SENTRY_DSN` isn't set.
 *
 *   4. **Public API matches the renderer-side `HistoryManager` 1:1.** Every
 *      method, every signature, every return type. A caller that already
 *      knows how to use `getHistoryManager()` from `src/main/history-manager`
 *      can swap to this module's `getHistoryManager()` without code changes.
 *      The on-disk format is also identical (`<dataDir>/history/<sessionId>.json`)
 *      so an Electron-written history directory reads correctly here, and
 *      vice-versa.
 *
 * The watcher (`startWatching` / `stopWatching`) uses `fs.watch`, which is
 * pure Node — no chokidar or electron dependency to drop.
 *
 * `src/main/history-manager.ts` is NOT touched. This file is the new
 * server-side surface; the renderer continues to import from the main
 * variant. The shared on-disk format is the contract between them.
 */

import * as fs from 'fs';
import * as path from 'path';
import { getDataDir } from '../shared/data-dir';
import { captureException } from './sentry';
import { HistoryEntry } from '../shared/types';
import {
	HISTORY_VERSION,
	MAX_ENTRIES_PER_SESSION,
	HistoryFileData,
	MigrationMarker,
	PaginationOptions,
	PaginatedResult,
	sanitizeSessionId,
	paginateEntries,
	sortEntriesByTimestamp,
} from '../shared/history';

const LOG_CONTEXT = '[HistoryManager]';

/**
 * HistoryManager handles per-session history storage with automatic migration
 * from the legacy single-file format.
 *
 * Server-side variant. See module header for the diff vs the renderer-side
 * implementation.
 */
export class HistoryManager {
	private historyDir: string;
	private legacyFilePath: string;
	private migrationMarkerPath: string;
	private configDir: string;
	private watcher: fs.FSWatcher | null = null;

	constructor() {
		this.configDir = getDataDir();
		this.historyDir = path.join(this.configDir, 'history');
		this.legacyFilePath = path.join(this.configDir, 'maestro-history.json');
		this.migrationMarkerPath = path.join(this.configDir, 'history-migrated.json');
	}

	/**
	 * Initialize history manager - create directory and run migration if needed
	 */
	async initialize(): Promise<void> {
		// Ensure history directory exists
		if (!fs.existsSync(this.historyDir)) {
			fs.mkdirSync(this.historyDir, { recursive: true });
			console.log(`${LOG_CONTEXT} Created history directory`);
		}

		// Check if migration is needed
		if (this.needsMigration()) {
			await this.migrateFromLegacy();
		}
	}

	/**
	 * Check if migration from legacy format is needed
	 */
	private needsMigration(): boolean {
		// If marker exists, migration was already done
		if (fs.existsSync(this.migrationMarkerPath)) {
			return false;
		}

		// If legacy file exists with entries, need to migrate
		if (fs.existsSync(this.legacyFilePath)) {
			try {
				const data = JSON.parse(fs.readFileSync(this.legacyFilePath, 'utf-8'));
				return data.entries && data.entries.length > 0;
			} catch {
				return false;
			}
		}

		return false;
	}

	/**
	 * Check if migration has been completed
	 */
	hasMigrated(): boolean {
		return fs.existsSync(this.migrationMarkerPath);
	}

	/**
	 * Migrate entries from legacy single-file format to per-session files
	 */
	private async migrateFromLegacy(): Promise<void> {
		console.log(`${LOG_CONTEXT} Starting history migration from legacy format`);

		try {
			const legacyData = JSON.parse(fs.readFileSync(this.legacyFilePath, 'utf-8'));
			const entries: HistoryEntry[] = legacyData.entries || [];

			// Group entries by sessionId (skip entries without sessionId)
			const entriesBySession = new Map<string, HistoryEntry[]>();
			let skippedCount = 0;

			for (const entry of entries) {
				const sessionId = entry.sessionId;
				if (sessionId) {
					if (!entriesBySession.has(sessionId)) {
						entriesBySession.set(sessionId, []);
					}
					entriesBySession.get(sessionId)!.push(entry);
				} else {
					// Skip orphaned entries - they can't be properly associated with a session
					skippedCount++;
				}
			}

			if (skippedCount > 0) {
				console.log(`${LOG_CONTEXT} Skipped ${skippedCount} orphaned entries (no sessionId)`);
			}

			// Write per-session files
			let sessionsMigrated = 0;
			for (const [sessionId, sessionEntries] of entriesBySession) {
				const projectPath = sessionEntries[0]?.projectPath || '';
				const fileData: HistoryFileData = {
					version: HISTORY_VERSION,
					sessionId,
					projectPath,
					entries: sessionEntries.slice(0, MAX_ENTRIES_PER_SESSION),
				};
				const filePath = this.getSessionFilePath(sessionId);
				fs.writeFileSync(filePath, JSON.stringify(fileData, null, 2), 'utf-8');
				sessionsMigrated++;
				console.log(
					`${LOG_CONTEXT} Migrated ${sessionEntries.length} entries for session ${sessionId}`
				);
			}

			// Write migration marker
			const marker: MigrationMarker = {
				migratedAt: Date.now(),
				version: HISTORY_VERSION,
				legacyEntryCount: entries.length,
				sessionsMigrated,
			};
			fs.writeFileSync(this.migrationMarkerPath, JSON.stringify(marker, null, 2), 'utf-8');

			console.log(
				`${LOG_CONTEXT} History migration complete: ${entries.length} entries -> ${sessionsMigrated} session files`
			);
		} catch (error) {
			console.error(`${LOG_CONTEXT} History migration failed: ${error}`);
			throw error;
		}
	}

	/**
	 * Get file path for a session's history
	 */
	private getSessionFilePath(sessionId: string): string {
		const safeId = sanitizeSessionId(sessionId);
		return path.join(this.historyDir, `${safeId}.json`);
	}

	/**
	 * Read history for a specific session
	 */
	getEntries(sessionId: string): HistoryEntry[] {
		const filePath = this.getSessionFilePath(sessionId);
		if (!fs.existsSync(filePath)) {
			return [];
		}
		try {
			const data: HistoryFileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			return data.entries || [];
		} catch (error) {
			console.warn(`${LOG_CONTEXT} Failed to read history for session ${sessionId}: ${error}`);
			captureException(error, { operation: 'history:read', sessionId });
			return [];
		}
	}

	/**
	 * Add an entry to a session's history
	 */
	addEntry(sessionId: string, projectPath: string, entry: HistoryEntry): void {
		const filePath = this.getSessionFilePath(sessionId);
		let data: HistoryFileData;

		if (fs.existsSync(filePath)) {
			try {
				data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			} catch {
				data = { version: HISTORY_VERSION, sessionId, projectPath, entries: [] };
			}
		} else {
			data = { version: HISTORY_VERSION, sessionId, projectPath, entries: [] };
		}

		// Add to beginning (most recent first)
		data.entries.unshift(entry);

		// Trim to max entries
		if (data.entries.length > MAX_ENTRIES_PER_SESSION) {
			data.entries = data.entries.slice(0, MAX_ENTRIES_PER_SESSION);
		}

		// Update projectPath if it changed
		data.projectPath = projectPath;

		try {
			fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
		} catch (error) {
			console.error(`${LOG_CONTEXT} Failed to write history for session ${sessionId}: ${error}`);
			captureException(error, { operation: 'history:write', sessionId });
		}
	}

	/**
	 * Delete a specific entry from a session's history
	 */
	deleteEntry(sessionId: string, entryId: string): boolean {
		const filePath = this.getSessionFilePath(sessionId);
		if (!fs.existsSync(filePath)) {
			return false;
		}

		try {
			const data: HistoryFileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			const originalLength = data.entries.length;
			data.entries = data.entries.filter((e) => e.id !== entryId);

			if (data.entries.length === originalLength) {
				return false; // Entry not found
			}

			try {
				fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
				return true;
			} catch (writeError) {
				console.error(
					`${LOG_CONTEXT} Failed to write history after delete for session ${sessionId}: ${writeError}`
				);
				captureException(writeError, { operation: 'history:deleteWrite', sessionId, entryId });
				return false;
			}
		} catch {
			return false;
		}
	}

	/**
	 * Update a specific entry in a session's history
	 */
	updateEntry(sessionId: string, entryId: string, updates: Partial<HistoryEntry>): boolean {
		const filePath = this.getSessionFilePath(sessionId);
		if (!fs.existsSync(filePath)) {
			return false;
		}

		try {
			const data: HistoryFileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
			const index = data.entries.findIndex((e) => e.id === entryId);

			if (index === -1) {
				return false;
			}

			data.entries[index] = { ...data.entries[index], ...updates };
			try {
				fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
				return true;
			} catch (writeError) {
				console.error(
					`${LOG_CONTEXT} Failed to write history after update for session ${sessionId}: ${writeError}`
				);
				captureException(writeError, { operation: 'history:updateWrite', sessionId, entryId });
				return false;
			}
		} catch {
			return false;
		}
	}

	/**
	 * Clear all history for a session
	 */
	clearSession(sessionId: string): void {
		const filePath = this.getSessionFilePath(sessionId);
		if (fs.existsSync(filePath)) {
			try {
				fs.unlinkSync(filePath);
				console.log(`${LOG_CONTEXT} Cleared history for session ${sessionId}`);
			} catch (error) {
				console.error(`${LOG_CONTEXT} Failed to clear history for session ${sessionId}: ${error}`);
				captureException(error, { operation: 'history:clear', sessionId });
			}
		}
	}

	/**
	 * List all sessions that have history files
	 */
	listSessionsWithHistory(): string[] {
		if (!fs.existsSync(this.historyDir)) {
			return [];
		}
		return fs
			.readdirSync(this.historyDir)
			.filter((f) => f.endsWith('.json'))
			.map((f) => f.replace('.json', ''));
	}

	/**
	 * Get the file path for a session's history (for passing to AI as context)
	 */
	getHistoryFilePath(sessionId: string): string | null {
		const filePath = this.getSessionFilePath(sessionId);
		return fs.existsSync(filePath) ? filePath : null;
	}

	/**
	 * Get all entries across all sessions (for cross-session views)
	 * Returns entries sorted by timestamp (most recent first)
	 * @deprecated Use getAllEntriesPaginated for large datasets
	 */
	getAllEntries(limit?: number): HistoryEntry[] {
		const sessions = this.listSessionsWithHistory();
		const allEntries: HistoryEntry[] = [];

		for (const sessionId of sessions) {
			const entries = this.getEntries(sessionId);
			allEntries.push(...entries);
		}

		const sorted = sortEntriesByTimestamp(allEntries);
		return limit ? sorted.slice(0, limit) : sorted;
	}

	/**
	 * Get all entries across all sessions with pagination support
	 * Returns entries sorted by timestamp (most recent first)
	 */
	getAllEntriesPaginated(options?: PaginationOptions): PaginatedResult<HistoryEntry> {
		const sessions = this.listSessionsWithHistory();
		const allEntries: HistoryEntry[] = [];

		for (const sessionId of sessions) {
			const entries = this.getEntries(sessionId);
			allEntries.push(...entries);
		}

		const sorted = sortEntriesByTimestamp(allEntries);
		return paginateEntries(sorted, options);
	}

	/**
	 * Get entries filtered by project path
	 * @deprecated Use getEntriesByProjectPathPaginated for large datasets
	 */
	getEntriesByProjectPath(projectPath: string): HistoryEntry[] {
		const sessions = this.listSessionsWithHistory();
		const entries: HistoryEntry[] = [];

		for (const sessionId of sessions) {
			const sessionEntries = this.getEntries(sessionId);
			if (sessionEntries.length > 0 && sessionEntries[0].projectPath === projectPath) {
				entries.push(...sessionEntries);
			}
		}

		return sortEntriesByTimestamp(entries);
	}

	/**
	 * Get entries filtered by project path with pagination support
	 */
	getEntriesByProjectPathPaginated(
		projectPath: string,
		options?: PaginationOptions
	): PaginatedResult<HistoryEntry> {
		const sessions = this.listSessionsWithHistory();
		const entries: HistoryEntry[] = [];

		for (const sessionId of sessions) {
			const sessionEntries = this.getEntries(sessionId);
			if (sessionEntries.length > 0 && sessionEntries[0].projectPath === projectPath) {
				entries.push(...sessionEntries);
			}
		}

		const sorted = sortEntriesByTimestamp(entries);
		return paginateEntries(sorted, options);
	}

	/**
	 * Get entries for a specific session with pagination support
	 */
	getEntriesPaginated(
		sessionId: string,
		options?: PaginationOptions
	): PaginatedResult<HistoryEntry> {
		const entries = this.getEntries(sessionId);
		return paginateEntries(entries, options);
	}

	/**
	 * Update sessionName for all entries matching a given agentSessionId.
	 * This is used when a tab is renamed to retroactively update past history entries.
	 */
	updateSessionNameByClaudeSessionId(agentSessionId: string, sessionName: string): number {
		const sessions = this.listSessionsWithHistory();
		let updatedCount = 0;

		for (const sessionId of sessions) {
			const filePath = this.getSessionFilePath(sessionId);
			if (!fs.existsSync(filePath)) continue;

			try {
				const data: HistoryFileData = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
				let modified = false;

				for (const entry of data.entries) {
					if (entry.agentSessionId === agentSessionId && entry.sessionName !== sessionName) {
						entry.sessionName = sessionName;
						modified = true;
						updatedCount++;
					}
				}

				if (modified) {
					fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
				}
			} catch (error) {
				console.warn(
					`${LOG_CONTEXT} Failed to update sessionName in session ${sessionId}: ${error}`
				);
				captureException(error, { operation: 'history:updateSessionName', sessionId });
			}
		}

		return updatedCount;
	}

	/**
	 * Clear all sessions for a specific project
	 */
	clearByProjectPath(projectPath: string): void {
		const sessions = this.listSessionsWithHistory();
		for (const sessionId of sessions) {
			const entries = this.getEntries(sessionId);
			if (entries.length > 0 && entries[0].projectPath === projectPath) {
				this.clearSession(sessionId);
			}
		}
	}

	/**
	 * Clear all history (all session files)
	 */
	clearAll(): void {
		const sessions = this.listSessionsWithHistory();
		for (const sessionId of sessions) {
			this.clearSession(sessionId);
		}
		console.log(`${LOG_CONTEXT} Cleared all history`);
	}

	/**
	 * Start watching the history directory for external changes.
	 * Dispatches events with the affected sessionId so callers can decide
	 * whether to reload caches / notify clients.
	 */
	startWatching(onExternalChange: (sessionId: string) => void): void {
		if (this.watcher) return; // Already watching

		// Ensure directory exists before watching
		if (!fs.existsSync(this.historyDir)) {
			fs.mkdirSync(this.historyDir, { recursive: true });
		}

		try {
			this.watcher = fs.watch(this.historyDir, (_eventType, filename) => {
				if (filename?.endsWith('.json')) {
					const sessionId = filename.replace('.json', '');
					onExternalChange(sessionId);
				}
			});

			// Prevent runtime errors (e.g. Windows UNKNOWN, disk unmount) from
			// becoming unhandled rejections. Swallow to console; caller stays alive.
			this.watcher.on('error', (error) => {
				console.warn(`${LOG_CONTEXT} History watcher error: ${error.message}`);
			});

			console.log(`${LOG_CONTEXT} Started watching history directory`);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			console.warn(`${LOG_CONTEXT} Failed to start history watcher: ${message}`);
			this.watcher = null;
		}
	}

	/**
	 * Stop watching the history directory.
	 */
	stopWatching(): void {
		if (this.watcher) {
			this.watcher.close();
			this.watcher = null;
			console.log(`${LOG_CONTEXT} Stopped watching history directory`);
		}
	}

	/**
	 * Get the history directory path (for debugging/testing)
	 */
	getHistoryDir(): string {
		return this.historyDir;
	}

	/**
	 * Get the legacy file path (for debugging/testing)
	 */
	getLegacyFilePath(): string {
		return this.legacyFilePath;
	}
}

// Singleton instance
let historyManager: HistoryManager | null = null;

/**
 * Get the singleton HistoryManager instance for the headless server.
 *
 * Mirrors the public surface of `getHistoryManager()` in
 * `src/main/history-manager.ts` so that callers can be swapped between
 * desktop-main and headless-server without signature churn.
 */
export function getHistoryManager(): HistoryManager {
	if (!historyManager) {
		historyManager = new HistoryManager();
	}
	return historyManager;
}
