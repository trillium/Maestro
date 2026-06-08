/**
 * settingsStore.webfull — webFull settings store wrapper.
 *
 * Audit #14 (third audit on this priority) flagged that the renderer-side
 * Electron build talks to `electron-store` via `window.maestro.settings.get`
 * / `window.maestro.settings.set` (mirrored by Zustand in
 * `src/renderer/stores/settingsStore.ts`), and that webFull lacked an
 * equivalent abstraction sitting on top of the new `/api/settings/{get,set}`
 * REST surface. `useSettings()` exists, but it returns React state; non-React
 * callers (services, utilities, future imperative code paths) had no
 * `window.maestro.settings.set`-shaped affordance to reach for.
 *
 * This module is the thin wrapper. It mirrors the subset of the Electron
 * `window.maestro.settings.*` IPC the renderer's Zustand store calls:
 *
 *   - `getAll(): Promise<Record<string, unknown>>` — full GET
 *   - `get<T>(key, defaultValue?): Promise<T>` — single-key convenience
 *   - `set<T>(key, value): Promise<Record<string, unknown>>` — single-key
 *     PATCH (returns the post-write full settings object the server sent)
 *   - `patch(partial): Promise<Record<string, unknown>>` — multi-key PATCH
 *
 * Implementation: bare `window.fetch` against `GET /api/settings` and
 * `PATCH /api/settings`, prefixed with the security token resolved from
 * `getMaestroConfig().securityToken`. Errors bubble up as `Error` objects
 * (let Sentry catch them per the project Sentry policy). Callers that need
 * optimistic-update + rollback semantics should use the React-side
 * `useSettings()` hook instead — this wrapper is "fetch and forget", same
 * posture as `window.maestro.settings.set` from the renderer side.
 *
 * Why a separate file vs. inlining into `useSettings()`: parity with the
 * renderer's `src/renderer/stores/settingsStore.ts`. Keeping the same shape
 * across both targets means the cross-fork-line audit (CLAUDE.md "Maintain
 * Scope Discipline" + the fork-hygiene memory note "Maestro fork — only
 * edit webFull, not web") has an obvious one-to-one mapping when porting
 * future settings-touching code: renderer's `useSettingsStore.getState().set*`
 * → webFull's `settingsStoreWebFull.set('key', value)`.
 *
 * Not included intentionally:
 *
 *   - **No Zustand store.** webFull does not depend on Zustand today
 *     (see `useSettings.ts` comment header §C4: "audit explicitly
 *     recommends NOT adding it"). Future work can layer Zustand on
 *     top of this wrapper if the React surface grows; the wrapper
 *     stays state-management-agnostic.
 *   - **No WS broadcast subscription.** That lives in `useSettings()`
 *     via the module-level `subscribeSettingsChanged()` event bus.
 *     Non-React callers that want fan-out can call into the same bus
 *     directly.
 *   - **No defaults table.** Renderer-side defaults live in
 *     `src/renderer/stores/settingsStore.ts`; webFull either inherits
 *     them via the server's settings file (Electron-written →
 *     headless-read parity) or the caller supplies a fallback to
 *     `get<T>(key, defaultValue)`. Mirroring the 200-key defaults
 *     here would duplicate state and drift.
 */

import { getMaestroConfig } from '../utils/config';

/**
 * The full settings object — flat key/value map. Same shape as the
 * `Record<string, unknown>` produced by the headless server's
 * `SettingsManager.getSettings()` (and by `electron-store` on disk).
 */
export type WebFullSettings = Record<string, unknown>;

/**
 * Build the `${origin}/${token}/api/settings` URL. Resolved per-call so a
 * token rotation (rare, but the server can issue one) is picked up without
 * caching the URL at module load time.
 */
function settingsUrl(): string {
	const config = getMaestroConfig();
	return `${window.location.origin}/${config.securityToken}/api/settings`;
}

/**
 * `GET /api/settings` — returns the full settings object.
 *
 * Throws on non-2xx or malformed JSON. Callers should let the exception
 * propagate (Sentry catches it via the global handler) unless they have a
 * recovery path.
 */
export async function getAllSettings(): Promise<WebFullSettings> {
	const res = await fetch(settingsUrl());
	if (!res.ok) {
		throw new Error(`GET /api/settings → ${res.status}`);
	}
	const json = (await res.json()) as { settings?: WebFullSettings };
	return json.settings ?? {};
}

/**
 * `GET /api/settings` → return a single key's value, or `defaultValue` if
 * the key is absent. The full settings object is fetched on every call —
 * intentional (matches `window.maestro.settings.get` semantics) and OK
 * because the settings file is small (sub-kilobyte in steady state).
 * Callers needing batched reads should call `getAllSettings()` once and
 * read keys off the returned object.
 */
export async function getSetting<T>(key: string, defaultValue: T): Promise<T>;
export async function getSetting<T = unknown>(key: string): Promise<T | undefined>;
export async function getSetting<T = unknown>(
	key: string,
	defaultValue?: T
): Promise<T | undefined> {
	const all = await getAllSettings();
	if (key in all) {
		return all[key] as T;
	}
	return defaultValue;
}

/**
 * `PATCH /api/settings` with a single-key patch. Returns the post-write
 * full settings object the server sent (server is authoritative; the
 * returned snapshot reflects last-writer-wins after any concurrent
 * PATCHes serialized through Fastify's request queue).
 */
export async function setSetting<T>(key: string, value: T): Promise<WebFullSettings> {
	return patchSettings({ [key]: value });
}

/**
 * `PATCH /api/settings` with a multi-key patch. Used when the caller has
 * several related keys to update atomically from the server's perspective
 * (one HTTP request, one disk write, one `settings_changed` broadcast).
 */
export async function patchSettings(patch: WebFullSettings): Promise<WebFullSettings> {
	const res = await fetch(settingsUrl(), {
		method: 'PATCH',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ patch }),
	});
	if (!res.ok) {
		throw new Error(`PATCH /api/settings → ${res.status}`);
	}
	const json = (await res.json()) as { settings?: WebFullSettings };
	return json.settings ?? {};
}

/**
 * Convenience object — bundles the four functions under a single import.
 * Mirrors the shape of `window.maestro.settings` from the Electron preload.
 * Callers can import either the named functions above or this object:
 *
 *   import { settingsStoreWebFull } from '@/webFull/stores/settingsStore.webfull';
 *   const all = await settingsStoreWebFull.getAll();
 *   await settingsStoreWebFull.set('conductorProfile', 'concise');
 */
export const settingsStoreWebFull = {
	getAll: getAllSettings,
	get: getSetting,
	set: setSetting,
	patch: patchSettings,
} as const;
