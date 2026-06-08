/**
 * useMarketplace — webFull marketplace hook backed by REST + SSE
 *
 * webFull-native replacement for `src/renderer/hooks/batch/useMarketplace.ts`.
 * The renderer version reaches into seven `window.maestro.marketplace.*` IPC
 * sites plus one `onManifestChanged` event subscription. This webFull port
 * is the transitive consumer the original W3-marketplace audit corrected for
 * (see ISC-44.shim.w3_marketplace_routes Decision 2026-06-08): the IPC-shim
 * Decision's modal-file grep undercounted because it stopped at the modal
 * source and did not enumerate transitive hook consumers. This port closes
 * the gap for the webFull side — every IPC site is replaced with a
 * `fetch('/api/marketplace/...')` call against the W3-marketplace REST
 * cluster (commit `a44e29a04` on origin/main).
 *
 * ## Return-shape parity
 *
 * Mirrors `UseMarketplaceReturn` from the renderer source field-for-field:
 * - Data — `manifest`, `playbooks`, `categories`
 * - Loading — `isLoading`, `isRefreshing`, `isImporting`
 * - Cache — `fromCache`, `cacheAge`
 * - Error — `error`
 * - Filter — `selectedCategory`, `searchQuery`, `filteredPlaybooks`,
 *   `setSelectedCategory`, `setSearchQuery`
 * - Actions — `refresh`, `importPlaybook`
 * - Document preview — `fetchReadme`, `fetchDocument`
 *
 * The call-shape of `importPlaybook(playbook, targetFolderName,
 * autoRunFolderPath, sessionId, sshRemoteId?)` is preserved so the
 * MarketplaceModal lift can use the hook without any signature changes at
 * the call site.
 *
 * ## IPC site → REST route mapping
 *
 *   getManifest()             → GET  /api/marketplace/manifest
 *   refreshManifest()         → POST /api/marketplace/refresh
 *   importPlaybook(...)       → POST /api/marketplace/import
 *   getReadme(playbookPath)   → GET  /api/marketplace/readme?path=...
 *   getDocument(path, fname)  → GET  /api/marketplace/document?path=...&filename=...
 *   onManifestChanged(cb)     → new EventSource('/api/marketplace/manifest/events')
 *                                 + addEventListener('message', ...)
 *
 * ## Auth threading
 *
 * Uses `buildApiUrl()` from `'../utils/config'` — the same mechanism that
 * `useSettings()` documents at its `buildApiBase()` helper. This pulls the
 * server-injected security token from `window.__MAESTRO_CONFIG__` (set by
 * the headless server when serving the webFull bundle) and prefixes it as
 * `/${token}/api/...`. EventSource takes the same prefix.
 *
 * ## SSE manifest/events stream
 *
 * The renderer's `onManifestChanged(cb)` resolves to an
 * `ipcMain.handle('marketplace:onManifestChanged', ...)` channel that emits
 * `webContents.send('marketplace:manifestChanged')` whenever
 * `<dataDir>/local-manifest.json` is touched. The W3-marketplace server-side
 * port replaces that with an SSE stream at
 * `GET /api/marketplace/manifest/events` (see
 * `src/main/web-server/routes/apiRoutes.ts:1979`). The stream emits
 * `data: {"type":"manifestChanged","timestamp":<ms>}` frames; this hook
 * subscribes via `EventSource` and re-fetches the manifest on every
 * non-keepalive frame, mirroring the renderer's "reload on every change"
 * semantics.
 *
 * EventSource auto-reconnects on transient network errors per the WHATWG
 * spec — no custom backoff needed here.
 *
 * ## Pure browser runtime
 *
 * Zero `window.maestro.*` reads, zero `electron`/`ipcRenderer` imports,
 * zero module-load side effects. `grep "window.maestro\|electron\|ipcRenderer"
 * src/webFull/hooks/useMarketplace.ts` returns zero hits — the only
 * window-touching APIs are `fetch` and `EventSource`, both standard
 * browser-runtime surfaces.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MarketplaceManifest, MarketplacePlaybook } from '../../shared/marketplace-types';
import { buildApiUrl } from '../utils/config';
import { webLogger } from '../utils/logger';

/**
 * Return type — mirrors `UseMarketplaceReturn` from
 * `src/renderer/hooks/batch/useMarketplace.ts` field-for-field.
 */
export interface UseMarketplaceReturn {
	// Data
	manifest: MarketplaceManifest | null;
	playbooks: MarketplacePlaybook[];
	categories: string[];

	// Loading states
	isLoading: boolean;
	isRefreshing: boolean;
	isImporting: boolean;

	// Cache info
	fromCache: boolean;
	cacheAge: number | null;

	// Error state
	error: string | null;

	// Filter state
	selectedCategory: string;
	searchQuery: string;
	filteredPlaybooks: MarketplacePlaybook[];

	// Actions
	setSelectedCategory: (category: string) => void;
	setSearchQuery: (query: string) => void;
	refresh: () => Promise<void>;
	importPlaybook: (
		playbook: MarketplacePlaybook,
		targetFolderName: string,
		autoRunFolderPath: string,
		sessionId: string,
		sshRemoteId?: string
	) => Promise<{ success: boolean; error?: string }>;

	// Document preview
	fetchReadme: (playbookPath: string) => Promise<string | null>;
	fetchDocument: (playbookPath: string, filename: string) => Promise<string | null>;
}

/**
 * Shape of the `GET /api/marketplace/manifest` reply.
 * Matches the renderer-side `marketplace:getManifest` success reply 1:1,
 * plus the route layer's `timestamp` field.
 */
interface ManifestReply {
	success?: boolean;
	manifest?: MarketplaceManifest;
	fromCache?: boolean;
	cacheAge?: number;
	error?: string;
	timestamp?: number;
}

interface ReadmeReply {
	success?: boolean;
	content?: string | null;
	error?: string;
	timestamp?: number;
}

interface DocumentReply {
	success?: boolean;
	content?: string;
	error?: string;
	timestamp?: number;
}

interface ImportReply {
	success?: boolean;
	error?: string;
	timestamp?: number;
}

/**
 * Hook: useMarketplace — fetch + SSE-driven marketplace state for webFull.
 */
export function useMarketplace(): UseMarketplaceReturn {
	// Data state
	const [manifest, setManifest] = useState<MarketplaceManifest | null>(null);
	const [fromCache, setFromCache] = useState<boolean>(false);
	const [cacheAge, setCacheAge] = useState<number | null>(null);

	// Loading states
	const [isLoading, setIsLoading] = useState<boolean>(true);
	const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
	const [isImporting, setIsImporting] = useState<boolean>(false);

	// Error state
	const [error, setError] = useState<string | null>(null);

	// Filter state
	const [selectedCategory, setSelectedCategory] = useState<string>('All');
	const [searchQuery, setSearchQuery] = useState<string>('');

	// Pin the manifest endpoint once per mount so we don't rebuild it on
	// every render. `buildApiUrl` reads `window.__MAESTRO_CONFIG__` which is
	// stable for the lifetime of the bundle, so caching is safe.
	const manifestUrlRef = useRef<string>(buildApiUrl('/marketplace/manifest'));
	const refreshUrlRef = useRef<string>(buildApiUrl('/marketplace/refresh'));
	const importUrlRef = useRef<string>(buildApiUrl('/marketplace/import'));
	const readmeUrlRef = useRef<string>(buildApiUrl('/marketplace/readme'));
	const documentUrlRef = useRef<string>(buildApiUrl('/marketplace/document'));
	const eventsUrlRef = useRef<string>(buildApiUrl('/marketplace/manifest/events'));

	/**
	 * Internal helper — re-fetch the manifest and update local state. Used
	 * by the initial mount effect AND by the SSE manifest-changed listener.
	 */
	const loadManifest = useCallback(async () => {
		setError(null);
		try {
			const res = await fetch(manifestUrlRef.current);
			if (!res.ok) {
				throw new Error(`GET /api/marketplace/manifest → ${res.status}`);
			}
			const json = (await res.json()) as ManifestReply;
			if (json.success && json.manifest) {
				setManifest(json.manifest);
				setFromCache(json.fromCache ?? false);
				setCacheAge(json.cacheAge ?? null);
			} else if (json.success === false) {
				setError(json.error || 'Failed to load marketplace data');
			}
		} catch (e: any) {
			const msg = e?.message || 'Failed to load marketplace data';
			webLogger.error(`useMarketplace.loadManifest: ${msg}`, 'useMarketplace');
			setError('Failed to load marketplace data');
		}
	}, []);

	// Initial load on mount
	useEffect(() => {
		let cancelled = false;
		const run = async () => {
			setIsLoading(true);
			await loadManifest();
			if (!cancelled) setIsLoading(false);
		};
		void run();
		return () => {
			cancelled = true;
		};
	}, [loadManifest]);

	// SSE — listen for manifest changes (local-manifest.json edits debounced
	// server-side; emits one `manifestChanged` data frame per logical change).
	// Mirrors the renderer's `window.maestro.marketplace.onManifestChanged(cb)`
	// semantics: re-fetch the manifest whenever a change frame arrives.
	useEffect(() => {
		// Some test/non-browser environments may not provide EventSource.
		// Guard so the hook still mounts (the SSE branch is a hot-reload
		// nicety, not load-bearing for first paint).
		if (typeof EventSource === 'undefined') return;

		let es: EventSource;
		try {
			es = new EventSource(eventsUrlRef.current);
		} catch (e: any) {
			webLogger.warn(
				`useMarketplace SSE construction failed: ${String(e?.message ?? e)}`,
				'useMarketplace'
			);
			return;
		}

		const onMessage = (ev: MessageEvent) => {
			// Skip keepalive comment frames (those don't fire onmessage at all
			// per the WHATWG spec — comments are only visible at the raw level)
			// — and ignore frames that don't parse as our payload shape.
			let payload: { type?: string; timestamp?: number } | null = null;
			try {
				payload = JSON.parse(ev.data) as { type?: string; timestamp?: number };
			} catch {
				return;
			}
			if (!payload || payload.type !== 'manifestChanged') return;
			void loadManifest();
		};

		es.addEventListener('message', onMessage);

		return () => {
			es.removeEventListener('message', onMessage);
			es.close();
		};
	}, [loadManifest]);

	// Derived: playbook list extracted from the manifest.
	const playbooks = useMemo(() => manifest?.playbooks ?? [], [manifest]);

	// Derived: unique categories with 'All' pinned at index 0.
	const categories = useMemo(() => {
		if (!manifest) return ['All'];
		const cats = new Set(manifest.playbooks.map((p) => p.category));
		return ['All', ...Array.from(cats).sort()];
	}, [manifest]);

	// Derived: playbooks filtered by category + search query.
	const filteredPlaybooks = useMemo(() => {
		if (!manifest) return [];

		let filtered = manifest.playbooks;

		if (selectedCategory !== 'All') {
			filtered = filtered.filter((p) => p.category === selectedCategory);
		}

		if (searchQuery.trim()) {
			const query = searchQuery.trim().toLowerCase();
			filtered = filtered.filter(
				(p) =>
					p.title.toLowerCase().includes(query) ||
					p.description.toLowerCase().includes(query) ||
					(p.tags && p.tags.some((t) => t.toLowerCase().includes(query)))
			);
		}

		return filtered;
	}, [manifest, selectedCategory, searchQuery]);

	// Refresh — bypasses cache, force-fetches the manifest from origin.
	const refresh = useCallback(async () => {
		setIsRefreshing(true);
		setError(null);
		try {
			const res = await fetch(refreshUrlRef.current, { method: 'POST' });
			if (!res.ok) {
				throw new Error(`POST /api/marketplace/refresh → ${res.status}`);
			}
			const json = (await res.json()) as ManifestReply;
			if (json.success && json.manifest) {
				setManifest(json.manifest);
				setFromCache(false);
				setCacheAge(0);
			} else if (json.success === false) {
				setError(json.error || 'Failed to refresh marketplace data');
			}
		} catch (e: any) {
			const msg = e?.message || 'Failed to refresh marketplace data';
			webLogger.error(`useMarketplace.refresh: ${msg}`, 'useMarketplace');
			setError('Failed to refresh marketplace data');
		} finally {
			setIsRefreshing(false);
		}
	}, []);

	// Import a playbook into the Auto Run folder. SSH remote support is
	// passed through to the server, which 500s if `sshRemoteId` is non-empty
	// because the headless port deliberately omits remote-fs (see the
	// W3-marketplace route docstring at apiRoutes.ts:1884). The hook
	// surface preserves the same shape as the renderer's so the call site
	// in MarketplaceModal doesn't have to branch.
	const importPlaybook = useCallback(
		async (
			playbook: MarketplacePlaybook,
			targetFolderName: string,
			autoRunFolderPath: string,
			sessionId: string,
			sshRemoteId?: string
		): Promise<{ success: boolean; error?: string }> => {
			setIsImporting(true);
			try {
				const res = await fetch(importUrlRef.current, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						playbookId: playbook.id,
						targetFolderName,
						autoRunFolderPath,
						sessionId,
						sshRemoteId,
					}),
				});
				if (!res.ok) {
					// 4xx/5xx — try to read the route's structured error if
					// available, otherwise synthesize a generic message.
					let routeError: string | undefined;
					try {
						const json = (await res.json()) as { message?: string; error?: string };
						routeError = json.message || json.error;
					} catch {
						/* fall through */
					}
					return {
						success: false,
						error: routeError || `Import failed (HTTP ${res.status})`,
					};
				}
				const json = (await res.json()) as ImportReply;
				return {
					success: json.success ?? false,
					error: json.error,
				};
			} catch (e: any) {
				webLogger.error(
					`useMarketplace.importPlaybook: ${String(e?.message ?? e)}`,
					'useMarketplace'
				);
				return { success: false, error: 'Import failed' };
			} finally {
				setIsImporting(false);
			}
		},
		[]
	);

	// Fetch README.md content for a playbook path.
	const fetchReadme = useCallback(async (playbookPath: string): Promise<string | null> => {
		try {
			const url = `${readmeUrlRef.current}?path=${encodeURIComponent(playbookPath)}`;
			const res = await fetch(url);
			if (!res.ok) return null;
			const json = (await res.json()) as ReadmeReply;
			if (json.success) {
				return json.content ?? null;
			}
			return null;
		} catch (e: any) {
			webLogger.error(`useMarketplace.fetchReadme: ${String(e?.message ?? e)}`, 'useMarketplace');
			return null;
		}
	}, []);

	// Fetch a single document by filename for a playbook path.
	const fetchDocument = useCallback(
		async (playbookPath: string, filename: string): Promise<string | null> => {
			try {
				const url = `${documentUrlRef.current}?path=${encodeURIComponent(
					playbookPath
				)}&filename=${encodeURIComponent(filename)}`;
				const res = await fetch(url);
				if (!res.ok) return null;
				const json = (await res.json()) as DocumentReply;
				if (json.success) {
					return json.content ?? null;
				}
				return null;
			} catch (e: any) {
				webLogger.error(
					`useMarketplace.fetchDocument: ${String(e?.message ?? e)}`,
					'useMarketplace'
				);
				return null;
			}
		},
		[]
	);

	return {
		// Data
		manifest,
		playbooks,
		categories,

		// Loading states
		isLoading,
		isRefreshing,
		isImporting,

		// Cache info
		fromCache,
		cacheAge,

		// Error state
		error,

		// Filter state
		selectedCategory,
		searchQuery,
		filteredPlaybooks,

		// Actions
		setSelectedCategory,
		setSearchQuery,
		refresh,
		importPlaybook,

		// Document preview
		fetchReadme,
		fetchDocument,
	};
}

export default useMarketplace;
