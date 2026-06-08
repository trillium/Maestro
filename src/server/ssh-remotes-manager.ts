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

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';

import type { SshRemoteConfig, SshRemoteTestResult } from '../shared/types';
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
 * Widened in the W3-ssh-remotes-writers follow-up brief to include `.set(key,
 * value)` — needed for `saveConfig` / `deleteConfig` / `setDefaultId`. Reads
 * still use `.get(key, default)` exclusively.
 */
export interface SshRemotesSettingsReader {
	get<V>(key: string, defaultValue: V): V;
	set<V>(key: string, value: V): void;
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

/* ============ Inline execFile shim ============ */

/**
 * Inline `execFileNoThrow` — mirrors the helper in `agents-manager.ts`.
 *
 * `src/main/utils/execFile.ts` is outside `tsconfig.server.json`'s include
 * set, so the headless port re-implements the minimal subset needed for
 * SSH connection-testing: spawn a binary with args, never throw, capture
 * stdout/stderr/exit-code. Matches the renderer-side `execFileNoThrow`
 * signature so a future shared-helper extraction is a drop-in.
 */
const execFileAsync = promisify(execFile);

interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number;
}

async function execFileNoThrow(command: string, args: string[]): Promise<ExecResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			encoding: 'utf-8',
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (err) {
		const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
		return {
			stdout: e.stdout ?? '',
			stderr: e.stderr ?? e.message ?? '',
			exitCode: typeof e.code === 'number' ? e.code : 1,
		};
	}
}

/* ============ SSH validation + arg-building (mirrors src/main/ssh-remote-manager.ts) ============ */

/**
 * Validation result for SSH remote configuration. Field-for-field mirror of
 * `SshRemoteValidation` in `src/main/ssh-remote-manager.ts:16` — the two
 * MUST stay in sync.
 */
export interface SshRemoteValidation {
	valid: boolean;
	errors: string[];
}

/**
 * Default SSH options used for all connections. Mirrors
 * `defaultSshOptions` in `src/main/ssh-remote-manager.ts:65` 1:1.
 *
 * These options ensure non-interactive key-based authentication. Any change
 * here MUST be mirrored in the renderer-side manager (both stacks must agree
 * on the connection contract so cross-mode parity holds).
 */
const DEFAULT_SSH_OPTIONS: Record<string, string> = {
	BatchMode: 'yes',
	StrictHostKeyChecking: 'accept-new',
	ConnectTimeout: '10',
	ClearAllForwardings: 'yes',
	RequestTTY: 'no',
};

/**
 * Validate an SSH remote configuration. Mirrors
 * `SshRemoteManager.validateConfig` in `src/main/ssh-remote-manager.ts:96`
 * 1:1. Checks required fields, port range, and private-key readability.
 *
 * When `useSshConfig` is true, username and privateKeyPath are optional —
 * they may be inherited from `~/.ssh/config`.
 */
export function validateSshRemoteConfig(config: SshRemoteConfig): SshRemoteValidation {
	const errors: string[] = [];

	if (!config.id || config.id.trim() === '') {
		errors.push('Configuration ID is required');
	}
	if (!config.name || config.name.trim() === '') {
		errors.push('Name is required');
	}
	if (!config.host || config.host.trim() === '') {
		errors.push('Host is required');
	}

	// Port validation — required for all configs.
	if (typeof config.port !== 'number' || config.port < 1 || config.port > 65535) {
		errors.push('Port must be between 1 and 65535');
	}

	// Private key file readability (only if a path is provided).
	if (config.privateKeyPath && config.privateKeyPath.trim() !== '') {
		const keyPath = expandTilde(config.privateKeyPath);
		try {
			fs.accessSync(keyPath, fs.constants.R_OK);
		} catch {
			errors.push(`Private key not readable: ${config.privateKeyPath}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}

/**
 * Build SSH command-line arguments for a remote connection. Mirrors
 * `SshRemoteManager.buildSshArgs` in `src/main/ssh-remote-manager.ts:227`
 * 1:1. Any change here MUST be mirrored in the renderer-side manager so
 * cross-mode connection semantics stay identical.
 */
function buildSshArgs(config: SshRemoteConfig): string[] {
	const args: string[] = [];

	// Force-disable TTY allocation (prevents shell rc files from sourcing).
	args.push('-T');

	if (config.privateKeyPath && config.privateKeyPath.trim()) {
		args.push('-i', expandTilde(config.privateKeyPath));
	}

	for (const [key, value] of Object.entries(DEFAULT_SSH_OPTIONS)) {
		args.push('-o', `${key}=${value}`);
	}

	if (!config.useSshConfig || config.port !== 22) {
		args.push('-p', config.port.toString());
	}

	if (config.username && config.username.trim()) {
		args.push(`${config.username}@${config.host}`);
	} else {
		args.push(config.host);
	}

	return args;
}

/**
 * Parse SSH stderr into a user-friendly error message. Mirrors
 * `SshRemoteManager.parseSSHError` in `src/main/ssh-remote-manager.ts:266`
 * 1:1.
 */
function parseSSHError(stderr: string): string | undefined {
	const lowerStderr = stderr.toLowerCase();

	if (lowerStderr.includes('permission denied')) {
		return 'Authentication failed. Check username and private key.';
	}
	if (lowerStderr.includes('connection refused')) {
		return 'Connection refused. Check host and port.';
	}
	if (lowerStderr.includes('connection timed out') || lowerStderr.includes('timed out')) {
		return 'Connection timed out. Check host and network.';
	}
	if (lowerStderr.includes('no route to host')) {
		return 'No route to host. Check host address and network.';
	}
	if (
		lowerStderr.includes('could not resolve hostname') ||
		lowerStderr.includes('name or service not known')
	) {
		return 'Could not resolve hostname. Check the host address.';
	}
	if (lowerStderr.includes('remote host identification has changed')) {
		return 'SSH host key changed. Verify server identity and update known_hosts.';
	}
	if (lowerStderr.includes('passphrase')) {
		return 'Private key has a passphrase. Key-based auth requires passphrase-less keys.';
	}
	if (lowerStderr.includes('no such file')) {
		return 'Private key file not found.';
	}
	if (stderr.trim()) {
		return stderr.trim();
	}
	return undefined;
}

/* ============ SshRemotesManager (server-side) ============ */

/**
 * Server-side SSH remotes manager. Mirrors the FULL surface of the
 * renderer-side `ssh-remote:*` IPC handlers.
 *
 * Surface:
 *   Reads (shipped in W3-ssh-remotes):
 *   - `getConfigs()`         → `ssh-remote:getConfigs`
 *   - `getDefaultId()`       → `ssh-remote:getDefaultId`
 *   - `getSshConfigHosts()`  → `ssh-remote:getSshConfigHosts`
 *
 *   Writers (added in W3-ssh-remotes-writers, audit #12):
 *   - `saveConfig(partial)`  → `ssh-remote:saveConfig`
 *   - `updateConfig(id, u)`  → partial update path (PUT route ergonomic)
 *   - `deleteConfig(id)`     → `ssh-remote:deleteConfig`
 *   - `setDefaultId(id)`     → `ssh-remote:setDefaultId`
 *   - `testConnection(...)`  → `ssh-remote:test`
 *
 * Stateless after construction (the settings store handle is held; each
 * call reads the live store on invocation). Writers persist synchronously
 * via `FileStore.set(...)` — same atomic-rename semantics electron-store
 * provides on the renderer side.
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

	/* ============ Writers (W3-ssh-remotes-writers, audit #12) ============ */

	/**
	 * Save (create or update) an SSH remote configuration. Mirrors
	 * `ssh-remote:saveConfig` in `src/main/ipc/handlers/ssh-remote.ts:92`
	 * 1:1. If `config.id` is provided and exists in the store, updates the
	 * existing entry. Otherwise creates a new entry with a generated UUID.
	 *
	 * Validates the completed config before persisting; throws on
	 * validation failure (the route layer translates this to HTTP 400).
	 */
	saveConfig(partial: Partial<SshRemoteConfig>): { config: SshRemoteConfig } {
		const remotes = this.settingsStore.get<SshRemoteConfig[]>('sshRemotes', []);

		const existingIndex = partial.id ? remotes.findIndex((r) => r.id === partial.id) : -1;
		const isUpdate = existingIndex !== -1;

		// Build the complete config, defaulting fields the renderer-side
		// handler defaults (mirrors `ssh-remote.ts:104-115` 1:1).
		const completeConfig: SshRemoteConfig = {
			id: partial.id || crypto.randomUUID(),
			name: partial.name || 'Unnamed Remote',
			host: partial.host || '',
			port: partial.port ?? 22,
			username: partial.username || '',
			privateKeyPath: partial.privateKeyPath || '',
			remoteEnv: partial.remoteEnv,
			enabled: partial.enabled ?? true,
			useSshConfig: partial.useSshConfig,
			sshConfigHost: partial.sshConfigHost,
		};

		const validation = validateSshRemoteConfig(completeConfig);
		if (!validation.valid) {
			throw new Error(`Invalid configuration: ${validation.errors.join('; ')}`);
		}

		if (isUpdate) {
			remotes[existingIndex] = completeConfig;
			console.log(
				`${LOG_CONTEXT} updated SSH remote "${completeConfig.name}" (${completeConfig.id})`
			);
		} else {
			remotes.push(completeConfig);
			console.log(
				`${LOG_CONTEXT} created SSH remote "${completeConfig.name}" (${completeConfig.id})`
			);
		}

		this.settingsStore.set<SshRemoteConfig[]>('sshRemotes', remotes);

		return { config: completeConfig };
	}

	/**
	 * Partial-update an SSH remote configuration. The renderer-side
	 * handler's `saveConfig` channel covers both create and update under a
	 * single channel; the REST surface separates them for HTTP-idiomatic
	 * verb semantics (`POST` create, `PUT` update). This method reads the
	 * existing config, merges the partial updates, and re-validates before
	 * persisting.
	 *
	 * Throws when the id is not found (the route layer translates to 404).
	 */
	updateConfig(id: string, updates: Partial<SshRemoteConfig>): { config: SshRemoteConfig } {
		const remotes = this.settingsStore.get<SshRemoteConfig[]>('sshRemotes', []);
		const idx = remotes.findIndex((r) => r.id === id);
		if (idx === -1) {
			const err = new Error(`SSH remote not found: ${id}`) as Error & { code?: string };
			err.code = 'NOT_FOUND';
			throw err;
		}

		// Merge — caller-provided fields override; the id field is locked
		// to the path parameter (callers cannot rename an id via PUT).
		const merged: SshRemoteConfig = {
			...remotes[idx],
			...updates,
			id,
		};

		const validation = validateSshRemoteConfig(merged);
		if (!validation.valid) {
			throw new Error(`Invalid configuration: ${validation.errors.join('; ')}`);
		}

		remotes[idx] = merged;
		this.settingsStore.set<SshRemoteConfig[]>('sshRemotes', remotes);
		console.log(`${LOG_CONTEXT} updated SSH remote "${merged.name}" (${id})`);

		return { config: merged };
	}

	/**
	 * Delete an SSH remote configuration by id. Mirrors
	 * `ssh-remote:deleteConfig` in `src/main/ipc/handlers/ssh-remote.ts:151`
	 * 1:1 — also clears `defaultSshRemoteId` if it matches the deleted id
	 * (the renderer-side handler does the same at lines 167-172).
	 *
	 * Throws when the id is not found (the route layer translates to 404).
	 */
	deleteConfig(id: string): { deletedName: string } {
		const remotes = this.settingsStore.get<SshRemoteConfig[]>('sshRemotes', []);
		const index = remotes.findIndex((r) => r.id === id);
		if (index === -1) {
			const err = new Error(`SSH remote not found: ${id}`) as Error & { code?: string };
			err.code = 'NOT_FOUND';
			throw err;
		}

		const deletedName = remotes[index].name;
		remotes.splice(index, 1);
		this.settingsStore.set<SshRemoteConfig[]>('sshRemotes', remotes);

		// Clear default if it pointed at the deleted entry.
		const defaultId = this.settingsStore.get<string | null>('defaultSshRemoteId', null);
		if (defaultId === id) {
			this.settingsStore.set<string | null>('defaultSshRemoteId', null);
			console.log(`${LOG_CONTEXT} cleared default SSH remote (was ${id})`);
		}

		console.log(`${LOG_CONTEXT} deleted SSH remote "${deletedName}" (${id})`);
		return { deletedName };
	}

	/**
	 * Set (or clear) the global default SSH remote id. Mirrors
	 * `ssh-remote:setDefaultId` in `src/main/ipc/handlers/ssh-remote.ts:215`
	 * 1:1 — validates the id exists in the stored configs before persisting
	 * (so callers cannot point the default at a phantom entry).
	 *
	 * Pass `null` to clear the default. Throws when the id is non-null and
	 * not present in the store (route layer translates to 404).
	 */
	setDefaultId(id: string | null): void {
		if (id !== null) {
			const remotes = this.settingsStore.get<SshRemoteConfig[]>('sshRemotes', []);
			const exists = remotes.some((r) => r.id === id);
			if (!exists) {
				const err = new Error(`SSH remote not found: ${id}`) as Error & { code?: string };
				err.code = 'NOT_FOUND';
				throw err;
			}
		}
		this.settingsStore.set<string | null>('defaultSshRemoteId', id);
		console.log(`${LOG_CONTEXT} set default SSH remote to ${id ?? 'none'}`);
	}

	/**
	 * Test an SSH connection. Mirrors `ssh-remote:test` in
	 * `src/main/ipc/handlers/ssh-remote.ts:244` 1:1 — accepts either a
	 * stored config id (string) or a full config object. The route layer
	 * passes either through; this method resolves the id case against the
	 * settings store.
	 *
	 * Spawns the `ssh` binary via the inline `execFileNoThrow` shim above.
	 * The binary must be on PATH at the server's runtime environment —
	 * macOS / Linux both ship it by default; container environments may
	 * need to add it. Returns `{success:false, error:...}` rather than
	 * throwing on connection-test failure so callers can render the error
	 * inline. The wrapping route returns 200 with `result.success=false` —
	 * the test ran but the connection didn't succeed. A 5xx is reserved
	 * for unexpected exceptions in the test plumbing itself.
	 *
	 * `latencyMs` is the wall-clock duration of the spawn → exit cycle,
	 * useful for the connection-tester UI affordance.
	 */
	async testConnection(
		configOrId: string | SshRemoteConfig,
		agentCommand?: string
	): Promise<SshRemoteTestResult & { latencyMs?: number }> {
		let config: SshRemoteConfig;

		if (typeof configOrId === 'string') {
			const remotes = this.settingsStore.get<SshRemoteConfig[]>('sshRemotes', []);
			const found = remotes.find((r) => r.id === configOrId);
			if (!found) {
				const err = new Error(`SSH remote not found: ${configOrId}`) as Error & {
					code?: string;
				};
				err.code = 'NOT_FOUND';
				throw err;
			}
			config = found;
		} else {
			config = configOrId;
		}

		const validation = validateSshRemoteConfig(config);
		if (!validation.valid) {
			return {
				success: false,
				error: validation.errors.join('; '),
			};
		}

		const sshArgs = buildSshArgs(config);

		let testCommand = 'echo "SSH_OK" && hostname';
		if (agentCommand) {
			testCommand += ` && which ${agentCommand} 2>/dev/null || echo "AGENT_NOT_FOUND"`;
		}
		sshArgs.push(testCommand);

		const startedAt = Date.now();
		try {
			const result = await execFileNoThrow('ssh', sshArgs);
			const latencyMs = Date.now() - startedAt;

			if (result.exitCode !== 0) {
				const errorMessage = parseSSHError(result.stderr) || 'Connection failed';
				console.warn(`${LOG_CONTEXT} SSH connection test failed: ${errorMessage}`);
				return { success: false, error: errorMessage, latencyMs };
			}

			const lines = result.stdout.trim().split('\n');
			if (lines[0] !== 'SSH_OK') {
				return {
					success: false,
					error: 'Unexpected response from remote host',
					latencyMs,
				};
			}

			const hostname = lines[1] || 'unknown';
			let agentVersion: string | undefined;
			if (agentCommand && lines[2]) {
				if (lines[2] !== 'AGENT_NOT_FOUND') {
					agentVersion = 'installed';
				}
			}

			console.log(`${LOG_CONTEXT} SSH connection test successful: ${hostname}`);
			return {
				success: true,
				remoteInfo: { hostname, agentVersion },
				latencyMs,
			};
		} catch (err) {
			const latencyMs = Date.now() - startedAt;
			return {
				success: false,
				error: `Connection test failed: ${String(err)}`,
				latencyMs,
			};
		}
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
