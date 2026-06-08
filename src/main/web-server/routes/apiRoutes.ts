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

import * as path from 'path';
import { FastifyInstance } from 'fastify';
import { HistoryEntry } from '../../../shared/types';
import { logger } from '../../utils/logger';
import type { Theme, SessionData, SessionDetail, LiveSessionInfo, RateLimitConfig } from '../types';
import { FileStore } from '../../../shared/file-store';
import { getDataDir } from '../../../shared/data-dir';
import type {
	MarketplaceManifest,
	GetManifestResponse,
	GetDocumentResponse,
	GetReadmeResponse,
	ImportPlaybookResponse,
} from '../../../shared/marketplace-types';

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

/* ============ Fs provider registry (W3-fs — closes ISC-44.shim.fs_routes, server-half) ============ */
//
// Mirrors the WakaTimeProvider / StatsProvider / FontsProvider patterns above.
// Headless entrypoints register a provider backed by `src/server/fs-manager.ts`;
// the Electron path leaves it unset and the routes 503 cleanly. NO fallback
// default is constructed here — the headless boot path is the only legitimate
// registrant. The renderer-side `fs:*` IPC handlers in
// `src/main/ipc/handlers/filesystem.ts` continue to own the fs surface inside
// Electron, and the routes here do NOT touch them. Both stacks can run
// side-by-side because the underlying filesystem is the cross-mode contract.
//
// Route surface (4 endpoints) per the umbrella big_3_ipc_strategy Decision:
//   GET  /api/fs/home-dir         — return server-side os.homedir()
//   GET  /api/fs/stat?path=…      — stat result + exists flag
//   GET  /api/fs/read-file?path=… — UTF-8 file contents (rejects binary)
//   POST /api/autorun/write-doc   — write content to absolute path, mkdir -p
//
// The last route lives under `/api/autorun/*` namespace by Decision (the
// AutoRun shell is the only consumer of writeDoc, and a future
// `W3-autorun` brief may extend this namespace with read-side routes for
// the doc loader) — but the underlying implementation here is the same
// FsManager.writeDoc primitive. Folding the namespace under FsProvider
// keeps the route count in one registry rather than splitting into a
// trivial AutorunProvider with one method.
export interface FsProvider {
	/** Return the server's home directory. Matches `fs:homeDir` IPC reply (`string`). */
	getHomeDir: () => string;
	/**
	 * Stat a path. Returns `{exists, isDir, isFile, size?, mtime?}` — `exists:false`
	 * for missing paths rather than throwing. Throws for permission errors etc.
	 * The route layer pre-validates the path so traversal / NUL bytes never
	 * reach this method.
	 */
	stat: (path: string) => Promise<{
		exists: boolean;
		isDir: boolean;
		isFile: boolean;
		size?: number;
		mtime?: string;
	}>;
	/**
	 * Read a file's contents as UTF-8 text. Returns `null` for ENOENT/EISDIR
	 * so the route layer surfaces a 404. Throws an error tagged with
	 * `binary: true` when the file looks like binary, so the route layer
	 * returns 400 rather than a corrupt string.
	 */
	readFile: (path: string) => Promise<string | null>;
	/**
	 * Write content to an absolute path. Creates parent dirs on demand.
	 * Returns `{path, bytes}` — byte count is UTF-8 byte length.
	 */
	writeDoc: (path: string, content: string) => Promise<{ path: string; bytes: number }>;
}

let fsProvider: FsProvider | null = null;

/**
 * Register the active Fs provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * the `/api/fs/*` + `/api/autorun/write-doc` routes are wired by the time the
 * first client request arrives. Electron-host paths can ignore this — the
 * routes 503 cleanly when no provider is registered, and the Electron
 * renderer continues to use the `fs:*` / `autorun:writeDoc` IPC channels
 * directly.
 */
export function registerFsProvider(provider: FsProvider | null): void {
	fsProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the routes translate `null` → HTTP 503).
 * Exposed for testing.
 */
export function getFsProvider(): FsProvider | null {
	return fsProvider;
}

/**
 * Validate an absolute filesystem path for cross-process use.
 *
 * Belt-and-suspenders re-implementation of the manager-side
 * `isValidFsPath()` in `src/server/fs-manager.ts`. Inlined here rather than
 * imported because the routes module deliberately avoids depending on the
 * `src/server/` tree (the Electron build does not include server-side
 * managers in its bundle graph; a route-layer import would force-import
 * the manager into both bundles). The two validators MUST stay in sync;
 * any change to one is a change to both.
 *
 * Returns `null` if the path passes all checks; otherwise returns a short
 * human-readable reason the route includes in the 400 reply body.
 */
function validateFsPath(p: unknown): string | null {
	if (typeof p !== 'string' || p.length === 0) return 'path must be a non-empty string';
	if (!path.isAbsolute(p)) return 'path must be absolute';
	if (p.includes('\0')) return 'path must not contain NUL byte';
	const segments = p.split(/[/\\]/);
	if (segments.includes('..')) return 'path must not contain `..` segments';
	if (p.includes('%2e%2e') || p.includes('%2E%2E')) {
		return 'path must not contain encoded `..` segments';
	}
	return null;
}

/* ============ Agents provider registry (W3-agents — closes ISC-44.shim.agents_routes, server-half) ============ */
//
// Mirrors the WakaTimeProvider / StatsProvider / FontsProvider / FsProvider /
// MarketplaceProvider patterns above. Headless entrypoints register a provider
// backed by `src/server/agents-manager.ts`; the Electron path leaves it unset
// and the routes 503 cleanly. NO fallback default is constructed here — the
// headless boot path is the only legitimate registrant. The renderer-side
// `agents:*` IPC handlers in `src/main/ipc/handlers/agents.ts` continue to own
// the agent surface inside Electron, and the routes here do NOT touch them.
// Both stacks can run side-by-side because the underlying binary detection
// (probe known paths + `which`/`where`) is the cross-mode contract.
//
// Route surface (3 endpoints) per the brief audit of NewInstanceModal's IPC
// sites at `src/renderer/components/NewInstanceModal.tsx`:
//   GET /api/agents/detected              — list installed agents (mirrors `agents:detect`)
//   GET /api/agents/detect/<agentId>      — fresh detection + debugInfo (mirrors `agents:refresh`)
//   GET /api/agents/capabilities/<agentId> — capabilities matrix (mirrors `agents:getCapabilities`)
//
// Out of scope (deliberately, per the umbrella big_3_ipc_strategy Decision):
//   - `agents:getConfig` / `agents:setConfig` / agent-config CRUD — needs a
//     server-side config store that doesn't yet exist. NewInstanceModal's
//     config calls (lines 284, 971, 1288, 1791) will need a follow-up brief.
//   - `agents:getModels` — local model discovery shells out to each agent's
//     `models` subcommand. NewInstanceModal lines 405, 1482 will need a
//     follow-up brief.
//   - `agents:discoverSlashCommands` — Claude Code only, expensive, no current
//     webFull consumer.
//   - SSH-remote detection via `?sshRemoteId=` — sibling sub-ISC
//     `ISC-44.shim.ssh_remotes_routes`. Returns 501 on the route layer so
//     callers don't silently get a local-host result when a remote was
//     requested (matches the W3-fs precedent).
export interface AgentsProvider {
	/**
	 * Detect all installed agents on the local host. Returns a serializable
	 * list (no function fields) of `AgentConfig`-shaped objects with
	 * `available`, `path`, `capabilities` populated. Each entry mirrors the
	 * `agents:detect` IPC reply shape after `stripAgentFunctions` runs.
	 */
	detectAgents: () => Promise<unknown[]>;
	/**
	 * Fresh detection for a specific agent id. Returns `{ agents, debugInfo }`
	 * where `agents` is the full list (same as `detectAgents()`) and
	 * `debugInfo` is non-null when the targeted agent was NOT found,
	 * populated with the env context + `which` error output for diagnostics.
	 * Mirrors the `agents:refresh` IPC reply shape at agents.ts:399-405.
	 */
	detectAgent: (agentId: string) => Promise<{
		agents: unknown[];
		debugInfo: {
			agentId: string;
			available: boolean;
			path: string | null;
			binaryName: string;
			envPath: string;
			homeDir: string;
			platform: string;
			whichCommand: string;
			error: string | null;
		} | null;
	}>;
	/**
	 * Look up the capabilities matrix for an agent id. Unknown ids return
	 * the default (all-false) matrix per `getAgentCapabilities()`'s
	 * contract.
	 */
	getCapabilities: (agentId: string) => Record<string, unknown>;
	/**
	 * Get the merged config for an agent id — `configOptions[*].default`
	 * overlaid with the stored per-agent config from the FileStore. Mirrors
	 * the `agents:getConfig` IPC reply at agents.ts:556 byte-for-byte
	 * (defaults first, stored overrides). Unknown ids return the stored
	 * config (or `{}` if none) — matches the renderer-side handler's
	 * behavior. W3-agents-writers extension.
	 */
	getConfig: (agentId: string) => Promise<Record<string, unknown>>;
	/**
	 * Overwrite the stored config for an agent id. Mirrors `agents:setConfig`
	 * at agents.ts:578 — replaces (does NOT merge) the per-agent record.
	 * Returns `true` on success to match the renderer-side handler's reply
	 * shape. W3-agents-writers extension.
	 */
	setConfig: (agentId: string, config: Record<string, unknown>) => Promise<boolean>;
	/**
	 * Discover available models for an agent id (local-only — SSH-remote
	 * dispatch is a sibling brief). Returns `[]` when the agent is not
	 * detected, when the agent does not support model selection, or when
	 * the agent has no `models` subcommand implementation. Currently only
	 * `opencode` actually shells out; other agents return `[]`. Mirrors
	 * `agents:getModels` (local path) at agents.ts:810. Cache TTL is 5
	 * minutes inside the manager; pass `forceRefresh: true` to bypass.
	 * W3-agents-writers extension.
	 */
	getModels: (agentId: string, forceRefresh?: boolean) => Promise<string[]>;
}

let agentsProvider: AgentsProvider | null = null;

/**
 * Register the active Agents provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * the `/api/agents/*` routes are wired by the time the first client request
 * arrives. Electron-host paths can ignore this — the routes 503 cleanly when
 * no provider is registered, and the Electron renderer continues to use the
 * `agents:*` IPC namespace directly.
 */
export function registerAgentsProvider(provider: AgentsProvider | null): void {
	agentsProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the routes translate `null` → HTTP 503).
 * Exposed for testing.
 */
export function getAgentsProvider(): AgentsProvider | null {
	return agentsProvider;
}

/**
 * Validate an agent id for cross-process use.
 *
 * Agent ids are short kebab-case identifiers (`claude-code`, `codex`,
 * `opencode`, `factory-droid`, `terminal`, `gemini-cli`, `qwen3-coder`,
 * `aider`). The route layer accepts the agent id as a URL path segment
 * (`/api/agents/detect/<agentId>`), so we must reject anything that could
 * contain path-traversal or shell-injection characters before forwarding
 * to the provider. The provider itself does NOT shell out the id —
 * detection uses the binary NAME from `AGENT_DEFINITIONS`, not the id —
 * but defense-in-depth: belt-and-suspenders the id at the route boundary
 * so a future consumer that DOES use the id in a shell context can't be
 * blindsided.
 *
 * Rules:
 *   - must be a non-empty string
 *   - must match `^[a-zA-Z0-9][a-zA-Z0-9_-]*$` (alphanumeric + dash/underscore,
 *     leading char alphanumeric)
 *   - max 64 characters (every defined agent id fits well under this; a
 *     longer string is almost certainly a probe attempt)
 *
 * Returns `null` if the id passes; otherwise a short reason for the 400
 * reply body.
 */
function validateAgentId(id: unknown): string | null {
	if (typeof id !== 'string' || id.length === 0) return 'agentId must be a non-empty string';
	if (id.length > 64) return 'agentId must be 64 characters or fewer';
	if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(id)) {
		return 'agentId must be alphanumeric with optional `-` / `_` (must start alphanumeric)';
	}
	return null;
}

/* ============ Marketplace provider registry (W3 — closes ISC-44.shim.w3_marketplace_routes, server-half) ============ */
//
// Mirrors the WakaTimeProvider / StatsProvider / FontsProvider patterns
// above. Headless entrypoints register a provider backed by
// `src/server/marketplace-manager.ts`; the Electron path leaves it unset
// and the routes 503 cleanly. NO fallback default is constructed here:
// instantiating a MarketplaceManager opens a `fs.watch` handle against
// `<dataDir>/local-manifest.json` and registers SSE-bound EventEmitter
// listeners, and the headless boot path is the only surface that should
// own those resources. The renderer-side `marketplace:*` IPC handlers in
// `src/main/ipc/handlers/marketplace.ts` are NOT touched.
//
// CORRECTS THE IPC-SHIM DECISION (2026-06-08 — "IPC-shim strategy for
// the big-3"): that Decision counted `MarketplaceModal.tsx`'s 5 callsites
// as the entire IPC surface and concluded "0 new routes + 1 strip-and-
// promote + 1 window.open swap." The grep was modal-file-scoped and
// missed the transitive `useMarketplace` hook
// (`src/renderer/hooks/batch/useMarketplace.ts`), which is the actual
// consumer of `window.maestro.marketplace.*` and pulls in 7 IPC sites
// plus the `onManifestChanged` event subscription — 8 surfaces total.
// Going forward, transitive hook consumers MUST be counted in Decision
// audits, not just direct modal-file callsites. See Decision entry of
// even date.
//
// Route surface (6 endpoints):
//   GET  /api/marketplace/manifest         — getManifest, served from
//                                            cache when fresh, else fetch.
//   POST /api/marketplace/refresh          — bypass cache, force fetch.
//   GET  /api/marketplace/readme           — fetch README.md for a path.
//   GET  /api/marketplace/document         — fetch a single document.
//   POST /api/marketplace/import           — write playbook to disk.
//   GET  /api/marketplace/manifest/events  — SSE; emits `manifestChanged`
//                                            on local-manifest.json edits.
//
// The SSE route uses Fastify's `reply.raw` escape hatch (Node's underlying
// http.ServerResponse) to write text/event-stream frames. Authorization is
// the token-gated path prefix; rate limiting is intentionally OMITTED on
// the SSE route because long-lived connections legitimately produce zero
// requests-per-window from the Fastify rate-limit plugin's perspective
// (the rate limit fires on connection-open, not per-frame). Heartbeat
// comments (`: keepalive\n\n`) are sent every 30s to keep proxies from
// killing idle connections.
export interface MarketplaceProvider {
	/** Get manifest (from cache if valid, else fetch). */
	getManifest: () => Promise<GetManifestResponse>;
	/** Force-refresh manifest (bypass cache). */
	refreshManifest: () => Promise<{ manifest: MarketplaceManifest; fromCache: boolean }>;
	/** Fetch README markdown for a playbook path. */
	getReadme: (playbookPath: string) => Promise<GetReadmeResponse>;
	/** Fetch a single document for a playbook path. */
	getDocument: (playbookPath: string, filename: string) => Promise<GetDocumentResponse>;
	/** Import a playbook into the headless playbooks store. */
	importPlaybook: (
		playbookId: string,
		targetFolderName: string,
		autoRunFolderPath: string,
		sessionId: string,
		sshRemoteId?: string
	) => Promise<ImportPlaybookResponse>;
	/** Subscribe to manifest-changed events. Returns a cleanup function. */
	onManifestChanged: (listener: () => void) => () => void;
}

let marketplaceProvider: MarketplaceProvider | null = null;

/**
 * Register the active marketplace provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * the `/api/marketplace/*` routes are wired by the time the first client
 * request arrives. Electron-host paths can ignore this — the routes 503
 * cleanly when no provider is registered, and the Electron renderer continues
 * to use the `marketplace:*` IPC namespace directly.
 */
export function registerMarketplaceProvider(provider: MarketplaceProvider | null): void {
	marketplaceProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the routes translate `null` → HTTP 503).
 * Exposed for testing.
 */
export function getMarketplaceProvider(): MarketplaceProvider | null {
	return marketplaceProvider;
}

/* ============ SshRemotes provider registry (W3-ssh-remotes — closes ISC-44.shim.ssh_remotes_routes, server-half) ============ */
//
// Mirrors the WakaTimeProvider / StatsProvider / FontsProvider / FsProvider /
// MarketplaceProvider / AgentsProvider patterns above. Headless entrypoints
// register a provider backed by `src/server/ssh-remotes-manager.ts`; the
// Electron path leaves it unset and the routes 503 cleanly. NO fallback
// default is constructed here — the headless boot path is the only legitimate
// registrant. The renderer-side `ssh-remote:*` IPC handlers in
// `src/main/ipc/handlers/ssh-remote.ts` continue to own the SSH-remote
// surface inside Electron, and the routes here do NOT touch them. Both
// stacks can run side-by-side because the underlying state (the
// `sshRemotes` array + `defaultSshRemoteId` key in maestro-settings.json,
// plus the user's `~/.ssh/config` file) is the cross-mode contract.
//
// LAST of the 5 route clusters named in the umbrella
// `ISC-44.shim.big_3_ipc_strategy` Decision (siblings: `fs_routes`,
// `agents_routes`, `marketplace_routes`, `autorun_routes` — the autorun
// half folded into `FsProvider.writeDoc`). With this cluster shipped, the
// IPC-shim Decision is complete and the NewInstanceModal lift's
// server-side dependencies are all in place (the modal still needs
// agent-config CRUD + model discovery for full parity, both deliberately
// out of scope per the umbrella Decision).
//
// Route surface (3 endpoints — read-only sub-surface per the umbrella
// Decision's "ship the read sub-surface, defer the writers" posture
// established by W3-agents):
//   GET /api/ssh-remotes                   — list configs (mirrors `ssh-remote:getConfigs`)
//   GET /api/ssh-remotes/default-id        — global default id (mirrors `ssh-remote:getDefaultId`)
//   GET /api/ssh-remotes/ssh-config-hosts  — parse ~/.ssh/config (mirrors `ssh-remote:getSshConfigHosts`)
//
// Out of scope (deliberately, per the umbrella big_3_ipc_strategy Decision
// — matches the W3-agents precedent of "ship the read sub-surface,
// defer the writers"):
//   - `ssh-remote:saveConfig` (writer) — config validation + UUID
//     generation + electron-store write semantics; needs widened
//     `SshRemotesProvider.set(...)` and a follow-up brief.
//   - `ssh-remote:deleteConfig` (writer) — same writer-store gap.
//   - `ssh-remote:setDefaultId` (writer) — same writer-store gap.
//   - `ssh-remote:test` — needs `ssh` binary in server env + the
//     buildSshArgs / parseSSHError helpers from
//     `src/main/ssh-remote-manager.ts` extracted into `src/shared/` or
//     inlined here. The connection-test flow is a separate brief because
//     it touches network egress + binary requirements + error-pattern
//     parity that benefits from its own test pass.
//
// NewInstanceModal callsites unblocked by this brief:
//   - NewInstanceModal.tsx:602  — `window.maestro.sshRemote.getConfigs()`
//   - NewInstanceModal.tsx:1312 — same `getConfigs()` callsite
// Both calls populate the SSH-remote dropdown in the modal's connection
// section; the modal does NOT call save/delete/setDefault/test (those
// live in SettingsModal's SSH tab, which is a separate webFull lift).
export interface SshRemotesProvider {
	/**
	 * Get all SSH remote configurations. Returns `{ configs }` with the
	 * stored `SshRemoteConfig[]`. Empty array when none configured.
	 * Mirrors `ssh-remote:getConfigs` 1:1.
	 */
	getConfigs: () => { configs: unknown[] };
	/**
	 * Get the global default SSH remote ID. Returns `{ id }` with the
	 * stored default id or `null` if not set. Mirrors
	 * `ssh-remote:getDefaultId` 1:1.
	 */
	getDefaultId: () => { id: string | null };
	/**
	 * Parse `~/.ssh/config` and return host entries. Returns the parser's
	 * full result envelope (`{ success, hosts, error?, configPath }`).
	 * Mirrors `ssh-remote:getSshConfigHosts` 1:1.
	 */
	getSshConfigHosts: () => {
		success: boolean;
		hosts: unknown[];
		error?: string;
		configPath: string;
	};
}

let sshRemotesProvider: SshRemotesProvider | null = null;

/**
 * Register the active SshRemotes provider. Pass null to clear.
 *
 * The headless server boot path calls this once before `WebServer.start()` so
 * the `/api/ssh-remotes/*` routes are wired by the time the first client
 * request arrives. Electron-host paths can ignore this — the routes 503
 * cleanly when no provider is registered, and the Electron renderer continues
 * to use the `ssh-remote:*` IPC namespace directly.
 */
export function registerSshRemotesProvider(provider: SshRemotesProvider | null): void {
	sshRemotesProvider = provider;
}

/**
 * Internal accessor for the route handlers. Returns the registered provider
 * or `null` if none is registered (the routes translate `null` → HTTP 503).
 * Exposed for testing.
 */
export function getSshRemotesProvider(): SshRemotesProvider | null {
	return sshRemotesProvider;
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

		// ============ Fs endpoints (W3-fs — closes ISC-44.shim.fs_routes, server-half) ============
		//
		// Additive REST routes that mirror the renderer-side `fs:*` IPC namespace
		// (`fs:homeDir`, `fs:stat`, `fs:readFile`) plus the `autorun:writeDoc`
		// IPC channel. 503 when no FsProvider is registered (the Electron path
		// leaves it unset). Per the umbrella big_3_ipc_strategy Decision
		// (2026-06-08), additive `src/main/web-server/routes/` edits are
		// authorized. NO touch to `src/main/ipc/handlers/filesystem.ts`,
		// `src/main/ipc/handlers/autorun.ts`, or the renderer-side preload bridges.
		//
		// Route surface (4 endpoints):
		//   GET  /api/fs/home-dir         — `{path: string, timestamp}`
		//   GET  /api/fs/stat?path=…      — `{exists, isDir, isFile, size?, mtime?, timestamp}`
		//   GET  /api/fs/read-file?path=… — file contents (text/plain or 404 / 400)
		//   POST /api/autorun/write-doc   — body `{path, content}`, reply `{path, bytes, timestamp}`
		//
		// All path-accepting routes validate the input via `validateFsPath()`
		// BEFORE invoking the provider, so traversal / NUL bytes / non-absolute
		// paths fail loud with a 400 — the provider never sees a hostile path.
		// The provider itself also validates as a belt-and-suspenders defense.
		//
		// SSH remote support is deliberately out of scope here (see the manager
		// doc-comment); a `?sshRemoteId=` query param on the read routes returns
		// 501 Not Implemented so callers don't silently get a local path when a
		// remote was requested.

		// GET /api/fs/home-dir — mirrors the `fs:homeDir` IPC reply (`string`).
		server.get(
			`/${token}/api/fs/home-dir`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getFsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Fs provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const homeDir = provider.getHomeDir();
					return {
						path: homeDir,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to resolve home directory: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/fs/stat?path=<absolute> — mirrors the `fs:stat` IPC reply,
		// adapted to return `{exists}` instead of throwing on missing paths.
		// Returns 200 with `{exists: false}` for missing paths so the client
		// can distinguish "didn't exist" from "couldn't ask" without parsing
		// error text.
		server.get(
			`/${token}/api/fs/stat`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getFsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Fs provider not configured',
						timestamp: Date.now(),
					});
				}
				const { path: queryPath, sshRemoteId } = request.query as {
					path?: string;
					sshRemoteId?: string;
				};
				if (sshRemoteId) {
					return reply.code(501).send({
						error: 'Not Implemented',
						message:
							'sshRemoteId is not supported by the server-side fs routes; use the Electron IPC path for SSH remote operations',
						timestamp: Date.now(),
					});
				}
				const reason = validateFsPath(queryPath);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.stat(queryPath as string);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to stat path: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/fs/read-file?path=<absolute> — mirrors `fs:readFile` for the
		// TEXT case. Binary files return 400 (the renderer-side handler returns
		// a `data:` URL for images; server-side is text-only, see manager doc).
		// Missing files / directories return 404 so the client can distinguish
		// from a 200 with empty content (a real empty file).
		server.get(
			`/${token}/api/fs/read-file`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getFsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Fs provider not configured',
						timestamp: Date.now(),
					});
				}
				const { path: queryPath, sshRemoteId } = request.query as {
					path?: string;
					sshRemoteId?: string;
				};
				if (sshRemoteId) {
					return reply.code(501).send({
						error: 'Not Implemented',
						message:
							'sshRemoteId is not supported by the server-side fs routes; use the Electron IPC path for SSH remote operations',
						timestamp: Date.now(),
					});
				}
				const reason = validateFsPath(queryPath);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				try {
					const content = await provider.readFile(queryPath as string);
					if (content === null) {
						return reply.code(404).send({
							error: 'Not Found',
							message: 'File does not exist or is a directory',
							timestamp: Date.now(),
						});
					}
					// Send as text/plain so the client receives the raw string
					// without JSON-wrapping (the renderer-side IPC reply is the
					// bare string too — this preserves wire parity for the
					// read-file case, the only route in this cluster that
					// returns non-JSON).
					return reply.code(200).header('Content-Type', 'text/plain; charset=utf-8').send(content);
				} catch (error: any) {
					if (error?.binary === true) {
						return reply.code(400).send({
							error: 'Bad Request',
							message: 'File appears to contain binary data; server-side fs routes are text-only',
							timestamp: Date.now(),
						});
					}
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read file: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// POST /api/autorun/write-doc — body `{path, content}`. Writes content
		// to an absolute path, creating parent directories on demand. Returns
		// `{path, bytes, timestamp}`. Used by the AutoRun shell to materialize
		// docs to disk; the brief flattens the renderer-side
		// `(folderPath, filename, content)` tuple into a single absolute path
		// since the webFull shell constructs the full path client-side.
		server.post(
			`/${token}/api/autorun/write-doc`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getFsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Fs provider not configured',
						timestamp: Date.now(),
					});
				}
				const body = request.body as { path?: unknown; content?: unknown } | undefined;
				const bodyPath = body?.path;
				const bodyContent = body?.content;
				const reason = validateFsPath(bodyPath);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				if (typeof bodyContent !== 'string') {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'content must be a string',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.writeDoc(bodyPath as string, bodyContent);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to write doc: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ Marketplace endpoints (W3 — closes ISC-44.shim.w3_marketplace_routes, server-half) ============
		//
		// Additive REST routes that mirror the renderer-side `marketplace:*`
		// IPC namespace. 503 when no MarketplaceProvider is registered (the
		// Electron path leaves it unset). Per the W2 precedent + ISC-40 N1
		// legalization, additive `src/main/web-server/routes/` edits are
		// authorized. NO touch to `src/main/ipc/handlers/marketplace.ts` or
		// the renderer-side preload bridge.
		//
		// THIS CORRECTS THE IPC-SHIM DECISION audit scope: the modal-file
		// grep counted MarketplaceModal's 5 sites and concluded "ZERO new
		// routes." The transitive `useMarketplace` hook is the actual
		// consumer of `window.maestro.marketplace.*` (7 sites + 1 event
		// subscription = 8 surfaces total), and lifting `MarketplaceModal`
		// requires those 8 surfaces to work in webFull, hence the 6-route
		// cluster here (manifest, refresh, readme, document, import, +
		// the SSE manifest/events stream for the onManifestChanged hook
		// subscription).

		// GET /api/marketplace/manifest — getManifest reply
		// (`{ manifest, fromCache, cacheAge?, timestamp }`).
		server.get(
			`/${token}/api/marketplace/manifest`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getMarketplaceProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Marketplace provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.getManifest();
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to read marketplace manifest: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// POST /api/marketplace/refresh — force-refresh (bypass cache).
		// Reply: `{ manifest, fromCache, timestamp }`.
		server.post(
			`/${token}/api/marketplace/refresh`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getMarketplaceProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Marketplace provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.refreshManifest();
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to refresh marketplace manifest: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/marketplace/readme?path=<playbookPath> — README content.
		// Reply: `{ content: string | null, timestamp }`.
		//
		// `path` validation: must be present, must be a non-empty string.
		// The marketplace manager performs its own traversal validation on
		// local-filesystem paths (via `validateSafePath`). Remote (GitHub)
		// paths are sent as-is to a fixed `raw.githubusercontent.com`
		// base URL, so a hostile `path` cannot redirect to another origin.
		server.get(
			`/${token}/api/marketplace/readme`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getMarketplaceProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Marketplace provider not configured',
						timestamp: Date.now(),
					});
				}
				const { path: playbookPath } = request.query as { path?: string };
				if (typeof playbookPath !== 'string' || playbookPath.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'path query parameter is required',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.getReadme(playbookPath);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to fetch README: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/marketplace/document?path=<playbookPath>&filename=<name>
		// Reply: `{ content: string, timestamp }`.
		//
		// `path` + `filename` validation: both must be present, non-empty
		// strings; `filename` must not contain `..` (the manager also
		// validates, but a 400 here gives a cleaner client-facing error
		// than a 500 wrapping `MarketplaceFetchError('Invalid filename')`).
		server.get(
			`/${token}/api/marketplace/document`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getMarketplaceProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Marketplace provider not configured',
						timestamp: Date.now(),
					});
				}
				const { path: playbookPath, filename } = request.query as {
					path?: string;
					filename?: string;
				};
				if (typeof playbookPath !== 'string' || playbookPath.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'path query parameter is required',
						timestamp: Date.now(),
					});
				}
				if (typeof filename !== 'string' || filename.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'filename query parameter is required',
						timestamp: Date.now(),
					});
				}
				if (filename.includes('..')) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'filename must not contain path traversal sequences',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.getDocument(playbookPath, filename);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to fetch document: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// POST /api/marketplace/import — import a playbook to disk.
		// Body: `{ playbookId, targetFolderName, autoRunFolderPath, sessionId, sshRemoteId? }`.
		// Reply: `{ playbook, importedDocs, importedAssets, timestamp }`.
		//
		// `autoRunFolderPath` validation: must be a non-empty absolute path.
		// The headless variant does NOT support SSH-remote imports — the
		// manager throws if `sshRemoteId` is non-empty. The route surfaces
		// that throw as a 500 with the manager's message; future versions
		// may upgrade to a 501-style "Not Implemented" if SSH remoting
		// lands in the server tree.
		server.post(
			`/${token}/api/marketplace/import`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getMarketplaceProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Marketplace provider not configured',
						timestamp: Date.now(),
					});
				}
				const body = request.body as
					| {
							playbookId?: string;
							targetFolderName?: string;
							autoRunFolderPath?: string;
							sessionId?: string;
							sshRemoteId?: string;
					  }
					| undefined;
				const playbookId = body?.playbookId;
				const targetFolderName = body?.targetFolderName;
				const autoRunFolderPath = body?.autoRunFolderPath;
				const sessionId = body?.sessionId;
				const sshRemoteId = body?.sshRemoteId;

				if (typeof playbookId !== 'string' || playbookId.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'playbookId must be a non-empty string',
						timestamp: Date.now(),
					});
				}
				if (typeof targetFolderName !== 'string' || targetFolderName.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'targetFolderName must be a non-empty string',
						timestamp: Date.now(),
					});
				}
				if (typeof autoRunFolderPath !== 'string' || autoRunFolderPath.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'autoRunFolderPath must be a non-empty string',
						timestamp: Date.now(),
					});
				}
				if (typeof sessionId !== 'string' || sessionId.length === 0) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'sessionId must be a non-empty string',
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.importPlaybook(
						playbookId,
						targetFolderName,
						autoRunFolderPath,
						sessionId,
						sshRemoteId
					);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to import playbook: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/marketplace/manifest/events — SSE stream.
		// Emits `data: {"type":"manifestChanged","timestamp":<ms>}\n\n`
		// on every local-manifest.json change (debounced by the manager).
		// `: keepalive\n\n` comment frames every 30s keep idle proxies
		// from killing the connection. Cleanup on `request.raw.on('close')`.
		server.get(
			`/${token}/api/marketplace/manifest/events`,
			{
				// Intentionally NO rate limit on SSE — long-lived connections
				// are the wrong shape for the request-rate-limit window.
			},
			async (request, reply) => {
				const provider = getMarketplaceProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Marketplace provider not configured',
						timestamp: Date.now(),
					});
				}

				// Switch to raw mode — Fastify defers to Node's http.ServerResponse.
				reply.raw.writeHead(200, {
					'Content-Type': 'text/event-stream',
					'Cache-Control': 'no-cache, no-transform',
					Connection: 'keep-alive',
					// CORS for browsers running on a different origin than the
					// server's listen address — the rest of the /api/* surface
					// has CORS configured at the WebServer level; SSE bypasses
					// that path because reply.raw doesn't run through Fastify's
					// preHandler chain. Allow the same origin set explicitly.
					'Access-Control-Allow-Origin': '*',
				});

				// Initial comment frame — confirms the stream is established.
				reply.raw.write(`: connected ${Date.now()}\n\n`);

				const send = () => {
					try {
						reply.raw.write(
							`data: ${JSON.stringify({ type: 'manifestChanged', timestamp: Date.now() })}\n\n`
						);
					} catch {
						/* connection died — cleanup is wired below */
					}
				};

				const cleanup = provider.onManifestChanged(send);

				// 30s heartbeat keepalive. Many proxies kill idle TCP at 60-120s;
				// 30s is comfortably inside that window for every proxy we've
				// seen in practice (nginx default 60s, Cloudflare 100s).
				const heartbeat = setInterval(() => {
					try {
						reply.raw.write(`: keepalive ${Date.now()}\n\n`);
					} catch {
						/* connection died */
					}
				}, 30_000);

				// Cleanup on client disconnect.
				request.raw.on('close', () => {
					clearInterval(heartbeat);
					cleanup();
					try {
						reply.raw.end();
					} catch {
						/* already closed */
					}
				});
			}
		);

		// ============ Agents endpoints (W3-agents — closes ISC-44.shim.agents_routes, server-half) ============
		//
		// Additive REST routes that mirror the renderer-side `agents:*` IPC namespace
		// (`agents:detect`, `agents:refresh`, `agents:getCapabilities`) — the
		// detection-and-capabilities sub-surface that the umbrella
		// `ISC-44.shim.big_3_ipc_strategy` Decision named as a dependency for the
		// NewInstanceModal port to webFull. 503 when no AgentsProvider is
		// registered (the Electron path leaves it unset). Per the umbrella Decision
		// (2026-06-08), additive `src/main/web-server/routes/` edits are authorized.
		// NO touch to `src/main/ipc/handlers/agents.ts` or the renderer-side preload
		// bridge.
		//
		// Route surface (3 endpoints):
		//   GET /api/agents/detected              — `{agents: unknown[], timestamp}`
		//   GET /api/agents/detect/:agentId       — `{agents, debugInfo, timestamp}`
		//   GET /api/agents/capabilities/:agentId — `{agentId, capabilities, timestamp}`
		//
		// All :agentId-accepting routes validate the input via `validateAgentId()`
		// BEFORE invoking the provider, so traversal / shell-special characters
		// fail loud with a 400 — the provider never sees a hostile id. Defense-
		// in-depth posture matches the W3-fs precedent.
		//
		// SSH-remote support is deliberately out of scope here (see the manager
		// doc-comment); a `?sshRemoteId=` query param returns 501 Not Implemented
		// so callers don't silently get a local-host result when a remote was
		// requested. Mirrors the W3-fs SSH 501 posture at apiRoutes.ts:1278+.
		//
		// Out of scope per the umbrella big_3_ipc_strategy Decision — will land in
		// follow-up briefs once the NewInstanceModal port to webFull surfaces real
		// consumers:
		//   - `agents:getConfig` / `agents:setConfig` and custom path/args/env
		//     CRUD — needs a server-side config store.
		//   - `agents:getModels` — local model discovery.
		//   - `agents:discoverSlashCommands` — Claude Code only.

		// GET /api/agents/detected — mirrors `agents:detect` IPC reply, wrapped
		// in a `{agents, timestamp}` envelope for parity with the rest of the
		// `/api/*` surface (every other route returns a `timestamp`-stamped
		// object, never a bare array).
		server.get(
			`/${token}/api/agents/detected`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getAgentsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Agents provider not configured',
						timestamp: Date.now(),
					});
				}
				const { sshRemoteId } = (request.query as { sshRemoteId?: string }) || {};
				if (sshRemoteId) {
					return reply.code(501).send({
						error: 'Not Implemented',
						message:
							'sshRemoteId is not supported by the server-side agents routes; use the Electron IPC path for SSH remote operations',
						timestamp: Date.now(),
					});
				}
				try {
					const agents = await provider.detectAgents();
					return {
						agents,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to detect agents: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/agents/detect/:agentId — mirrors `agents:refresh` IPC reply.
		// Returns the full agent list PLUS a `debugInfo` payload targeted at
		// the requested agent. When the agent is detected, `debugInfo` is null.
		// When it is NOT detected, `debugInfo` is populated with env context
		// + the `which`/`where` failure output so callers can diagnose missing
		// installs without round-tripping.
		server.get(
			`/${token}/api/agents/detect/:agentId`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getAgentsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Agents provider not configured',
						timestamp: Date.now(),
					});
				}
				const { sshRemoteId } = (request.query as { sshRemoteId?: string }) || {};
				if (sshRemoteId) {
					return reply.code(501).send({
						error: 'Not Implemented',
						message:
							'sshRemoteId is not supported by the server-side agents routes; use the Electron IPC path for SSH remote operations',
						timestamp: Date.now(),
					});
				}
				const { agentId } = request.params as { agentId?: string };
				const reason = validateAgentId(agentId);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				try {
					const result = await provider.detectAgent(agentId as string);
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to detect agent: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/agents/capabilities/:agentId — mirrors `agents:getCapabilities`.
		// Pure lookup against `AGENT_CAPABILITIES`. Unknown ids return the default
		// matrix (all-false) per the underlying contract.
		server.get(
			`/${token}/api/agents/capabilities/:agentId`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getAgentsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Agents provider not configured',
						timestamp: Date.now(),
					});
				}
				const { agentId } = request.params as { agentId?: string };
				const reason = validateAgentId(agentId);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				try {
					const capabilities = provider.getCapabilities(agentId as string);
					return {
						agentId,
						capabilities,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to get capabilities: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ W3-agents-writers — writer routes (closes ISC-44.shim.agents_writers) ============
		//
		// Extends the W3-agents detection-only surface with the writer routes
		// that the umbrella `ISC-44.shim.big_3_ipc_strategy` Decision named as a
		// follow-up. Closes the remaining 6 of 11 NewInstanceModal IPC call
		// sites the original W3-agents brief audit named (lines 284, 405, 971,
		// 1277, 1288, 1482, 1791 in NewInstanceModal.tsx). With these 3 routes
		// shipped, NewInstanceModal becomes fully unblocked for the webFull
		// port (the original W3-agents brief shipped detection + capabilities;
		// this brief ships config CRUD + model discovery — the per-IPC-shim
		// Decision agents cluster is now complete).
		//
		// Route surface (3 endpoints):
		//   GET /api/agents/config/:agentId   — merged defaults + stored config
		//   PUT /api/agents/config/:agentId   — overwrite stored config
		//   GET /api/agents/models/:agentId   — discover available models
		//
		// All routes 503 cleanly when no `AgentsProvider` is registered. Per
		// the per-IPC-shim Decision, the writer cluster does NOT accept
		// `?sshRemoteId=` — config is local-only (the SSH-remote sub-ISC ships
		// remote config CRUD on its own surface). The `models` route also
		// rejects `?sshRemoteId=` with 501 to match the W3-agents read-side
		// posture (the SSH-remote `agents:getModels` path lives behind the
		// `ssh-remote:*` cluster, not under `/api/agents/`).

		// GET /api/agents/config/:agentId — mirrors `agents:getConfig`.
		// Returns the merged shape: defaults from `configOptions[*].default`
		// overlaid with the stored per-agent config from
		// `<dataDir>/agents-config.json`. Unknown agent ids return just the
		// stored config (or `{}` if none) — matches the renderer-side handler.
		server.get(
			`/${token}/api/agents/config/:agentId`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getAgentsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Agents provider not configured',
						timestamp: Date.now(),
					});
				}
				const { agentId } = request.params as { agentId?: string };
				const reason = validateAgentId(agentId);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				try {
					const config = await provider.getConfig(agentId as string);
					return {
						agentId,
						config,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to get config: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// PUT /api/agents/config/:agentId — mirrors `agents:setConfig`.
		// Body: `{ config: Record<string, unknown> }` — replaces (does NOT
		// merge) the stored per-agent config. The body shape matches the
		// renderer-side handler's call site: `setConfig(agentId, config)`. The
		// route uses PUT (idempotent overwrite) rather than POST (create) to
		// match the renderer-side write semantics — repeated calls with the
		// same body produce the same on-disk state.
		//
		// Validation: `config` MUST be a plain object (not array, not null,
		// not a primitive). The renderer-side handler accepts any
		// `Record<string, unknown>` and writes it through; we validate at the
		// route boundary because HTTP bodies can be anything, where IPC payloads
		// are typed at the preload bridge.
		server.put(
			`/${token}/api/agents/config/:agentId`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.maxPost,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getAgentsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Agents provider not configured',
						timestamp: Date.now(),
					});
				}
				const { agentId } = request.params as { agentId?: string };
				const reason = validateAgentId(agentId);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				const body = request.body as { config?: unknown } | undefined;
				const config = body?.config;
				if (
					config === null ||
					config === undefined ||
					typeof config !== 'object' ||
					Array.isArray(config)
				) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: 'config must be a plain object (not array, not null)',
						timestamp: Date.now(),
					});
				}
				try {
					const success = await provider.setConfig(
						agentId as string,
						config as Record<string, unknown>
					);
					return {
						agentId,
						success,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to set config: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/agents/models/:agentId — mirrors `agents:getModels` (local
		// path only — SSH-remote dispatch is a sibling cluster). Returns
		// `{ agentId, models, timestamp }`. Currently only `opencode` actually
		// shells out (`opencode models` returns one model per line); other
		// agents that don't support model selection or that have no `models`
		// subcommand implementation return `[]` (this matches the renderer-side
		// `AgentDetector.runModelDiscovery` posture — see detector.ts:279).
		//
		// Query params:
		//   ?forceRefresh=true  — bypass the 5-minute model-cache TTL
		//   ?sshRemoteId=...    — 501 (sibling cluster owns remote)
		server.get(
			`/${token}/api/agents/models/:agentId`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (request, reply) => {
				const provider = getAgentsProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'Agents provider not configured',
						timestamp: Date.now(),
					});
				}
				const { sshRemoteId, forceRefresh } =
					(request.query as { sshRemoteId?: string; forceRefresh?: string }) || {};
				if (sshRemoteId) {
					return reply.code(501).send({
						error: 'Not Implemented',
						message:
							'sshRemoteId is not supported by the server-side agents routes; use the Electron IPC path for SSH remote operations',
						timestamp: Date.now(),
					});
				}
				const { agentId } = request.params as { agentId?: string };
				const reason = validateAgentId(agentId);
				if (reason) {
					return reply.code(400).send({
						error: 'Bad Request',
						message: reason,
						timestamp: Date.now(),
					});
				}
				try {
					// `forceRefresh` query param is the string "true"/"false" in
					// HTTP land — coerce to boolean before forwarding to the
					// provider.
					const force = forceRefresh === 'true' || forceRefresh === '1';
					const models = await provider.getModels(agentId as string, force);
					return {
						agentId,
						models,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to discover models: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// ============ W3-ssh-remotes — read-side surface (closes ISC-44.shim.ssh_remotes_routes, server-half) ============
		//
		// Ships the LAST of the 5 server-side route clusters named in the umbrella
		// `ISC-44.shim.big_3_ipc_strategy` Decision. Mirrors the read sub-surface of
		// the `ssh-remote:*` IPC channels at `src/main/ipc/handlers/ssh-remote.ts`.
		// Backed by `src/server/ssh-remotes-manager.ts` (NEW). With this cluster
		// shipped, all 5 sibling sub-ISCs are closed (fs / agents / marketplace /
		// autorun-via-FsProvider.writeDoc / ssh-remotes) and the IPC-shim Decision
		// is complete. NO touch to `src/main/ipc/handlers/ssh-remote.ts` or the
		// renderer-side preload bridge.
		//
		// Route surface (3 endpoints):
		//   GET /api/ssh-remotes                   — `{configs, timestamp}`
		//   GET /api/ssh-remotes/default-id        — `{id, timestamp}`
		//   GET /api/ssh-remotes/ssh-config-hosts  — `{success, hosts, error?, configPath, timestamp}`
		//
		// All routes 503 cleanly when no `SshRemotesProvider` is registered (the
		// Electron path leaves it unset and the renderer continues to use the
		// `ssh-remote:*` IPC namespace via `window.maestro.sshRemote.*`). NO
		// `?sshRemoteId=` query param is accepted here — the SSH-remote surface
		// IS the SSH-remote surface; there is no nested SSH-over-SSH semantic to
		// reject. This differs from the W3-fs / W3-agents precedent (which both
		// 501 on `?sshRemoteId=`) because those routes operate on the local host
		// and might plausibly be retargeted; the SSH-remote routes operate on the
		// settings store + ~/.ssh/config directly.
		//
		// Out of scope per the umbrella Decision — will land in follow-up briefs:
		//   - `ssh-remote:saveConfig` / `deleteConfig` / `setDefaultId` (writers).
		//   - `ssh-remote:test` (connection-test; needs `ssh` binary + buildSshArgs
		//     / parseSSHError extraction from `src/main/ssh-remote-manager.ts`).

		// GET /api/ssh-remotes — mirrors `ssh-remote:getConfigs` IPC reply.
		// Returns `{ configs, timestamp }`. The configs array is a serialized
		// `SshRemoteConfig[]` straight from the settings store — same on-disk
		// schema as the renderer-side handler reads.
		server.get(
			`/${token}/api/ssh-remotes`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getSshRemotesProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'SSH remotes provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const { configs } = provider.getConfigs();
					return {
						configs,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to get SSH remote configs: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/ssh-remotes/default-id — mirrors `ssh-remote:getDefaultId`
		// IPC reply. Returns `{ id, timestamp }` where `id` is the stored
		// default SSH remote id or `null` if not set.
		server.get(
			`/${token}/api/ssh-remotes/default-id`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getSshRemotesProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'SSH remotes provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const { id } = provider.getDefaultId();
					return {
						id,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to get default SSH remote id: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		// GET /api/ssh-remotes/ssh-config-hosts — mirrors
		// `ssh-remote:getSshConfigHosts` IPC reply. Parses `~/.ssh/config`
		// on the SERVER host (the headless server reads its own filesystem)
		// and returns the parsed host list. Returns `{ success: true,
		// hosts: [] }` when the config file is absent (matches the
		// renderer-side parser's contract — absent config is not an error).
		// Wildcard-only Host patterns (`Host *`) are filtered out per the
		// parser's contract — only concrete host entries make it into the
		// response.
		server.get(
			`/${token}/api/ssh-remotes/ssh-config-hosts`,
			{
				config: {
					rateLimit: {
						max: this.rateLimitConfig.max,
						timeWindow: this.rateLimitConfig.timeWindow,
					},
				},
			},
			async (_request, reply) => {
				const provider = getSshRemotesProvider();
				if (!provider) {
					return reply.code(503).send({
						error: 'Service Unavailable',
						message: 'SSH remotes provider not configured',
						timestamp: Date.now(),
					});
				}
				try {
					const result = provider.getSshConfigHosts();
					return {
						...result,
						timestamp: Date.now(),
					};
				} catch (error: any) {
					return reply.code(500).send({
						error: 'Internal Server Error',
						message: `Failed to get SSH config hosts: ${error.message}`,
						timestamp: Date.now(),
					});
				}
			}
		);

		logger.debug('API routes registered', LOG_CONTEXT);
	}
}
