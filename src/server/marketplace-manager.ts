/**
 * Server-side marketplace manager — headless variant of
 * `src/main/ipc/handlers/marketplace.ts`.
 *
 * Ported for W3 (closes the server half of
 * `ISC-44.shim.w3_marketplace_routes`, tracked in `ISA.md`). This module
 * mirrors the renderer-side marketplace IPC handler 1:1 for manifest /
 * document / README fetching, manifest merging (official + local), local
 * manifest hot-reload via `fs.watch`, and the on-disk cache contract at
 * `<dataDir>/marketplace-cache.json`. Differences from the renderer-side
 * handler match the posture established by the W2-wakatime / W2-stats /
 * W2-fonts ports:
 *
 *   1. **No `electron` import.** `app.getPath('userData')` is replaced by
 *      `getDataDir()` from `src/shared/data-dir.ts`. `BrowserWindow.getAllWindows()
 *      → win.webContents.send('marketplace:manifestChanged')` is replaced
 *      by an `EventEmitter` surface (`onManifestChanged(listener) → cleanup`)
 *      that the SSE route handler subscribes to.
 *
 *   2. **No `electron-store` import.** SSH remote lookup uses the headless
 *      `FileStore<Record<string, unknown>>` already in `src/server/index.ts`
 *      via a minimal `SettingsReader` interface (`.get(key, default)`).
 *      Matches the `WakaTimeSettingsReader` pattern in `wakatime-manager.ts`.
 *
 *   3. **No `src/main/utils/logger` import.** Falls back to `console.*`
 *      with a `[Marketplace]` prefix — matches the rest of `src/server/`.
 *
 *   4. **No `src/main/utils/ipcHandler` import.** The renderer-side handler
 *      wraps each IPC call in `createIpcHandler(opts, fn)` for unified
 *      success/error envelopes; the server-side surface returns plain
 *      objects matching the renderer-side success-path shape, and the
 *      route handlers in `apiRoutes.ts` translate exceptions to the
 *      standard `{ error, message, timestamp }` 500 response.
 *
 *   5. **No `src/main/utils/remote-fs` import.** That module is outside
 *      `tsconfig.server.json`'s include set and would drag electron-side
 *      dependencies (`sshRemoteManager`, `logger`) into the server bundle.
 *      The headless manager rejects `sshRemoteId`-targeted imports with a
 *      clear `MarketplaceImportError`: SSH-via-headless is not supported
 *      in this port. Local imports work end-to-end; SSH-targeted imports
 *      are an explicit non-goal until a follow-up brief lifts the SSH
 *      utility surface into the server tree. This matches the W3 brief's
 *      scope discipline (the consumer `useMarketplace` hook does not
 *      itself drive SSH imports — the SSH path is set up by callers, who
 *      can route around the headless surface when an SSH remote is
 *      involved). The renderer-side handler is NOT touched and continues
 *      to own the SSH path inside Electron.
 *
 *   6. **Public API matches the renderer-side IPC reply shapes 1:1** for
 *      the methods the REST routes call: `getManifest()`, `refreshManifest()`,
 *      `getDocument()`, `getReadme()`, `importPlaybook()`. Return shapes are
 *      the success-path of the renderer-side replies (manifest envelopes
 *      include `{ manifest, fromCache, cacheAge? }`; document fetches return
 *      `{ content }`; imports return `{ playbook, importedDocs, importedAssets }`).
 *
 *   7. **No `crypto` differences.** The renderer-side handler calls
 *      `crypto.randomUUID()` for the imported playbook's local id; the
 *      server-side variant does the same. Both modes can write playbooks
 *      whose ids never collide.
 *
 *   8. **No filesystem layout changes.** The cache + local manifest files
 *      live at `<dataDir>/marketplace-cache.json` and
 *      `<dataDir>/local-manifest.json`; imported playbooks land in
 *      `<dataDir>/playbooks/<sessionId>.json`. These paths are the contract
 *      between Electron and headless modes — a desktop user who has
 *      imported playbooks under Electron can read them headless and vice
 *      versa.
 *
 * NETWORK EGRESS NOTE: this manager makes outbound HTTPS calls to
 * `raw.githubusercontent.com` (manifest, documents, READMEs, assets).
 * Matches the renderer-side handler 1:1 — no new egress surface is added
 * by porting to server-side. The headless server is already expected to
 * reach the public internet for upstream playbook content; a future
 * private-only mode would gate on a `marketplaceOfficialFetchEnabled`
 * setting and is explicitly out of scope here.
 *
 * `src/main/ipc/handlers/marketplace.ts` is NOT touched. This file is the
 * new server-side surface; the renderer continues to use the
 * `marketplace:*` IPC namespace.
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { EventEmitter } from 'events';
import { captureException } from './sentry';
import type {
	MarketplaceManifest,
	MarketplaceCache,
	MarketplacePlaybook,
	GetManifestResponse,
	GetDocumentResponse,
	GetReadmeResponse,
	ImportPlaybookResponse,
} from '../shared/marketplace-types';
import { MarketplaceFetchError, MarketplaceImportError } from '../shared/marketplace-types';

const LOG_CONTEXT = '[Marketplace]';
const GITHUB_RAW_BASE = 'https://raw.githubusercontent.com/RunMaestro/Maestro-Playbooks/main';
const MANIFEST_URL = `${GITHUB_RAW_BASE}/manifest.json`;
const CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours — matches renderer-side TTL
const WATCHER_DEBOUNCE_MS = 500;

/* ============ Minimal SettingsReader interface ============ */

/**
 * The subset of electron-store / FileStore that the manager actually uses.
 * Mirrors the `WakaTimeSettingsReader` pattern in `wakatime-manager.ts`.
 * Decouples the manager from the main-process `Store<MaestroSettings>` type
 * so the headless server can pass its `FileStore<Record<string, unknown>>`
 * without dragging the electron-store types tree into the server build.
 *
 * Only `.get(key, default)` is needed — SSH remote lookup is the sole
 * settings read inside this manager, and even that is gated behind a
 * caller-supplied `sshRemoteId` (which the headless surface rejects today
 * — see header note #5).
 */
export interface MarketplaceSettingsReader {
	get<V>(key: string, defaultValue: V): V;
}

/* ============ Helpers — path validation, tilde resolution ============ */

/**
 * Check if a path is a local filesystem path (absolute or tilde-prefixed).
 * Matches the renderer-side `isLocalPath` 1:1.
 */
function isLocalPath(pathStr: string): boolean {
	if (path.isAbsolute(pathStr)) return true;
	if (pathStr.startsWith('~/') || pathStr.startsWith('~\\')) return true;
	return false;
}

/** Resolve tilde (~) to user's home directory. Matches renderer-side. */
function resolveTildePath(pathStr: string): string {
	if (pathStr.startsWith('~/') || pathStr.startsWith('~\\')) {
		return path.join(os.homedir(), pathStr.slice(2));
	}
	return pathStr;
}

/**
 * Validate that a resolved path stays within the expected base directory.
 * Prevents path traversal attacks via crafted filenames like
 * "../../etc/passwd". Matches renderer-side validation 1:1.
 */
function validateSafePath(basePath: string, requestedFile: string): string {
	const realBase = path.resolve(basePath);
	const resolved = path.resolve(basePath, requestedFile);
	if (!resolved.startsWith(realBase + path.sep) && resolved !== realBase) {
		throw new MarketplaceFetchError(`Path traversal blocked: ${requestedFile}`);
	}
	return resolved;
}

/* ============ Manifest merging ============ */

/**
 * Merge official and local manifests by `id`. Matches renderer-side
 * `mergeManifests` 1:1 — local overrides official with same id; local-only
 * ids append to the catalog; every playbook is tagged with a `source`
 * field for UI distinction.
 */
function mergeManifests(
	official: MarketplaceManifest | null,
	local: MarketplaceManifest | null
): MarketplaceManifest {
	if (!official && !local) {
		return {
			lastUpdated: new Date().toISOString().split('T')[0],
			playbooks: [],
		};
	}

	if (official && !local) {
		return {
			...official,
			playbooks: official.playbooks.map((p) => ({ ...p, source: 'official' as const })),
		};
	}

	if (!official && local) {
		return {
			...local,
			playbooks: local.playbooks.map((p) => ({ ...p, source: 'local' as const })),
		};
	}

	const officialPlaybooks = official!.playbooks;
	const localPlaybooks = local!.playbooks;

	const localMap = new Map<string, MarketplacePlaybook>();
	for (const playbook of localPlaybooks) {
		if (!playbook.id) {
			console.warn(`${LOG_CONTEXT} Local playbook missing required "id" field, skipping`);
			continue;
		}
		if (!playbook.title || !playbook.path || !playbook.documents) {
			console.warn(
				`${LOG_CONTEXT} Local playbook "${playbook.id}" missing required fields, skipping`
			);
			continue;
		}
		localMap.set(playbook.id, { ...playbook, source: 'local' });
	}

	const mergedPlaybooks = officialPlaybooks.map((p) => {
		const localOverride = localMap.get(p.id);
		if (localOverride) {
			console.log(`${LOG_CONTEXT} Local playbook "${p.id}" overrides official version`);
			return localOverride;
		}
		return { ...p, source: 'official' as const };
	});

	const officialIds = new Set(officialPlaybooks.map((p) => p.id));
	const localOnlyPlaybooks = Array.from(localMap.values()).filter(
		(local) => !officialIds.has(local.id)
	);

	const finalPlaybooks = [...mergedPlaybooks, ...localOnlyPlaybooks];

	console.log(
		`${LOG_CONTEXT} Merged manifest: ${officialPlaybooks.length} official, ${localPlaybooks.length} local, ${finalPlaybooks.length} total`
	);

	return {
		lastUpdated:
			official?.lastUpdated || local?.lastUpdated || new Date().toISOString().split('T')[0],
		playbooks: finalPlaybooks,
	};
}

/* ============ MarketplaceManager (server-side) ============ */

export class MarketplaceManager {
	private dataDir: string;
	private settingsStore: MarketplaceSettingsReader;
	private emitter = new EventEmitter();
	private localManifestWatcher: fsSync.FSWatcher | null = null;
	private watcherDebounceTimer: NodeJS.Timeout | null = null;

	/**
	 * @param dataDir        Headless userData root (`getDataDir()`). Cache lives
	 *                       at `<dataDir>/marketplace-cache.json`; local manifest
	 *                       at `<dataDir>/local-manifest.json`; imported
	 *                       playbooks land in `<dataDir>/playbooks/<sessionId>.json`.
	 * @param settingsStore  Anything with `.get(key, default)` — used for SSH
	 *                       remote lookup. The headless server passes its
	 *                       `FileStore<Record<string, unknown>>`.
	 */
	constructor(dataDir: string, settingsStore: MarketplaceSettingsReader) {
		this.dataDir = dataDir;
		this.settingsStore = settingsStore;
		// EventEmitter has a 10-listener default; the SSE route is the sole
		// consumer today but multiple concurrent EventSource clients are
		// expected (one per open browser tab on a multi-machine deployment).
		// Raise the cap to a generous default to prevent the noisy warning
		// without giving up the protective leak detection entirely.
		this.emitter.setMaxListeners(64);
		this.setupLocalManifestWatcher();
	}

	/* -------- on-disk paths -------- */

	private getCacheFilePath(): string {
		return path.join(this.dataDir, 'marketplace-cache.json');
	}

	private getLocalManifestPath(): string {
		return path.join(this.dataDir, 'local-manifest.json');
	}

	/* -------- cache I/O (matches renderer-side 1:1) -------- */

	private async readCache(): Promise<MarketplaceCache | null> {
		const cachePath = this.getCacheFilePath();
		try {
			const content = await fs.readFile(cachePath, 'utf-8');
			const data = JSON.parse(content);
			if (
				typeof data.fetchedAt !== 'number' ||
				!data.manifest ||
				!Array.isArray(data.manifest.playbooks)
			) {
				console.warn(`${LOG_CONTEXT} Invalid cache structure, ignoring`);
				return null;
			}
			return data as MarketplaceCache;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				// Non-fatal — log at debug-equivalent (no-op in headless to keep
				// the boot logs clean). Matches the renderer-side posture.
			}
			return null;
		}
	}

	private async writeCache(manifest: MarketplaceManifest): Promise<void> {
		const cachePath = this.getCacheFilePath();
		try {
			// Ensure parent dir exists — getDataDir() may not have been
			// created yet on a fresh headless install.
			await fs.mkdir(path.dirname(cachePath), { recursive: true });
			const cache: MarketplaceCache = {
				fetchedAt: Date.now(),
				manifest,
			};
			await fs.writeFile(cachePath, JSON.stringify(cache, null, 2), 'utf-8');
		} catch (error) {
			console.warn(`${LOG_CONTEXT} Failed to write cache: ${(error as Error).message}`);
			// Don't throw — cache write failure shouldn't fail the operation.
		}
	}

	private isCacheValid(cache: MarketplaceCache): boolean {
		return Date.now() - cache.fetchedAt < CACHE_TTL_MS;
	}

	/* -------- local manifest I/O (matches renderer-side 1:1) -------- */

	private async readLocalManifest(): Promise<MarketplaceManifest | null> {
		const localManifestPath = this.getLocalManifestPath();
		try {
			const content = await fs.readFile(localManifestPath, 'utf-8');
			const data = JSON.parse(content);
			if (!data.playbooks || !Array.isArray(data.playbooks)) {
				console.warn(`${LOG_CONTEXT} Invalid local manifest structure: missing playbooks array`);
				return null;
			}
			console.log(`${LOG_CONTEXT} Loaded local manifest with ${data.playbooks.length} playbook(s)`);
			return data as MarketplaceManifest;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return null;
			}
			console.warn(`${LOG_CONTEXT} Failed to read local manifest, ignoring`);
			return null;
		}
	}

	/* -------- remote fetch (matches renderer-side 1:1) -------- */

	private async fetchManifest(): Promise<MarketplaceManifest> {
		console.log(`${LOG_CONTEXT} Fetching manifest from GitHub`);
		try {
			const response = await fetch(MANIFEST_URL);
			if (!response.ok) {
				throw new MarketplaceFetchError(
					`Failed to fetch manifest: ${response.status} ${response.statusText}`
				);
			}
			const data = (await response.json()) as { playbooks?: unknown[] };
			if (!data.playbooks || !Array.isArray(data.playbooks)) {
				throw new MarketplaceFetchError('Invalid manifest structure: missing playbooks array');
			}
			console.log(`${LOG_CONTEXT} Fetched manifest with ${data.playbooks.length} playbooks`);
			return data as unknown as MarketplaceManifest;
		} catch (error) {
			if (error instanceof MarketplaceFetchError) {
				throw error;
			}
			throw new MarketplaceFetchError(
				`Network error fetching manifest: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	private async fetchDocument(playbookPath: string, filename: string): Promise<string> {
		if (filename.includes('..')) {
			throw new MarketplaceFetchError('Invalid filename');
		}

		if (isLocalPath(playbookPath)) {
			const resolvedPath = resolveTildePath(playbookPath);
			const docPath = validateSafePath(resolvedPath, `${filename}.md`);
			try {
				return await fs.readFile(docPath, 'utf-8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					throw new MarketplaceFetchError(`Local document not found: ${docPath}`);
				}
				throw new MarketplaceFetchError(
					`Failed to read local document: ${error instanceof Error ? error.message : String(error)}`,
					error
				);
			}
		}

		const url = `${GITHUB_RAW_BASE}/${playbookPath}/${filename}.md`;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				if (response.status === 404) {
					throw new MarketplaceFetchError(`Document not found: ${filename}`, { status: 404 });
				}
				throw new MarketplaceFetchError(
					`Failed to fetch document: ${response.status} ${response.statusText}`
				);
			}
			return await response.text();
		} catch (error) {
			if (error instanceof MarketplaceFetchError) {
				throw error;
			}
			throw new MarketplaceFetchError(
				`Network error fetching document: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	private async fetchAsset(playbookPath: string, assetFilename: string): Promise<Buffer> {
		if (assetFilename.includes('..')) {
			throw new MarketplaceFetchError('Invalid filename');
		}

		if (isLocalPath(playbookPath)) {
			const resolvedPath = resolveTildePath(playbookPath);
			const assetPath = validateSafePath(resolvedPath, path.join('assets', assetFilename));
			try {
				return await fs.readFile(assetPath);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					throw new MarketplaceFetchError(`Local asset not found: ${assetPath}`);
				}
				throw new MarketplaceFetchError(
					`Failed to read local asset: ${error instanceof Error ? error.message : String(error)}`,
					error
				);
			}
		}

		const url = `${GITHUB_RAW_BASE}/${playbookPath}/assets/${assetFilename}`;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				if (response.status === 404) {
					throw new MarketplaceFetchError(`Asset not found: ${assetFilename}`, { status: 404 });
				}
				throw new MarketplaceFetchError(
					`Failed to fetch asset: ${response.status} ${response.statusText}`
				);
			}
			const arrayBuffer = await response.arrayBuffer();
			return Buffer.from(arrayBuffer);
		} catch (error) {
			if (error instanceof MarketplaceFetchError) {
				throw error;
			}
			throw new MarketplaceFetchError(
				`Network error fetching asset: ${error instanceof Error ? error.message : String(error)}`,
				error
			);
		}
	}

	private async fetchReadme(playbookPath: string): Promise<string | null> {
		if (isLocalPath(playbookPath)) {
			const resolvedPath = resolveTildePath(playbookPath);
			const readmePath = validateSafePath(resolvedPath, 'README.md');
			try {
				return await fs.readFile(readmePath, 'utf-8');
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
					return null;
				}
				return null;
			}
		}

		const url = `${GITHUB_RAW_BASE}/${playbookPath}/README.md`;
		try {
			const response = await fetch(url);
			if (!response.ok) {
				if (response.status === 404) return null;
				throw new MarketplaceFetchError(
					`Failed to fetch README: ${response.status} ${response.statusText}`
				);
			}
			return await response.text();
		} catch (error) {
			if (error instanceof MarketplaceFetchError) {
				throw error;
			}
			return null;
		}
	}

	/* -------- local manifest watcher -> EventEmitter (replaces BrowserWindow.webContents.send) -------- */

	/**
	 * Subscribe to manifest-changed events. The returned cleanup function
	 * removes the listener. Used by the SSE route in `apiRoutes.ts`.
	 *
	 * In the renderer-side handler this fanned out as `webContents.send('marketplace:manifestChanged')`
	 * to every open BrowserWindow. The headless variant emits to every
	 * subscribed SSE client instead — same semantics, different transport.
	 */
	onManifestChanged(listener: () => void): () => void {
		this.emitter.on('manifestChanged', listener);
		return () => {
			this.emitter.off('manifestChanged', listener);
		};
	}

	private setupLocalManifestWatcher(): void {
		const localManifestPath = this.getLocalManifestPath();
		try {
			if (this.localManifestWatcher) {
				this.localManifestWatcher.close();
				this.localManifestWatcher = null;
			}
			this.localManifestWatcher = fsSync.watch(localManifestPath, (eventType: string) => {
				if (this.watcherDebounceTimer) {
					clearTimeout(this.watcherDebounceTimer);
				}
				this.watcherDebounceTimer = setTimeout(() => {
					console.log(`${LOG_CONTEXT} Local manifest changed (${eventType}), broadcasting`);
					this.emitter.emit('manifestChanged');
				}, WATCHER_DEBOUNCE_MS);
			});
			this.localManifestWatcher.on('error', (error) => {
				console.warn(`${LOG_CONTEXT} Local manifest watcher error: ${error.message}`);
			});
		} catch (error) {
			// File might not exist yet — this is normal. Watcher failure
			// shouldn't prevent normal operation.
			if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
				console.warn(`${LOG_CONTEXT} Failed to setup local manifest watcher (non-fatal)`);
			}
		}
	}

	/**
	 * Cleanup the file watcher + any pending debounce timer.
	 * Called from the headless server's SIGINT/SIGTERM shutdown path.
	 */
	shutdown(): void {
		if (this.watcherDebounceTimer) {
			clearTimeout(this.watcherDebounceTimer);
			this.watcherDebounceTimer = null;
		}
		if (this.localManifestWatcher) {
			try {
				this.localManifestWatcher.close();
			} catch {
				/* ignore */
			}
			this.localManifestWatcher = null;
		}
		this.emitter.removeAllListeners();
	}

	/* ============ Public API — mirrors renderer-side IPC reply shapes ============ */

	/**
	 * Get manifest (from cache if valid, else fetch). Matches renderer-side
	 * `marketplace:getManifest` success-path reply 1:1.
	 */
	async getManifest(): Promise<GetManifestResponse> {
		const cache = await this.readCache();
		let officialManifest: MarketplaceManifest | null = null;
		let fromCache = false;
		let cacheAge: number | undefined;

		if (cache && this.isCacheValid(cache)) {
			cacheAge = Date.now() - cache.fetchedAt;
			officialManifest = cache.manifest;
			fromCache = true;
		} else {
			try {
				officialManifest = await this.fetchManifest();
				await this.writeCache(officialManifest);
			} catch (error) {
				console.warn(`${LOG_CONTEXT} Failed to fetch official manifest from GitHub`);
				captureException(error, { context: 'marketplace:getManifest' });
				if (cache) {
					cacheAge = Date.now() - cache.fetchedAt;
					console.log(
						`${LOG_CONTEXT} Using expired cache as fallback (age: ${Math.round(cacheAge / 1000)}s)`
					);
					officialManifest = cache.manifest;
					fromCache = true;
				} else {
					console.warn(`${LOG_CONTEXT} No cache available, continuing with local only`);
				}
			}
		}

		const localManifest = await this.readLocalManifest();
		const mergedManifest = mergeManifests(officialManifest, localManifest);

		return {
			manifest: mergedManifest,
			fromCache,
			cacheAge,
		};
	}

	/**
	 * Force refresh manifest (bypass cache). Matches renderer-side
	 * `marketplace:refreshManifest` success-path reply 1:1 (returns
	 * `{ manifest, fromCache }` — no `cacheAge` field, matching renderer).
	 */
	async refreshManifest(): Promise<{ manifest: MarketplaceManifest; fromCache: boolean }> {
		console.log(`${LOG_CONTEXT} Force refreshing manifest (bypass cache)`);
		let officialManifest: MarketplaceManifest | null = null;
		let fromCache = false;
		try {
			officialManifest = await this.fetchManifest();
			await this.writeCache(officialManifest);
		} catch (error) {
			console.warn(`${LOG_CONTEXT} Failed to fetch official manifest during refresh`);
			captureException(error, { context: 'marketplace:refreshManifest' });
			const cache = await this.readCache();
			if (cache) {
				console.log(`${LOG_CONTEXT} Using existing cache as fallback after refresh failure`);
				officialManifest = cache.manifest;
				fromCache = true;
			}
		}

		const localManifest = await this.readLocalManifest();
		const mergedManifest = mergeManifests(officialManifest, localManifest);

		return {
			manifest: mergedManifest,
			fromCache,
		};
	}

	/**
	 * Fetch a single document. Matches renderer-side `marketplace:getDocument`
	 * success-path reply 1:1.
	 */
	async getDocument(playbookPath: string, filename: string): Promise<GetDocumentResponse> {
		const content = await this.fetchDocument(playbookPath, filename);
		return { content };
	}

	/**
	 * Fetch README for a playbook. Matches renderer-side `marketplace:getReadme`
	 * success-path reply 1:1 (`content` is `string | null`).
	 */
	async getReadme(playbookPath: string): Promise<GetReadmeResponse> {
		const content = await this.fetchReadme(playbookPath);
		return { content };
	}

	/**
	 * Import a playbook to the headless Auto Run folder.
	 *
	 * Mirrors the renderer-side `marketplace:importPlaybook` success-path
	 * reply 1:1 (`{ playbook, importedDocs, importedAssets }`). SSH-remote
	 * imports are explicitly NOT supported in this headless port — passing
	 * `sshRemoteId` throws `MarketplaceImportError`. See header note #5.
	 */
	async importPlaybook(
		playbookId: string,
		targetFolderName: string,
		autoRunFolderPath: string,
		sessionId: string,
		sshRemoteId?: string
	): Promise<ImportPlaybookResponse> {
		if (sshRemoteId) {
			throw new MarketplaceImportError(
				'SSH-remote playbook imports are not supported from the headless server; perform the import from the Electron app instead.'
			);
		}

		console.log(`${LOG_CONTEXT} Importing playbook "${playbookId}" to "${targetFolderName}"`);

		const cache = await this.readCache();
		let officialManifest: MarketplaceManifest | null = null;
		if (cache && this.isCacheValid(cache)) {
			officialManifest = cache.manifest;
		} else {
			try {
				officialManifest = await this.fetchManifest();
				await this.writeCache(officialManifest);
			} catch (error) {
				console.warn(
					`${LOG_CONTEXT} Failed to fetch official manifest during import, continuing with local only`
				);
			}
		}

		const localManifest = await this.readLocalManifest();
		const manifest = mergeManifests(officialManifest, localManifest);
		const marketplacePlaybook = manifest.playbooks.find((p) => p.id === playbookId);
		if (!marketplacePlaybook) {
			throw new MarketplaceImportError(`Playbook not found: ${playbookId}`);
		}

		const targetPath = path.join(autoRunFolderPath, targetFolderName);
		await fs.mkdir(targetPath, { recursive: true });

		const importedDocs: string[] = [];
		for (const doc of marketplacePlaybook.documents) {
			try {
				const content = await this.fetchDocument(marketplacePlaybook.path, doc.filename);
				const docPath = path.join(targetPath, `${doc.filename}.md`);
				await fs.writeFile(docPath, content, 'utf-8');
				importedDocs.push(doc.filename);
			} catch (error) {
				console.warn(`${LOG_CONTEXT} Failed to import document ${doc.filename}`);
			}
		}

		// Asset discovery: local filesystem playbooks union manifest +
		// discovered assets; remote playbooks use manifest only. Matches
		// renderer-side semantics 1:1.
		const manifestAssets = marketplacePlaybook.assets ?? [];
		let effectiveAssets = manifestAssets;
		if (isLocalPath(marketplacePlaybook.path)) {
			const discoveredAssets: string[] = [];
			const resolvedPlaybookPath = resolveTildePath(marketplacePlaybook.path);
			const localAssetsPath = path.join(resolvedPlaybookPath, 'assets');
			try {
				const entries = await fs.readdir(localAssetsPath);
				for (const entry of entries) {
					try {
						const stat = await fs.stat(path.join(localAssetsPath, entry));
						if (stat.isFile()) discoveredAssets.push(entry);
					} catch {
						/* ignore */
					}
				}
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
					console.warn(`${LOG_CONTEXT} Failed to read local assets directory: ${localAssetsPath}`);
				}
			}
			effectiveAssets = Array.from(new Set([...manifestAssets, ...discoveredAssets]));
		}

		const importedAssets: string[] = [];
		if (effectiveAssets.length > 0) {
			const assetsPath = path.join(targetPath, 'assets');
			await fs.mkdir(assetsPath, { recursive: true });
			for (const assetFilename of effectiveAssets) {
				try {
					const content = await this.fetchAsset(marketplacePlaybook.path, assetFilename);
					await fs.writeFile(path.join(assetsPath, assetFilename), content);
					importedAssets.push(assetFilename);
				} catch (error) {
					console.warn(`${LOG_CONTEXT} Failed to import asset ${assetFilename}`);
				}
			}
		}

		const now = Date.now();
		const newPlaybook = {
			id: crypto.randomUUID(),
			name: marketplacePlaybook.title,
			createdAt: now,
			updatedAt: now,
			documents: marketplacePlaybook.documents.map((d) => ({
				filename: targetFolderName ? `${targetFolderName}/${d.filename}` : d.filename,
				resetOnCompletion: d.resetOnCompletion,
			})),
			loopEnabled: marketplacePlaybook.loopEnabled,
			maxLoops: marketplacePlaybook.maxLoops,
			prompt: marketplacePlaybook.prompt ?? '',
		};

		// Persist the imported playbook to the headless playbooks store.
		// On-disk shape matches the renderer-side handler: a single JSON file
		// per session under `<dataDir>/playbooks/<sessionId>.json` with a
		// top-level `{ playbooks: [...] }` envelope. An Electron-written
		// playbooks dir is forward-compatible.
		const playbooksDir = path.join(this.dataDir, 'playbooks');
		await fs.mkdir(playbooksDir, { recursive: true });
		const playbooksFilePath = path.join(playbooksDir, `${sessionId}.json`);
		let playbooks: any[] = [];
		try {
			const content = await fs.readFile(playbooksFilePath, 'utf-8');
			const data = JSON.parse(content);
			playbooks = Array.isArray(data.playbooks) ? data.playbooks : [];
		} catch {
			/* file doesn't exist or invalid — start fresh */
		}
		playbooks.push(newPlaybook);
		await fs.writeFile(playbooksFilePath, JSON.stringify({ playbooks }, null, 2), 'utf-8');

		console.log(
			`${LOG_CONTEXT} Imported "${marketplacePlaybook.title}" — ${importedDocs.length} docs, ${importedAssets.length} assets`
		);

		return {
			playbook: newPlaybook,
			importedDocs,
			importedAssets,
		};
	}
}

/* ============ Singleton accessor for the headless server ============ */

let marketplaceManager: MarketplaceManager | null = null;

/**
 * Get-or-create the singleton MarketplaceManager for the headless server.
 *
 * Mirrors the `getWakaTimeManager` / `getStatsManager` / `getFontsManager`
 * patterns: the first call must supply `dataDir` + `settingsStore`;
 * subsequent calls return the cached instance regardless of arguments.
 * Test helper `_resetMarketplaceManager()` clears the singleton.
 */
export function getMarketplaceManager(
	dataDir?: string,
	settingsStore?: MarketplaceSettingsReader
): MarketplaceManager {
	if (!marketplaceManager) {
		if (!dataDir || !settingsStore) {
			throw new Error(
				'[Marketplace] getMarketplaceManager() called before initialization. The first call must supply dataDir and settingsStore.'
			);
		}
		marketplaceManager = new MarketplaceManager(dataDir, settingsStore);
	}
	return marketplaceManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetMarketplaceManager(): void {
	if (marketplaceManager) {
		marketplaceManager.shutdown();
	}
	marketplaceManager = null;
}
