/**
 * Dual-mode userData path resolver.
 *
 * Returns the directory where Maestro stores its config/data files.
 *
 * - When running under Electron, uses `app.getPath('userData')` to preserve
 *   the existing on-disk layout (`~/Library/Application Support/maestro` on macOS).
 * - When running as a vanilla Node server (no Electron), respects
 *   `MAESTRO_DATA_DIR`, falling back to `~/.config/maestro`.
 *
 * Lazy-resolved on first call so that importing this module never throws
 * even if `electron` is unavailable.
 */

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

function defaultHeadlessPath(): string {
	return process.env.MAESTRO_DATA_DIR ?? path.join(os.homedir(), '.config', 'maestro');
}

export function getDataDir(): string {
	if (cached !== null) return cached;
	cached = tryElectronUserData() ?? defaultHeadlessPath();
	return cached;
}

export function isHeadless(): boolean {
	return tryElectronUserData() === null;
}
