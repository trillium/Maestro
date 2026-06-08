/**
 * useSettings — webFull settings hook backed by REST
 *
 * Layer 3.1 — Settings General-tab port. This hook is the webfull-native
 * replacement for `src/renderer/hooks/settings/useSettings.ts`, which is a
 * Zustand-backed thin adapter over `settingsStore.ts` that mutates state
 * via `window.maestro.settings.set('key', value)` IPC calls.
 *
 * webFull design:
 * - Fetches the full settings object once on mount via `GET /api/settings`.
 * - Mutations call `setSetting(key, value)` which optimistically updates
 *   local state and PATCHes the server (`PATCH /api/settings` with
 *   `{ patch: { key: value } }`).
 * - On server failure, the optimistic update is rolled back and `error` is
 *   set; the previous value is restored locally so the UI reflects the real
 *   server state.
 *
 * Why not Zustand: webFull has no Zustand store anywhere today (`grep
 * "zustand" src/webFull` returns nothing) and the audit (§C4) explicitly
 * recommends NOT adding it. `useState` + REST is consistent with the
 * existing webFull hook layer (`useSessions`, etc.).
 *
 * Partial-parity gaps (documented in ISA Decisions for Layer 3.1):
 * - `wakatime:checkCli`, `wakatime:validateApiKey` — client-machine-runtime
 *   concepts; the server doesn't have an equivalent today and the renderer's
 *   WakaTime detection runs in the Electron renderer's local process.
 * - `sync:getDefaultPath`, `sync:getSettings`, `sync:selectSyncFolder`,
 *   `sync:setCustomPath`, `sync:getCurrentStoragePath` — depend on a local
 *   filesystem dialog and a process-local sync store; web has no equivalent.
 * - `stats:getDatabaseSize`, `stats:getEarliestTimestamp`,
 *   `stats:clearOldData` — depend on the per-machine SQLite DB; subsequent
 *   layer can port these by adding `/api/stats/*` routes.
 * - `shells:detect` — surveys the local machine's installed shells; not
 *   meaningful from a browser (the browser doesn't have shells to detect).
 * - `shell.openPath` — opens a path in the OS file explorer; no browser
 *   equivalent. The renderer's "open in Finder" affordance is silently
 *   dropped in webFull.
 *
 * These are surfaced as known partial-parity gaps in ISA Decisions per the
 * Layer 3.1 brief's "reject patterns that bail out of full parity" rule.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getMaestroConfig } from '../utils/config';
import { webLogger } from '../utils/logger';

/**
 * ISC-44.global.settings_broadcast — module-level event bus for
 * `settings_changed` WS frames.
 *
 * Why a module-level bus: `useSettings()` is called by three independent
 * tab components today (GeneralTab, DisplayTab, ShortcutsTab) — each gets
 * its own state. The WS handler lives in mobile/App.tsx (a single
 * `useWebSocket()` consumer). Rather than thread a context provider from
 * mobile/App.tsx down through every tab (which would require lifting state
 * to a SettingsProvider), we publish the broadcast on a module-level bus
 * and every active `useSettings()` hook subscribes via `useEffect`.
 *
 * Side effect: `publishSettingsChanged` is also exported so the WS handler
 * wiring in App.tsx / mobile/App.tsx can dispatch without importing the
 * hook itself. Test code can call it directly to simulate broadcasts.
 */
type SettingsListener = (
	changedKeys: string[],
	newValues: Record<string, unknown>,
	timestamp: number
) => void;

const settingsListeners: Set<SettingsListener> = new Set();

/**
 * Publish a `settings_changed` event. Called from the WS handler wiring in
 * App.tsx / mobile/App.tsx (after the `onSettingsChanged` handler fires)
 * and directly from parity/contract tests.
 */
export function publishSettingsChanged(
	changedKeys: string[],
	newValues: Record<string, unknown>,
	timestamp: number = Date.now()
): void {
	for (const listener of settingsListeners) {
		try {
			listener(changedKeys, newValues, timestamp);
		} catch (err) {
			webLogger.error(
				`publishSettingsChanged listener threw: ${String(err)}`,
				'useSettings'
			);
		}
	}
}

/**
 * Subscribe a listener. Returns the unsubscribe function. Exposed for tests
 * that want to assert listener registration; production callers use the
 * hook's internal `useEffect`-based subscription.
 */
export function subscribeSettingsChanged(listener: SettingsListener): () => void {
	settingsListeners.add(listener);
	return () => {
		settingsListeners.delete(listener);
	};
}

/**
 * Test helper — reset the listener set. Not used in prod.
 */
export function _resetSettingsListeners(): void {
	settingsListeners.clear();
}

/**
 * Generic settings shape — flat key/value map. The exact shape is whatever
 * lives in `~/.config/maestro/maestro-settings.json` (or the Electron equivalent).
 * Consumers narrow the field types at the call site.
 */
export type Settings = Record<string, unknown>;

export interface UseSettingsReturn {
	/** Current cached settings. Empty object until the initial fetch resolves. */
	settings: Settings;
	/** True while the initial GET is in flight. */
	loading: boolean;
	/** Last error from a GET or PATCH, or null. */
	error: string | null;
	/**
	 * Mutate a single setting. Optimistically updates the local cache and
	 * PATCHes the server. On failure, rolls back the optimistic update and
	 * surfaces the error via the `error` field.
	 */
	setSetting: <T = unknown>(key: string, value: T) => Promise<void>;
	/** Force a re-fetch from the server (e.g. after a known server-side change). */
	refresh: () => Promise<void>;
}

/**
 * Build the API base path with the security token prefix.
 */
function buildApiBase(): string {
	const config = getMaestroConfig();
	return `${window.location.origin}/${config.securityToken}/api`;
}

/**
 * Hook: useSettings — fetch + mutate Maestro settings over REST.
 */
export function useSettings(): UseSettingsReturn {
	const [settings, setSettings] = useState<Settings>({});
	const [loading, setLoading] = useState<boolean>(true);
	const [error, setError] = useState<string | null>(null);
	const apiBaseRef = useRef<string>(buildApiBase());

	const fetchSettings = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const res = await fetch(`${apiBaseRef.current}/settings`);
			if (!res.ok) {
				throw new Error(`GET /api/settings → ${res.status}`);
			}
			const json = (await res.json()) as { settings: Settings };
			setSettings(json.settings ?? {});
		} catch (e: any) {
			const msg = e?.message || 'Failed to load settings';
			webLogger.error(`useSettings: ${msg}`, 'useSettings');
			setError(msg);
		} finally {
			setLoading(false);
		}
	}, []);

	// Initial load
	useEffect(() => {
		void fetchSettings();
	}, [fetchSettings]);

	// ISC-44.global.settings_broadcast — subscribe to server-pushed changes.
	// Last-writer-wins per ISA Principle 2: the broadcast carries the
	// authoritative value (the on-disk state after the PATCH), so we
	// overwrite local state for every changed key. If this client was
	// mid-edit on a key when the broadcast arrives, its in-flight value
	// is replaced — the next PATCH from this client will re-apply the
	// edit and win the race.
	useEffect(() => {
		const unsubscribe = subscribeSettingsChanged((changedKeys, newValues) => {
			setSettings((prev) => {
				const next = { ...prev };
				for (const key of changedKeys) {
					if (key in newValues) {
						next[key] = newValues[key];
					}
				}
				return next;
			});
		});
		return unsubscribe;
	}, []);

	const setSetting = useCallback(
		async <T = unknown>(key: string, value: T): Promise<void> => {
			// Snapshot for rollback
			let previous: unknown;
			setSettings((prev) => {
				previous = prev[key];
				return { ...prev, [key]: value };
			});

			try {
				const res = await fetch(`${apiBaseRef.current}/settings`, {
					method: 'PATCH',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ patch: { [key]: value } }),
				});
				if (!res.ok) {
					throw new Error(`PATCH /api/settings → ${res.status}`);
				}
				const json = (await res.json()) as { settings: Settings };
				// Server returns the full settings — adopt as source of truth
				setSettings(json.settings ?? {});
				setError(null);
			} catch (e: any) {
				const msg = e?.message || 'Failed to save setting';
				webLogger.error(`useSettings.setSetting(${key}): ${msg}`, 'useSettings');
				setError(msg);
				// Roll back
				setSettings((prev) => ({ ...prev, [key]: previous }));
			}
		},
		[]
	);

	return {
		settings,
		loading,
		error,
		setSetting,
		refresh: fetchSettings,
	};
}

export default useSettings;
