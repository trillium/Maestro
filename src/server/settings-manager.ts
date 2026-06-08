/**
 * Server-side settings persistence manager.
 *
 * Audit #14 (third audit on this priority) called out that the
 * `/api/settings/{get,set}` REST surface in the headless server
 * (`src/main/web-server/routes/apiRoutes.ts`) was backed only by an
 * implicit, lazy, sync `FileStore` instance via `getDefaultProvider()`.
 * That worked end-to-end, but:
 *
 *   1. **No explicit lifecycle.** The default provider was instantiated
 *      on first request, not at boot. A cold start that crashes on the
 *      very first PATCH would lose the in-flight patch silently.
 *   2. **Sync writes on the request hot path.** `fs.writeFileSync` +
 *      `fs.renameSync` block Fastify's event loop for the duration of
 *      the write. That's fine for the tiny settings JSON today, but it
 *      sets a bad precedent.
 *   3. **No fallback on disk read failure.** `FileStore.load()` swallows
 *      every read error to the same in-memory `defaults` branch. We
 *      can't distinguish "first boot, file missing" from "file exists
 *      but is corrupted / permission denied" — both downgrade silently
 *      to defaults and the next PATCH overwrites whatever was there.
 *
 * This manager closes those three gaps:
 *
 *   1. **Explicit boot read.** `load()` is awaited from `src/server/
 *      index.ts` before `WebServer.start()`. Settings are guaranteed
 *      to be in memory before the first request lands.
 *   2. **Async atomic writes via `fs/promises`.** Each `setSettings()`
 *      writes to `maestro-settings.json.tmp`, then `rename()` atomically
 *      replaces `maestro-settings.json`. Writes are serialized through
 *      a per-instance promise chain so concurrent PATCHes don't race
 *      on the temp file.
 *   3. **Distinguishable read errors.** `ENOENT` defaults to `{}` (first
 *      boot path); any other read error is logged and the manager falls
 *      back to an in-memory `{}` for the rest of the process. The
 *      operator gets a clear log line; the routes keep serving instead
 *      of 500-ing every request.
 *
 * On-disk schema: identical to the existing `electron-store` /
 * `src/shared/file-store.ts` `<name>.json` shape (`maestro-settings.json`
 * under `getDataDir()`). An Electron-written settings file is read
 * correctly here, and vice versa, so a hybrid (Electron + headless
 * sidecar) deployment keeps working.
 *
 * NOT touched: `src/shared/file-store.ts` (still used by sessionsStore,
 * groupsStore, etc.). `src/main/web-server/routes/apiRoutes.ts`'s default
 * fallback provider still exists; the headless server explicitly
 * registers this manager via `registerSettingsProvider()` so the
 * fallback never fires in headless mode. Electron is unaffected.
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import type { SettingsProvider } from '../main/web-server/routes/apiRoutes';

const LOG_CONTEXT = '[Settings]';

export interface SettingsManagerOptions {
	/** Data directory (matches `getDataDir()` in the live server). */
	dataDir: string;
	/** Filename without extension. Defaults to `maestro-settings` (electron-store parity). */
	name?: string;
}

/**
 * Server-side settings manager. Implements the `SettingsProvider` shape
 * consumed by `src/main/web-server/routes/apiRoutes.ts` (sync
 * `getSettings()` + sync `setSettings()`). The sync-return signature is
 * preserved for route-handler parity, but the underlying disk write is
 * async — `setSettings()` queues the write and returns the updated
 * in-memory snapshot immediately. The write completes before the next
 * `setSettings()` write runs (FIFO chain), so observers reading via the
 * GET route after the PATCH response always see the post-write state
 * (the in-memory cache is updated synchronously before the chain).
 */
export class SettingsManager implements SettingsProvider {
	private readonly filePath: string;
	private data: Record<string, unknown>;
	private writeChain: Promise<void>;
	/** Set to true once load() has either read the file or hit ENOENT. */
	private loaded: boolean;
	/** Set to true if a non-ENOENT read error knocked us into in-memory-only mode. */
	private degraded: boolean;

	constructor(opts: SettingsManagerOptions) {
		const name = opts.name ?? 'maestro-settings';
		this.filePath = path.join(opts.dataDir, `${name}.json`);
		this.data = {};
		this.writeChain = Promise.resolve();
		this.loaded = false;
		this.degraded = false;
	}

	/**
	 * Read the settings file from disk into memory. MUST be awaited before
	 * the server starts serving requests. Idempotent — subsequent calls
	 * are no-ops.
	 *
	 *   - File missing (ENOENT): defaults to `{}`, marks as loaded.
	 *   - File present + parseable: adopts the parsed object.
	 *   - File present + unreadable / unparseable: logs, falls back to
	 *     `{}`, marks `degraded = true`. Writes still work; the next
	 *     successful write replaces the corrupted file.
	 */
	async load(): Promise<void> {
		if (this.loaded) {
			return;
		}
		try {
			await fs.mkdir(path.dirname(this.filePath), { recursive: true });
			const raw = await fs.readFile(this.filePath, 'utf-8');
			const parsed = JSON.parse(raw) as Record<string, unknown>;
			if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
				throw new Error('settings file is not a JSON object');
			}
			this.data = { ...parsed };
		} catch (err: any) {
			if (err?.code === 'ENOENT') {
				// First boot — no file yet. Defaults already at {}.
				this.data = {};
			} else {
				// Corrupted / permission denied / parse error. Log and fall
				// back to empty in-memory. The next successful write replaces
				// the file (we still write through the atomic temp+rename
				// path, so a corrupted file is not amplified).
				console.error(
					`${LOG_CONTEXT} failed to read ${this.filePath}: ${err?.message ?? String(err)}; falling back to in-memory defaults`
				);
				this.degraded = true;
				this.data = {};
			}
		} finally {
			this.loaded = true;
		}
	}

	/** Whether the manager is running in degraded (read-failed, in-memory only) mode. */
	isDegraded(): boolean {
		return this.degraded;
	}

	/** Absolute path of the on-disk settings file. */
	get path(): string {
		return this.filePath;
	}

	/**
	 * Return the full settings object (defensive copy).
	 *
	 * Synchronous: reads from the in-memory cache populated by `load()`.
	 */
	getSettings(): Record<string, unknown> {
		return { ...this.data };
	}

	/**
	 * Apply a partial patch. Updates the in-memory cache synchronously
	 * (so the return value is immediately consistent with subsequent
	 * `getSettings()` reads) and queues an async atomic disk write.
	 *
	 * The write is serialized through a per-instance promise chain
	 * (`writeChain`) so concurrent PATCH requests can't race on the
	 * `.tmp` file. If a write fails (e.g. disk full), the in-memory
	 * cache is NOT rolled back — the next successful write persists the
	 * full current state, which keeps callers from re-applying the patch
	 * blindly. The error is logged.
	 *
	 * Patch semantics: shallow merge at the top-level key. `null` /
	 * `undefined` values overwrite the existing key with that literal
	 * (matches `electron-store` `.set(key, value)` behavior). Callers
	 * that want delete semantics should pass `undefined` and accept that
	 * the key remains in the object (consistent with the renderer's
	 * `window.maestro.settings.set('key', value)` IPC behavior).
	 */
	setSettings(patch: Record<string, unknown>): Record<string, unknown> {
		// Synchronous in-memory update — the route handler returns this
		// immediately, and the next GET reflects it.
		for (const [k, v] of Object.entries(patch)) {
			this.data[k] = v;
		}
		const snapshot = { ...this.data };
		this.queueWrite(snapshot);
		return snapshot;
	}

	/**
	 * Test / shutdown helper — await the in-flight write queue. Production
	 * code does not need to call this; the route handler returns before
	 * the write resolves and that's intentional (matches `electron-store`
	 * fire-and-forget semantics from the renderer side).
	 */
	async flush(): Promise<void> {
		await this.writeChain;
	}

	/**
	 * Test-only — clear the in-memory cache and force a re-load on the
	 * next request. Used by `settings-manager.test.ts` to exercise the
	 * boot-read path against a pre-populated file.
	 */
	_resetForTesting(): void {
		this.data = {};
		this.loaded = false;
		this.degraded = false;
		this.writeChain = Promise.resolve();
	}

	private queueWrite(snapshot: Record<string, unknown>): void {
		this.writeChain = this.writeChain.then(async () => {
			try {
				await this.atomicWrite(snapshot);
			} catch (err: any) {
				console.error(
					`${LOG_CONTEXT} atomic write to ${this.filePath} failed: ${err?.message ?? String(err)}`
				);
			}
		});
	}

	private async atomicWrite(snapshot: Record<string, unknown>): Promise<void> {
		const tmp = `${this.filePath}.tmp`;
		await fs.mkdir(path.dirname(this.filePath), { recursive: true });
		// Write to temp, then atomically rename onto the target. The
		// rename is atomic on POSIX (and "best-effort atomic" on Windows
		// via NTFS MoveFileEx semantics — Node's fs.rename uses that).
		// If we crash between writeFile and rename, the on-disk
		// `maestro-settings.json` is untouched and the orphan `.tmp` gets
		// overwritten on the next attempt.
		await fs.writeFile(tmp, JSON.stringify(snapshot, null, 2), 'utf-8');
		await fs.rename(tmp, this.filePath);
	}
}

/* ============ Singleton accessor for the headless server ============ */

let settingsManager: SettingsManager | null = null;

/**
 * Get-or-create the singleton `SettingsManager` for the headless server.
 *
 * The first call must supply `dataDir`; subsequent calls return the
 * cached instance regardless of arguments (matches the
 * `getWakaTimeManager()` / `getStatsManager()` pattern in the rest of
 * `src/server/`).
 *
 * The caller is responsible for awaiting `load()` before the first
 * client request lands. `src/server/index.ts` does this inside `main()`
 * alongside the other async boot-time initializers.
 */
export function getSettingsManager(dataDir?: string): SettingsManager {
	if (!settingsManager) {
		if (!dataDir) {
			throw new Error(
				'[Settings] getSettingsManager() called before initialization. The first call must supply dataDir.'
			);
		}
		settingsManager = new SettingsManager({ dataDir });
	}
	return settingsManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetSettingsManager(): void {
	settingsManager = null;
}
