/**
 * API Routes for Web Server
 *
 * This module contains all REST API route handlers extracted from web-server.ts.
 * Routes are under /$TOKEN/api/* and handle session data, theme, history, and commands.
 *
 * API Endpoints:
 * - GET /api/sessions - List all sessions with live info
 * - GET /api/session/:id - Get single session detail
 * - POST /api/session/:id/send - Send command to session
 * - GET /api/theme - Get current theme
 * - POST /api/session/:id/interrupt - Interrupt session
 * - GET /api/history - Get history entries
 * - GET /api/settings - Get all settings (Layer 3.1 — Settings General tab port)
 * - PATCH /api/settings - Persist partial settings updates (Layer 3.1)
 */

import { FastifyInstance } from 'fastify';
import { HistoryEntry } from '../../../shared/types';
import { logger } from '../../utils/logger';
import type { Theme, SessionData, SessionDetail, LiveSessionInfo, RateLimitConfig } from '../types';
import { FileStore } from '../../../shared/file-store';
import { getDataDir } from '../../../shared/data-dir';

// Re-export types for backwards compatibility
export type {
	Theme,
	SessionUsageStats,
	LastResponsePreview,
	AITabData,
	SessionData,
	SessionDetail,
	LiveSessionInfo,
	RateLimitConfig,
} from '../types';

// Logger context for all API route logs
const LOG_CONTEXT = 'WebServer:API';

/**
 * Callbacks required by API routes
 */
export interface ApiRouteCallbacks {
	getSessions: () => SessionData[];
	getSessionDetail: (sessionId: string, tabId?: string) => SessionDetail | null;
	getTheme: () => Theme | null;
	writeToSession: (sessionId: string, data: string) => boolean;
	interruptSession: (sessionId: string) => Promise<boolean>;
	getHistory: (projectPath?: string, sessionId?: string) => HistoryEntry[];
	getLiveSessionInfo: (sessionId: string) => LiveSessionInfo | undefined;
	isSessionLive: (sessionId: string) => boolean;
	/**
	 * ISC-44.global.settings_broadcast — invoked AFTER the SettingsProvider
	 * has persisted a patch from PATCH /api/settings, BEFORE the response is
	 * returned. Optional: if undefined the PATCH route still functions, but
	 * no broadcast fires (the Electron path doesn't wire this; the headless
	 * server in `src/server/index.ts` does).
	 */
	onSettingsChanged?: (changedKeys: string[], newValues: Record<string, unknown>) => void;
}

/**
 * Settings provider registry (Layer 3.1)
 *
 * Module-level singleton so headless entrypoints (e.g. src/server/index.ts)
 * can wire settings read/write WITHOUT touching WebServer.ts. The Settings
 * General-tab port in src/webFull/ depends on this registry being populated
 * before any client request arrives; if it's not, the new routes return 503
 * cleanly and the Electron path is unaffected.
 *
 * Design rationale: WebServer's existing callback flow is centralized through
 * its CallbackRegistry, which is constructed inside WebServer and is not
 * reachable from outside without modifying WebServer's setter surface. The
 * Layer 3.1 brief authorizes additive edits to apiRoutes.ts only — so the
 * registry lives here, and consumers import { registerSettingsProvider }.
 */
export interface SettingsProvider {
	/** Return the full settings object (flat key/value). */
	getSettings: () => Record<string, unknown>;
	/** Apply a partial patch and return the updated full settings object. */
	setSettings: (patch: Record<string, unknown>) => Record<string, unknown>;
}

let settingsProvider: SettingsProvider | null = null;

/**
 * Register the active settings provider. Pass null to clear.
 *
 * Headless entrypoints can call this explicitly to inject a provider whose
 * read/write semantics they fully control (e.g. broadcasting on change).
 * If never called, the route handlers fall back to a default FileStore-backed
 * provider rooted at `getDataDir()` — this lets the routes work end-to-end
 * from the headless server with no extra wiring.
 *
 * The Electron path can opt out by NOT loading these routes from a context
 * that imports getDataDir; in practice, the Electron renderer uses IPC
 * directly and does not call these endpoints, so the fallback being present
 * does not affect it.
 */
export function registerSettingsProvider(provider: SettingsProvider | null): void {
	settingsProvider = provider;
}

/**
 * Default FileStore-backed provider. Lazy-instantiated on first use so the
 * file handle is not created in import-time test environments that don't
 * touch /api/settings.
 */
let defaultStore: FileStore<Record<string, unknown>> | null = null;
function getDefaultProvider(): SettingsProvider {
	if (!defaultStore) {
		defaultStore = new FileStore<Record<string, unknown>>({
			name: 'maestro-settings',
			cwd: getDataDir(),
			defaults: {},
		});
	}
	const store = defaultStore;
	return {
		getSettings: () => ({ ...(store.store as Record<string, unknown>) }),
		setSettings: (patch: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(patch)) {
				(store as any).set(k, v);
			}
			return { ...(store.store as Record<string, unknown>) };
		},
	};
}

/**
 * Internal accessor used by the route handlers. Returns the registered
 * provider if any, otherwise lazily creates a default FileStore-backed one.
 * Exposed for testing.
 */
export function getSettingsProvider(): SettingsProvider {
	return settingsProvider ?? getDefaultProvider();
}

/**
 * Test helper — clear the cached default store so a subsequent
 * getSettingsProvider() call reads fresh from disk. Not used in prod.
 */
export function _resetDefaultSettingsStore(): void {
	defaultStore = null;
}

/* ============ WakaTime provider registry (W2 — closes ISC-44.general.wakatime, server-half) ============ */
//
// Mirrors the SettingsProvider pattern above. Headless entrypoints register a
// provider backed by `src/server/wakatime-manager.ts`; the Electron path leaves
// it unset and the routes 503 cleanly. NO fallback default is constructed here:
// instantiating a WakaTimeManager requires a settingsStore + appVersion that
// only the headless boot path knows, and we explicitly do not want to drag the
// `src/server/wakatime-manager.ts` module into the renderer's import graph
// (that module includes the auto-install download path; lazy here keeps Electron
// untouched).
export interface WakaTimeProvider {
	/** Status check — `{ available, version? }`. Auto-installs the CLI if needed. */
	getStatus: () => Promise<{ available: boolean; version?: string }>;
	/** Validate an API key against the WakaTime API. Returns `{ valid }`. */
	validateKey: (key: string) => Promise<{ valid: boolean }>;
}

let wakatimeProvider: WakaTimeProvider | null = null;

/**
 * Register the active WakaTime provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * `GET /api/wakatime/status` and `POST /api/wakatime/validate-key` are wired
 * by the time the first client request arrives. Electron-host paths can ignore
 * this — the routes 503 cleanly when no provider is registered, and the
 * Electron renderer continues to use the `wakatime:*` IPC namespace directly.
 */
export function registerWakatimeProvider(provider: WakaTimeProvider | null): void {
	wakatimeProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the routes translate `null` → HTTP 503).
 * Exposed for testing.
 */
export function getWakatimeProvider(): WakaTimeProvider | null {
	return wakatimeProvider;
}

/* ============ Stats provider registry (W2 — closes ISC-44.general.stats, server-half) ============ */
//
// Mirrors the WakaTimeProvider pattern above. Headless entrypoints register a
// provider backed by `src/server/stats-manager.ts`; the Electron path leaves
// it unset and the routes 503 cleanly. NO fallback default is constructed
// here: instantiating a StatsManager opens a `better-sqlite3` connection
// against the on-disk stats DB, and the headless boot path is the only
// surface that should own that connection. The renderer's stats DB is
// opened by `src/main/stats/singleton.ts` and we explicitly do not want
// the routes here to race against it by opening a parallel handle.
export interface StatsProvider {
	/** Database file size in bytes (matches `StatsDB.getDatabaseSize()`). */
	getDbSize: () => number;
	/**
	 * Earliest timestamp across all stats tables as an ISO-8601 string, or
	 * `null` if the DB is empty. The renderer-side IPC returns raw ms; the
	 * REST surface returns ISO because the only consumer (Settings General
	 * tab) displays it as a date string.
	 */
	getEarliestTimestamp: () => string | null;
	/** Summary aggregate for the Settings General-tab panel. */
	getSummary: () => {
		dbSize: number;
		earliestTimestamp: string | null;
		sessionCount: number;
		queryCount: number;
		autoRunSessionCount: number;
	};
	/**
	 * Delete data older than `olderThanDays`. Mirrors the renderer-side
	 * `stats:clear-old-data` IPC return shape.
	 */
	clearOldData: (olderThanDays: number) => {
		success: boolean;
		deletedQueryEvents: number;
		deletedAutoRunSessions: number;
		deletedAutoRunTasks: number;
		deletedSessionLifecycle: number;
		error?: string;
	};
	/** Get aggregated dashboard stats for a time range. */
	getAggregation: (range: string) => unknown;
	/** Get query events for a time range. */
	getQueryEvents: (range: string) => unknown;
	/** Get session lifecycle events for a time range. */
	getSessionLifecycle: (range: string) => unknown;
}

let statsProvider: StatsProvider | null = null;

/**
 * Register the active stats provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * the `/api/stats/*` routes are wired by the time the first client request
 * arrives. Electron-host paths can ignore this — the routes 503 cleanly when
 * no provider is registered, and the Electron renderer continues to use the
 * `stats:*` IPC namespace directly.
 */
export function registerStatsProvider(provider: StatsProvider | null): void {
	statsProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the routes translate `null` → HTTP 503).
 * Exposed for testing.
 */
export function getStatsProvider(): StatsProvider | null {
	return statsProvider;
}

/* ============ Fonts provider registry (W2 — closes ISC-44.display.font_family, server-half) ============ */
//
// Mirrors the WakaTimeProvider / StatsProvider patterns above. Headless
// entrypoints register a provider backed by `src/server/fonts-manager.ts`;
// the Electron path leaves it unset and the route 503s cleanly. NO fallback
// default is constructed here: the FontsManager is cheap to instantiate (no
// network, no DB handle), but keeping the registry symmetrical with the
// prior W2 ports preserves the single-owner invariant — the headless boot
// path is the only legitimate registrant. The renderer-side `fonts:detect`
// IPC handler in `src/main/ipc/handlers/system.ts` continues to own the
// font-detection surface inside Electron, and the routes here do NOT touch
// it. Both stacks can run side-by-side because the underlying `fc-list`
// binary is the cross-mode contract.
export interface FontsProvider {
	/**
	 * Detect available font families on the host. Returns a deduplicated,
	 * non-empty array of font family names (never throws — falls back to a
	 * small monospace list when `fc-list` is unavailable). Mirrors the
	 * renderer-side `fonts:detect` IPC reply shape (`string[]`).
	 */
	detectFonts: () => Promise<string[]>;
}

let fontsProvider: FontsProvider | null = null;

/**
 * Register the active Fonts provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * `GET /api/fonts/detected` is wired by the time the first client request
 * arrives. Electron-host paths can ignore this — the route 503s cleanly when
 * no provider is registered, and the Electron renderer continues to use the
 * `fonts:detect` IPC channel directly.
 */
export function registerFontsProvider(provider: FontsProvider | null): void {
	fontsProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the route translates `null` → HTTP 503).
 * Exposed for testing.
 */
export function getFontsProvider(): FontsProvider | null {
	return fontsProvider;
}

/**
 * API Routes Class
 *
 * Encapsulates all REST API route setup logic.
 * Uses dependency injection for callbacks to maintain separation from WebServer class.
 */
export class ApiRoutes {
	private callbacks: Partial<ApiRouteCallbacks> = {};
	private rateLimitConfig: RateLimitConfig;
	private securityToken: string;

	constructor(securityToken: string, rateLimitConfig: RateLimitConfig) {
		this.securityToken = securityToken;
		this.rateLimitConfig = rateLimitConfig;
	}

	/**
	 * Set the callbacks for API operations
	 */
	setCallbacks(callbacks: ApiRouteCallbacks): void {
		this.callbacks = callbacks;
	}

	/**
	 * Update rate limit configuration
	 */
	updateRateLimitConfig(config: RateLimitConfig): void {
		this.rateLimitConfig = config;
	}

	/**
	 * Register all API routes on the Fastify server
	 */
	registerRoutes(server: FastifyInstance): void {
		const token = this.securityToken;

		// Get all sessions (not just "live" ones - security token protects access)
		server.get(
			`/${token}/api/sessions`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async () => {
				const sessions = this.callbacks.getSessions ? this.callbacks.getSessions() : [];

				// Enrich all sessions with live info if available
				const sessionData = sessions.map((s) => {
					const liveInfo = this.callbacks.getLiveSessionInfo?.(s.id);
					return {
						...s,
						agentSessionId: liveInfo?.agentSessionId || s.agentSessionId,
						liveEnabledAt: liveInfo?.enabledAt,
						isLive: this.callbacks.isSessionLive?.(s.id) || false,
					};
				});

				return {
					sessions: sessionData,
					count: sessionData.length,
					timestamp: Date.now(),
				};
			}
		);

		// Session detail endpoint - works for any valid session (security token protects access)
		// Optional ?tabId= query param to fetch logs for a specific tab (avoids race conditions)
		server.get(
			`/${token}/api/session/:id`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const { id } = request.params as { id: string };
				const { tabId } = request.query as { tabId?: string };

				if (!this.callbacks.getSessionDetail) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Session detail service not configured',
						timestamp: Date.now(),
					});
				}

				const session = this.callbacks.getSessionDetail(id, tabId);
				if (!session) {
					return reply.code(404).send({
						error: 'Not Found',
						message: `Session with id '${id}' not found`,
						timestamp: Date.now(),
					});
				}

				const liveInfo = this.callbacks.getLiveSessionInfo?.(id);
				return {
					session: {
						...session,
						agentSessionId: liveInfo?.agentSessionId || session.agentSessionId,
						liveEnabledAt: liveInfo?.enabledAt,
						isLive: this.callbacks.isSessionLive?.(id) || false,
					},
					timestamp: Date.now(),
				};
			}
		);

		// Send command to session - works for any valid session (security token protects access)
		server.post(
			`/${token}/api/session/:id/send`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const { id } = request.params as { id: string };
				const body = request.body as { command?: string } | undefined;
				const command = body?.command;

				if (!command || typeof command !== 'string') {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'Command is required and must be a string',
						timestamp: Date.now(),
					});
				}

				if (!this.callbacks.writeToSession) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Session write service not configured',
						timestamp: Date.now(),
					});
				}

				const success = this.callbacks.writeToSession(id, command + '\n');
				if (!success) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: 'Failed to send command to session',
						timestamp: Date.now(),
					});
				}

				return {
					success: true,
					message: 'Command sent successfully',
					sessionId: id,
					timestamp: Date.now(),
				};
			}
		);

		// Theme endpoint
		server.get(
			`/${token}/api/theme`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				if (!this.callbacks.getTheme) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Theme service not configured',
						timestamp: Date.now(),
					});
				}

				const theme = this.callbacks.getTheme();
				if (!theme) {
					return reply.code(404).send({
						error: 'Not Found',
						message: 'No theme currently configured',
						timestamp: Date.now(),
					});
				}

				return {
					theme,
					timestamp: Date.now(),
				};
			}
		);

		// Interrupt session - works for any valid session (security token protects access)
		server.post(
			`/${token}/api/session/:id/interrupt`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const { id } = request.params as { id: string };

				if (!this.callbacks.interruptSession) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Session interrupt service not configured',
						timestamp: Date.now(),
					});
				}

				try {
					// Forward to desktop's interrupt logic - handles state updates and broadcasts
					const success = await this.callbacks.interruptSession(id);
					if (!success) {
						return reply.code(500).send({
							error: 'Internal Server Error',
							message: 'Failed to interrupt session',
							timestamp: Date.now(),
						});
					}

					return {
						success: true,
						message: 'Interrupt signal sent successfully',
						sessionId: id,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to interrupt session: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// History endpoint - returns history entries filtered by project/session
		server.get(
			`/${token}/api/history`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				if (!this.callbacks.getHistory) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'History service not configured',
						timestamp: Date.now(),
					});
				}

				// Extract optional projectPath and sessionId from query params
				const { projectPath, sessionId } = request.query as {
					projectPath?: string;
					sessionId?: string;
				};

				try {
					const entries = this.callbacks.getHistory(projectPath, sessionId);
					return {
						entries,
						count: entries.length,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to fetch history: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ Settings endpoints (Layer 3.1 — Settings General tab port) ============
		//
		// These routes are additive and rebase-safe. They short-circuit to 503 when
		// no SettingsProvider is registered (the Electron path leaves it unset; only
		// the headless vanilla-Node server at src/server/index.ts wires it via its
		// FileStore by calling registerSettingsProvider() at startup).
		//
		// Per Layer 3.1 brief: the General tab in src/webFull/ is a webfull-native
		// rewrite (NOT a renderer lift — GeneralTab.tsx is 1522 LOC across 5 IPC
		// namespaces, far over the "lift if ≤3 IPC" threshold). It reads/writes
		// through these two routes, using the same flat key/value shape that
		// electron-store / FileStore already persist on disk. No new key
		// conventions; the on-disk schema is preserved.

		// GET /api/settings — return the full settings object
		server.get(
			`/${token}/api/settings`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				try {
					const provider = getSettingsProvider();
					const settings = provider.getSettings();
					return {
						settings,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read settings: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// PATCH /api/settings — persist a partial settings update
		// Body: { patch: Record<string, unknown> }
		// Returns: { settings: Record<string, unknown>, timestamp }
		server.patch(
			`/${token}/api/settings`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const body = request.body as { patch?: Record<string, unknown> } | undefined;
				const patch = body?.patch;

				if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'patch must be a non-null object',
						timestamp: Date.now(),
					});
				}

				try {
					const provider = getSettingsProvider();
					const settings = provider.setSettings(patch);
					// ISC-44.global.settings_broadcast — fire the broadcast hook
					// AFTER persist succeeds, BEFORE we return. If persist throws
					// (caught below) the broadcast never fires, which matches
					// the parity story "PATCH fails → no broadcast → no
					// client state update".
					if (this.callbacks.onSettingsChanged) {
						try {
							this.callbacks.onSettingsChanged(Object.keys(patch), patch);
						} catch (err) {
							// Broadcast failure must NOT fail the PATCH — the
							// settings are already on disk. Log and continue.
							logger.warn(`onSettingsChanged callback threw: ${String(err)}`, LOG_CONTEXT);
						}
					}
					return {
						settings,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to persist settings: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ WakaTime endpoints (W2 — closes ISC-44.general.wakatime, server-half) ============
		//
		// Additive REST routes that mirror the renderer-side `wakatime:*` IPC
		// namespace (`wakatime:checkCli`, `wakatime:validateApiKey`). 503 when
		// no WakaTimeProvider is registered (the Electron path leaves it unset).
		// Per ISC-40 N1 legalization, additive `src/main/web-server/routes/` edits
		// are authorized. NO touch to `src/main/wakatime-manager.ts` or the
		// renderer-side IPC handlers.

		// GET /api/wakatime/status — mirrors `wakatime:checkCli` IPC reply shape
		// (`{ available: boolean, version?: string }`).
		server.get(
			`/${token}/api/wakatime/status`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getWakatimeProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'WakaTime provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const status = await provider.getStatus();
					return {
						...status,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read WakaTime status: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// POST /api/wakatime/validate-key — mirrors `wakatime:validateApiKey` IPC
		// reply shape (`{ valid: boolean }`). Body: `{ key: string }`.
		server.post(
			`/${token}/api/wakatime/validate-key`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getWakatimeProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'WakaTime provider not configured',
						timestamp: Date.now(),
					});
				}
				const body = request.body as { key?: string } | undefined;
				const key = body?.key;
				if (typeof key !== 'string') {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'key must be a string',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.validateKey(key);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to validate WakaTime key: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ Stats endpoints (W2 — closes ISC-44.general.stats, server-half) ============
		//
		// Additive REST routes that mirror the renderer-side `stats:*` IPC
		// namespace. 503 when no StatsProvider is registered (the Electron
		// path leaves it unset). Per ISC-40 N1 legalization, additive
		// `src/main/web-server/routes/` edits are authorized. NO touch to
		// `src/main/ipc/handlers/stats.ts` or `src/main/stats/`.
		//
		// Route surface (5 endpoints):
		//   GET  /api/stats/summary           — dbSize + earliestTimestamp + counts
		//   POST /api/stats/clear-old-data    — bulk delete past cutoff
		//   GET  /api/stats/aggregation       — full dashboard aggregate
		//   GET  /api/stats/query-events      — raw query events feed
		//   GET  /api/stats/session-lifecycle — session creation/closure events
		//
		// `range` query param accepts: `day|week|month|quarter|year|all`.
		// Defaults to `all` if omitted. Unknown values fall through to the
		// renderer-side `getTimeRangeStart()` default branch (returns 0 =
		// "all time").

		// GET /api/stats/summary — fast aggregate for the Settings General-tab panel.
		// Reply shape: { dbSize, earliestTimestamp, sessionCount, queryCount, autoRunSessionCount, timestamp }
		server.get(
			`/${token}/api/stats/summary`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getStatsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Stats provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const summary = provider.getSummary();
					return {
						...summary,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read stats summary: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// POST /api/stats/clear-old-data — delete rows older than N days.
		// Body: { olderThanDays: number }. Reply: { removed, deletedQueryEvents, ..., timestamp }.
		server.post(
			`/${token}/api/stats/clear-old-data`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getStatsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Stats provider not configured',
						timestamp: Date.now(),
					});
				}
				const body = request.body as { olderThanDays?: unknown } | undefined;
				const olderThanDays = body?.olderThanDays;
				if (
					typeof olderThanDays !== 'number' ||
					!Number.isFinite(olderThanDays) ||
					olderThanDays <= 0
				) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'olderThanDays must be a positive number',
						timestamp: Date.now(),
					});
				}
				try {
					const result = provider.clearOldData(olderThanDays);
					if (!result.success) {
						return reply.code(500).send({
							error: 'Internal Server Error',
							message: result.error ?? 'Failed to clear old data',
							timestamp: Date.now(),
						});
					}
					const removed =
						result.deletedQueryEvents +
						result.deletedAutoRunSessions +
						result.deletedAutoRunTasks +
						result.deletedSessionLifecycle;
					return {
						removed,
						deletedQueryEvents: result.deletedQueryEvents,
						deletedAutoRunSessions: result.deletedAutoRunSessions,
						deletedAutoRunTasks: result.deletedAutoRunTasks,
						deletedSessionLifecycle: result.deletedSessionLifecycle,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to clear old stats data: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/stats/aggregation?range=week — full dashboard aggregate.
		// Heaviest route — runs ~9 sub-queries on the stats DB. Cache-friendly
		// at the client (the dashboard polls on-demand, not on a tight loop).
		server.get(
			`/${token}/api/stats/aggregation`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getStatsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Stats provider not configured',
						timestamp: Date.now(),
					});
				}
				const { range } = request.query as { range?: string };
				const rangeValue = range ?? 'all';
				try {
					const aggregation = provider.getAggregation(rangeValue);
					return {
						aggregation,
						range: rangeValue,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to compute stats aggregation: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/stats/query-events?range=week — raw query events feed.
		server.get(
			`/${token}/api/stats/query-events`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getStatsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Stats provider not configured',
						timestamp: Date.now(),
					});
				}
				const { range } = request.query as { range?: string };
				const rangeValue = range ?? 'all';
				try {
					const events = provider.getQueryEvents(rangeValue);
					return {
						events,
						range: rangeValue,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read query events: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/stats/session-lifecycle?range=week — session creation/closure events.
		server.get(
			`/${token}/api/stats/session-lifecycle`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getStatsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Stats provider not configured',
						timestamp: Date.now(),
					});
				}
				const { range } = request.query as { range?: string };
				const rangeValue = range ?? 'all';
				try {
					const events = provider.getSessionLifecycle(rangeValue);
					return {
						events,
						range: rangeValue,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read session lifecycle: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ Fonts endpoints (W2 — closes ISC-44.display.font_family, server-half) ============
		//
		// Additive REST route that mirrors the renderer-side `fonts:detect` IPC
		// channel (one channel, one method — see `src/main/ipc/handlers/system.ts`
		// line ~120). 503 when no FontsProvider is registered (the Electron path
		// leaves it unset). Per ISC-40 N1 legalization, additive
		// `src/main/web-server/routes/` edits are authorized. NO touch to
		// `src/main/ipc/handlers/system.ts` or the renderer-side preload bridge.
		//
		// Route surface (1 endpoint):
		//   GET /api/fonts/detected — returns `{ fonts: string[], timestamp }`,
		//     the deduplicated list of available font families. The IPC channel
		//     returns the bare `string[]`; we wrap in an envelope here for parity
		//     with the rest of the `/api/*` surface (every other route returns a
		//     `timestamp`-stamped object, never a bare array). webFull clients
		//     unwrap `.fonts` from the response.

		// GET /api/fonts/detected — mirrors the `fonts:detect` IPC reply.
		server.get(
			`/${token}/api/fonts/detected`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getFontsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Fonts provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const fonts = await provider.detectFonts();
					return {
						fonts,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to detect fonts: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		logger.debug('API routes registered', LOG_CONTEXT);
	}
}
