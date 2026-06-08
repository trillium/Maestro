/**
 * Dual-mode userData path resolver.
 *
 * Returns the directory where Maestro stores its config/data files.
 *
 * Resolution order in headless mode (precedence high → low):
 *   1. `MAESTRO_DATA_DIR` env var — explicit override, wins over everything.
 *   2. `customSyncPath` field in `maestro-bootstrap.json` at the userData
 *      default (`~/.config/maestro/maestro-bootstrap.json`) — mirrors the
 *      Electron-side `getCustomSyncPath(_bootstrapStore)` logic at
 *      `src/main/stores/instances.ts:86` so a desktop user who has
 *      configured a custom sync directory in Electron mode does not have
 *      the headless server silently fall back to defaults.
 *   3. `~/.config/maestro` — final fallback.
 *
 * Under Electron, defers to `app.getPath('userData')` so the existing
 * on-disk layout is preserved (`~/Library/Application Support/maestro` on
 * macOS). Electron's own bootstrap-reading + sync-path logic in
 * `src/main/stores/instances.ts` continues to govern that mode unchanged.
 *
 * Lazy-resolved on first call so that importing this module never throws
 * even if `electron` is unavailable. The `customSyncPath` JSON read is a
 * single best-effort `fs.readFileSync`; any error (file missing, malformed
 * JSON, missing field, validation failure) falls through to the default
 * silently — matching the Electron-side `getCustomSyncPath()` behavior
 * which also returns `undefined` on any failure to validate.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

let cached: string | null = null;

function tryElectronUserData(): string | null {
	try {
		const electron = require('electron');
		if (electron && electron.app && typeof electron.app.getPath === 'function') {
			return electron.app.getPath('userData') as string;
		}
	} catch {
		// electron not available — running headless
	}
	return null;
}

/**
 * Minimal mirror of `isValidSyncPath` from `src/main/stores/utils.ts`.
 *
 * Inlined here (rather than imported) to keep this module
 * dependency-light: `src/main/stores/utils.ts` pulls in `electron-store`
 * via its other exports, which would defeat the whole headless story.
 * Kept narrow on purpose — only the path-shape checks that materially
 * protect against catastrophic misconfiguration. The Electron-side
 * validator does the full check (Windows reserved names, sensitive
 * system directories, etc.) before the value ever lands in
 * `maestro-bootstrap.json`, so this read-side validator is a
 * second-line defense for absolute / traversal / null-byte issues.
 */
function isValidCustomSyncPath(customPath: string): boolean {
	if (typeof customPath !== 'string' || customPath.length === 0) return false;
	if (!path.isAbsolute(customPath)) return false;
	if (customPath.includes('\0')) return false;
	const segments = customPath.split(/[/\\]/);
	if (segments.includes('..')) return false;
	return true;
}

/**
 * Read `customSyncPath` from `<userDataDir>/maestro-bootstrap.json`.
 * Returns the path string if present, absolute, and passes the minimal
 * validator; `null` on any failure (file missing, parse error, field
 * missing, validation failure).
 *
 * Mirrors `getCustomSyncPath(_bootstrapStore)` in
 * `src/main/stores/instances.ts:86` — both produce the same effective
 * sync path from the same on-disk bootstrap file, just through different
 * readers (electron-store vs. raw fs).
 */
function readBootstrapCustomSyncPath(userDataDir: string): string | null {
	try {
		const bootstrapPath = path.join(userDataDir, 'maestro-bootstrap.json');
		const raw = fs.readFileSync(bootstrapPath, 'utf-8');
		const parsed = JSON.parse(raw) as { customSyncPath?: unknown };
		const candidate = parsed.customSyncPath;
		if (typeof candidate !== 'string') return null;
		if (!isValidCustomSyncPath(candidate)) return null;
		return candidate;
	} catch {
		return null;
	}
}

function defaultHeadlessPath(): string {
	// 1. Explicit env-var override wins absolutely.
	if (process.env.MAESTRO_DATA_DIR) {
		return process.env.MAESTRO_DATA_DIR;
	}

	// 2. Bootstrap-recorded customSyncPath (set via the Electron-side
	// Settings UI) wins over the default. Bootstrap file lives at the
	// userData default, even when the syncPath is elsewhere.
	const defaultUserData = path.join(os.homedir(), '.config', 'maestro');
	const customSyncPath = readBootstrapCustomSyncPath(defaultUserData);
	if (customSyncPath) {
		return customSyncPath;
	}

	// 3. Final fallback — the default headless userData.
	return defaultUserData;
}

export function getDataDir(): string {
	if (cached !== null) return cached;
	cached = tryElectronUserData() ?? defaultHeadlessPath();
	return cached;
}

export function isHeadless(): boolean {
	return tryElectronUserData() === null;
}

/**
 * Test-only: reset the cached value so subsequent `getDataDir()` calls
 * re-resolve. Used by the smoke probe documented in `ISA.md` under
 * Verification §2026-06-08 — customSyncPath bootstrap check.
 *
 * Not part of the runtime contract — production code paths call
 * `getDataDir()` once at boot and rely on the cached result.
 */
export function __resetCacheForTesting(): void {
	cached = null;
}
