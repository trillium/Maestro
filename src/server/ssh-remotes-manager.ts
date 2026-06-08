/**
 * Server-side SSH remotes manager — headless variant of the `ssh-remote:*`
 * IPC handlers at `src/main/ipc/handlers/ssh-remote.ts`.
 *
 * Ported for W3-ssh-remotes (closes the server half of
 * `ISC-44.shim.ssh_remotes_routes`, the last of the 5 route clusters named in
 * the umbrella `ISC-44.shim.big_3_ipc_strategy` Decision). Mirrors the
 * precedents established by W2-wakatime / W2-stats / W2-fonts / W3-fs /
 * W3-marketplace / W3-agents:
 *
 *   1. **No `electron` import.** The renderer-side handler pulls in
 *      `electron-store` for `Store<MaestroSettings>` typing only; the actual
 *      read/write surface is `.get('sshRemotes', [])` / `.set('sshRemotes', …)`
 *      / `.get('defaultSshRemoteId', null)` / `.set('defaultSshRemoteId', …)`.
 *      The headless server passes a `FileStore<Record<string, unknown>>`
 *      that satisfies the same minimal `.get/.set` contract — same pattern
 *      `marketplace-manager.ts` uses for its `MarketplaceSettingsReader`.
 *
 *   2. **No `src/main/utils/logger` import.** Falls back to `console.*` with
 *      a `[SshRemotes]` prefix — matches the rest of `src/server/`, which
 *      standardizes on `console.log/warn/error` to avoid re-pulling the
 *      main-process logger graph (sentry → @sentry/electron) into the
 *      server's runtime path.
 *
 *   3. **No `src/main/ssh-remote-manager` import.** That module lives in
 *      `src/main/` (NOT in `tsconfig.server.json`'s include set), pulls in
 *      `src/main/utils/execFile` (also out of include set), and transitively
 *      reaches the main-process logger/sentry graph. The pieces this surface
 *      needs from it are: (a) the `defaultSshOptions` constant (for parity
 *      with the renderer-side connection contract if a future brief adds the
 *      `/test` route here), and (b) the `validateConfig()` logic (for parity
 *      with the renderer-side save path). Neither is needed by the routes
 *      this brief ships — see "Out of scope" below — so the headless port
 *      starts WITHOUT them. A future brief that adds save/delete/test routes
 *      can either inline the same logic here or extract a shared library
 *      under `src/shared/`.
 *
 *   4. **No `src/main/utils/ssh-config-parser` import.** That module lives
 *      in `src/main/utils/` (NOT in the include set). The parser is small
 *      (~290 LOC), pure-stdlib (`fs`, `path`, plus `expandTilde` from
 *      `shared/pathUtils` which IS in the include set), and the renderer-side
 *      `getSshConfigHosts` IPC handler is the only consumer in the
 *      ssh-remote surface that uses it. The headless port re-implements
 *      the parser inline below — the two MUST stay in sync for cross-mode
 *      parity (any new directive added to the renderer-side parser SHOULD
 *      be mirrored here, and vice-versa).
 *
 *   5. **Read-only surface in this brief.** The renderer-side handler
 *      exposes 7 IPC channels: `saveConfig`, `deleteConfig`, `getConfigs`,
 *      `getDefaultId`, `setDefaultId`, `test`, `getSshConfigHosts`. The
 *      umbrella big_3_ipc_strategy Decision named `GET /api/ssh-remotes`
 *      (mirroring `getConfigs`) as the single unblock-NewInstanceModal
 *      route. The NewInstanceModal callsites at NewInstanceModal:602 and
 *      NewInstanceModal:1312 both call `getConfigs()` — none of them call
 *      `saveConfig` / `deleteConfig` / `setDefaultId` / `test`. The shipped
 *      route surface therefore mirrors the audit's minimum, plus two
 *      adjacent reads that are zero-additional-cost (no shell-out, no
 *      `ssh` binary required, no settings-store WRITE):
 *
 *        - `getConfigs()` → `GET /api/ssh-remotes` (the audit's minimum)
 *        - `getDefaultId()` → `GET /api/ssh-remotes/default-id`
 *          (pure read; `useAgentConfiguration` and other webFull lifts will
 *          need this once they land — including it now is cheaper than
 *          a follow-up brief)
 *        - `getSshConfigHosts()` → `GET /api/ssh-remotes/ssh-config-hosts`
 *          (pure read of `~/.ssh/config`; useful for `SshRemoteSelector`
 *          parity; zero settings-store dependency)
 *
 *      Out of scope (deferred per the umbrella Decision's posture — match
 *      the W3-agents precedent of "ship the read sub-surface, defer the
 *      writers"):
 *
 *        - `saveConfig` / `deleteConfig` / `setDefaultId` — config CRUD
 *          needs a server-side write story (validation + UUID generation
 *          + electron-store write semantics that the FileStore matches but
 *          hasn't been exercised for this key). The NewInstanceModal flow
 *          this brief unblocks is the READ path (`getConfigs()` to populate
 *          the dropdown); the CRUD flow lives in `SettingsModal`'s SSH
 *          tab, which is a separate webFull lift entirely. Suggested route
 *          surface for a follow-up brief: `POST /api/ssh-remotes` (create
 *          / update), `DELETE /api/ssh-remotes/:id`, `PUT /api/ssh-remotes/default-id`.
 *        - `test` — needs an `ssh` binary in the headless server's
 *          environment plus the `buildSshArgs` + `parseSSHError` helpers
 *          from `src/main/ssh-remote-manager.ts`. The connection-test flow
 *          is gated on having a `SshRemoteManager` instance in the server
 *          tree, which has the same "no electron-side deps" rule the rest
 *          of `src/server/` enforces. A follow-up brief should either
 *          extract `validateConfig` / `buildSshArgs` / `parseSSHError`
 *          into `src/shared/` or inline them here. Suggested route:
 *          `POST /api/ssh-remotes/test` body
 *          `{ configOrId, agentCommand? }`.
 *
 *   6. **No on-disk schema changes.** The `sshRemotes` key in
 *      `<dataDir>/maestro-settings.json` is the cross-mode contract: both
 *      Electron (renderer-side handler at `src/main/ipc/handlers/ssh-remote.ts`)
 *      and the headless server read the same array of `SshRemoteConfig`
 *      objects. A desktop user who has configured SSH remotes under
 *      Electron can list them headless and vice-versa. The `defaultSshRemoteId`
 *      key follows the same posture.
 *
 *   7. **SSH-config file is read directly from `~/.ssh/config`.** The
 *      headless server reads the same file the renderer-side handler would
 *      read inside Electron. No new file path, no platform divergence.
 *      Wildcard-only Host patterns (e.g., `Host *`) are filtered out per
 *      the renderer-side parser's contract — only concrete host entries
 *      that a user could connect to make it into the response.
 *
 * `src/main/ipc/handlers/ssh-remote.ts` is NOT touched. This file is the
 * new server-side surface; the renderer continues to use the IPC channel via
 * `window.maestro.sshRemote.*`.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { SshRemoteConfig } from '../shared/types';
import { expandTilde } from '../shared/pathUtils';

const LOG_CONTEXT = '[SshRemotes]';

/* ============ Minimal SettingsReader interface ============ */

/**
 * The subset of electron-store / FileStore that the manager actually uses.
 * Mirrors the `MarketplaceSettingsReader` / `WakaTimeSettingsReader` patterns
 * in their respective managers. Decouples the manager from the main-process
 * `Store<MaestroSettings>` type so the headless server can pass its
 * `FileStore<Record<string, unknown>>` without dragging the electron-store
 * types tree into the server build.
 *
 * Only `.get(key, default)` is needed — this brief ships read routes only;
 * a follow-up brief that adds save/delete will widen the interface to
 * include `.set(key, value)`.
 */
export interface SshRemotesSettingsReader {
	get<V>(key: string, defaultValue: V): V;
}

/* ============ SSH config parser (inlined; mirrors src/main/utils/ssh-config-parser.ts) ============ */

/**
 * Parsed SSH config host entry. Field-for-field mirror of
 * `SshConfigHost` in `src/main/utils/ssh-config-parser.ts:19` — the two
 * MUST stay in sync.
 */
export interface SshConfigHost {
	host: string;
	hostName?: string;
	port?: number;
	user?: string;
	identityFile?: string;
	proxyJump?: string;
}

/**
 * Result of parsing an SSH config file. Field-for-field mirror of
 * `SshConfigParseResult` in `src/main/utils/ssh-config-parser.ts:42`.
 */
export interface SshConfigParseResult {
	success: boolean;
	hosts: SshConfigHost[];
	error?: string;
	configPath: string;
}

/**
 * Normalize an IdentityFile path. Mirrors the helper in
 * `src/main/utils/ssh-config-parser.ts:92` 1:1.
 */
function normalizeIdentityFile(
	identityFile: string,
	host: string,
	user: string | undefined,
	homeDir: string
): string {
	let normalized = expandTilde(identityFile, homeDir);
	normalized = normalized.replace(/%d/g, homeDir);
	normalized = normalized.replace(/%h/g, host);
	if (user) {
		normalized = normalized.replace(/%r/g, user);
	}
	return normalized;
}

/**
 * Check if a host pattern is a wildcard pattern. Mirrors
 * `isWildcardPattern` in `src/main/utils/ssh-config-parser.ts:113`.
 */
function isWildcardPattern(pattern: string): boolean {
	return pattern.includes('*') || pattern.includes('?');
}

/**
 * Parse the content of an SSH config file. Mirrors
 * `parseConfigContent` in `src/main/utils/ssh-config-parser.ts:167` 1:1.
 *
 * Behaviors preserved verbatim:
 *   - multi-line Host blocks
 *   - HostName / Port / User / IdentityFile / ProxyJump directives only
 *     (other directives ignored)
 *   - inline `#` comment stripping
 *   - wildcard-only Host patterns filtered out
 *   - multi-pattern Host lines (e.g., `Host server1 server2`) use the first
 *     non-wildcard pattern as the canonical name
 */
function parseConfigContent(content: string, homeDir: string): SshConfigHost[] {
	const lines = content.split(/\r?\n/);
	const hosts: SshConfigHost[] = [];
	let currentHost: SshConfigHost | null = null;

	for (const rawLine of lines) {
		const commentIdx = rawLine.indexOf('#');
		const line = (commentIdx >= 0 ? rawLine.slice(0, commentIdx) : rawLine).trim();
		if (!line) continue;

		const match = line.match(/^(\S+)\s*[=\s]\s*(.+)$/);
		if (!match) continue;

		const [, keyword, rawValue] = match;
		const value = rawValue.trim();
		const keywordLower = keyword.toLowerCase();

		if (keywordLower === 'host') {
			if (currentHost && !isWildcardPattern(currentHost.host)) {
				hosts.push(currentHost);
			}
			const patterns = value.split(/\s+/);
			const mainPattern = patterns.find((p) => !isWildcardPattern(p));
			if (mainPattern) {
				currentHost = { host: mainPattern };
			} else {
				currentHost = null;
			}
		} else if (currentHost) {
			switch (keywordLower) {
				case 'hostname':
					currentHost.hostName = value;
					break;
				case 'port': {
					const port = parseInt(value, 10);
					if (!isNaN(port) && port > 0 && port <= 65535) {
						currentHost.port = port;
					}
					break;
				}
				case 'user':
					currentHost.user = value;
					break;
				case 'identityfile':
					currentHost.identityFile = normalizeIdentityFile(
						value,
						currentHost.hostName || currentHost.host,
						currentHost.user,
						homeDir
					);
					break;
				case 'proxyjump':
					currentHost.proxyJump = value;
					break;
			}
		}
	}

	if (currentHost && !isWildcardPattern(currentHost.host)) {
		hosts.push(currentHost);
	}

	return hosts;
}

/**
 * Parse `~/.ssh/config` and extract host configurations. Mirrors
 * `parseSshConfig` in `src/main/utils/ssh-config-parser.ts:129` 1:1. Returns
 * `{ success: true, hosts: [] }` when the config file is absent (matches the
 * renderer-side contract — absent config is not an error).
 */
function parseSshConfig(): SshConfigParseResult {
	const homeDir = os.homedir();
	const configPath = path.join(homeDir, '.ssh', 'config');

	let exists = false;
	try {
		fs.accessSync(configPath, fs.constants.R_OK);
		exists = true;
	} catch {
		exists = false;
	}

	if (!exists) {
		return {
			success: true,
			hosts: [],
			configPath,
		};
	}

	try {
		const content = fs.readFileSync(configPath, 'utf-8');
		const hosts = parseConfigContent(content, homeDir);
		return {
			success: true,
			hosts,
			configPath,
		};
	} catch (err) {
		return {
			success: false,
			hosts: [],
			error: `Failed to parse SSH config: ${err instanceof Error ? err.message : String(err)}`,
			configPath,
		};
	}
}

/* ============ SshRemotesManager (server-side) ============ */

/**
 * Server-side SSH remotes manager. Mirrors the read-side surface of the
 * renderer-side `ssh-remote:*` IPC handlers.
 *
 * Surface (3 methods — one per route this brief ships):
 *   - `getConfigs()`        → `ssh-remote:getConfigs`
 *   - `getDefaultId()`      → `ssh-remote:getDefaultId`
 *   - `getSshConfigHosts()` → `ssh-remote:getSshConfigHosts`
 *
 * Not ported (deliberately out of scope per design note #5):
 *   - `saveConfig` / `deleteConfig` / `setDefaultId` — config CRUD (writers)
 *   - `test` — needs `ssh` binary + buildSshArgs/parseSSHError extraction
 *
 * Stateless after construction (the settings store handle is held; no
 * mutation, no event subscriptions, no async initialization). Each call
 * reads the live settings store on invocation, matching the renderer-side
 * handler's posture (every IPC call hits `store.get(...)` fresh).
 */
export class SshRemotesManager {
	private settingsStore: SshRemotesSettingsReader;

	constructor(settingsStore: SshRemotesSettingsReader) {
		this.settingsStore = settingsStore;
	}

	/**
	 * Get all SSH remote configurations. Mirrors `ssh-remote:getConfigs`
	 * 1:1 — returns `{ configs }` with the array of `SshRemoteConfig` objects
	 * stored under the `sshRemotes` key. Returns an empty array when the key
	 * is absent (matches the renderer-side default).
	 */
	getConfigs(): { configs: SshRemoteConfig[] } {
		const configs = this.settingsStore.get<SshRemoteConfig[]>('sshRemotes', []);
		return { configs };
	}

	/**
	 * Get the global default SSH remote ID. Mirrors `ssh-remote:getDefaultId`
	 * 1:1 — returns `{ id }` with the stored default id or `null` if not set.
	 */
	getDefaultId(): { id: string | null } {
		const id = this.settingsStore.get<string | null>('defaultSshRemoteId', null);
		return { id };
	}

	/**
	 * Get SSH hosts from `~/.ssh/config`. Mirrors
	 * `ssh-remote:getSshConfigHosts` 1:1 — parses the user's SSH config file
	 * and returns available host entries. Used by `SshRemoteSelector` to
	 * auto-fill connection details from existing SSH configurations.
	 *
	 * Returns the parser's full result envelope (`{ success, hosts,
	 * error?, configPath }`) — the renderer-side IPC reply does the same.
	 */
	getSshConfigHosts(): SshConfigParseResult {
		const result = parseSshConfig();
		if (result.success) {
			console.log(`${LOG_CONTEXT} found ${result.hosts.length} hosts in SSH config`);
		} else {
			console.warn(`${LOG_CONTEXT} failed to parse SSH config: ${result.error}`);
		}
		return result;
	}
}

/* ============ Singleton accessor for the headless server ============ */

let sshRemotesManager: SshRemotesManager | null = null;

/**
 * Get-or-create the singleton SshRemotesManager for the headless server.
 *
 * Matches the `getHistoryManager()` / `getWakaTimeManager()` /
 * `getStatsManager()` / `getFontsManager()` / `getFsManager()` /
 * `getMarketplaceManager()` / `getAgentsManager()` patterns. Takes the
 * settings store as a constructor argument — same shape as
 * `getMarketplaceManager(dataDir, settingsStore)`.
 *
 * The settings store handle is captured on first call. Subsequent calls
 * return the same manager regardless of whether a different store is
 * passed in (matches the renderer-side singleton posture; the test helper
 * `_resetSshRemotesManager()` exists for fixture isolation).
 */
export function getSshRemotesManager(settingsStore: SshRemotesSettingsReader): SshRemotesManager {
	if (!sshRemotesManager) {
		sshRemotesManager = new SshRemotesManager(settingsStore);
	}
	return sshRemotesManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetSshRemotesManager(): void {
	sshRemotesManager = null;
}
