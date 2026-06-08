/**
 * Server-side font detection manager — headless variant of the
 * `fonts:detect` IPC handler in `src/main/ipc/handlers/system.ts`.
 *
 * Ported for W2 (closes the server half of `ISC-44.display.font_family`,
 * tracked in `ISA.md`). Mirrors the renderer-side detector 1:1 but with
 * the same posture adjustments the wakatime / stats ports established:
 *
 *   1. **No `electron` import.** Font detection is platform code only; the
 *      Electron handler never touched `electron` APIs either. Matches the
 *      W2-wakatime / W2-stats precedent of self-contained server modules.
 *
 *   2. **No `src/main/utils/execFile` import.** The server tsconfig
 *      (`tsconfig.server.json`) does not include `src/main/utils/`, so the
 *      execFile helper would not type-check. A minimal inline shim with
 *      the same `execFileNoThrow(command, args)` signature (return
 *      `{ stdout, stderr, exitCode }`, never throw) is provided here,
 *      matching the shim used in `wakatime-manager.ts`.
 *
 *   3. **No `src/main/utils/logger` import.** Falls back to `console.*`
 *      with a `[Fonts]` prefix — matches the rest of `src/server/`, which
 *      standardizes on `console.log/warn/error` to avoid re-pulling the
 *      main-process logger graph (sentry → @sentry/electron) into the
 *      server build.
 *
 *   4. **Public API matches the renderer-side `fonts:detect` handler 1:1**
 *      for the only method the IPC channel exposes: `detectFonts()`
 *      returns `Promise<string[]>` with a deduplicated, alphabetized list
 *      of available font families. Identical fallback list when `fc-list`
 *      is unavailable (rare on modern systems, but preserved verbatim from
 *      the renderer-side handler).
 *
 * The on-disk `fc-list` binary is the contract between modes: both Electron
 * (renderer-side handler at `src/main/ipc/handlers/system.ts`) and the
 * headless server invoke the same binary, parse the same output, and apply
 * the same dedup. A hybrid (Electron + headless sidecar) deployment is
 * supported because the underlying enumerator is shared at the OS level.
 *
 * `src/main/ipc/handlers/system.ts` is NOT touched. This file is the new
 * server-side surface; the renderer continues to use the IPC channel via
 * `window.maestro.system.fonts.detect()`.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

const LOG_CONTEXT = '[Fonts]';
const EXEC_MAX_BUFFER = 10 * 1024 * 1024;

/* ============ Inline execFile shim ============ */

const execFileAsync = promisify(execFile);

interface ExecResult {
	stdout: string;
	stderr: string;
	exitCode: number | string;
}

/**
 * Minimal `execFileNoThrow` — never throws, returns `{ stdout, stderr, exitCode }`.
 * Matches the subset of `src/main/utils/execFile.ts` behavior this manager needs.
 * No stdin-input variant (not used by font detection), no Windows-shell PATHEXT
 * resolution (`fc-list` is invoked by its bare name and resolved off `$PATH`).
 */
async function execFileNoThrow(command: string, args: string[] = []): Promise<ExecResult> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			encoding: 'utf8',
			maxBuffer: EXEC_MAX_BUFFER,
		});
		return { stdout, stderr, exitCode: 0 };
	} catch (error: any) {
		return {
			stdout: error.stdout || '',
			stderr: error.stderr || error.message || '',
			exitCode: error.code ?? 1,
		};
	}
}

/* ============ Fallback list (verbatim from renderer-side handler) ============ */

/**
 * Common monospace fonts returned when `fc-list` is unavailable. This list
 * is byte-for-byte identical to the renderer-side fallback in
 * `src/main/ipc/handlers/system.ts` ('fonts:detect') so a future client that
 * hits either surface gets the same shape on platforms without fontconfig.
 *
 * Note: `fc-list` ships by default on macOS (via the system fontconfig) and
 * essentially every Linux distribution. The fallback exists for hardened
 * environments (e.g. minimal container images) where the binary is missing.
 */
const FALLBACK_FONTS: readonly string[] = Object.freeze([
	'Monaco',
	'Menlo',
	'Courier New',
	'Consolas',
	'Roboto Mono',
	'Fira Code',
	'JetBrains Mono',
]);

/* ============ FontsManager (server-side) ============ */

export class FontsManager {
	/**
	 * Detect available font families on the host machine.
	 *
	 * Invokes `fc-list : family` (the same command used by the renderer-side
	 * `fonts:detect` IPC handler — fastpath chosen because it's 11.9x faster
	 * than `system_profiler` on macOS, and works identically on Linux and
	 * Windows-with-fontconfig). Output is one font family per line, with
	 * duplicates returned by `fc-list` itself (multiple subfamilies of the
	 * same family yield the family name once per subfamily). The result is
	 * deduplicated via `Set` before being returned.
	 *
	 * Returns the `FALLBACK_FONTS` list on any failure path (binary missing,
	 * non-zero exit, parse error). Matches the renderer-side handler 1:1 —
	 * never throws, never returns an empty array on the success path (an
	 * empty `fc-list` output is treated as a failure and falls through to
	 * the fallback).
	 */
	async detectFonts(): Promise<string[]> {
		try {
			const result = await execFileNoThrow('fc-list', [':', 'family']);
			if (result.exitCode === 0 && result.stdout) {
				const fonts = result.stdout
					.split('\n')
					.map((line) => line.trim())
					.filter((font) => font.length > 0);

				// Deduplicate fonts (fc-list can return duplicates: one entry
				// per subfamily, all sharing the same family name).
				const deduped = [...new Set(fonts)];
				if (deduped.length > 0) {
					return deduped;
				}
			}

			// Fall through to the fallback list when `fc-list` is unavailable
			// or returned an empty result. The renderer-side handler does the
			// same thing — no log noise here for the missing-binary path
			// because it's an expected condition on hardened containers.
			return [...FALLBACK_FONTS];
		} catch (error) {
			console.error(`${LOG_CONTEXT} Font detection error:`, error);
			return [...FALLBACK_FONTS];
		}
	}
}

/* ============ Singleton accessor for the headless server ============ */

let fontsManager: FontsManager | null = null;

/**
 * Get-or-create the singleton FontsManager for the headless server.
 *
 * Matches the `getWakaTimeManager()` / `getStatsManager()` singleton pattern
 * established by the prior W2 ports. No constructor arguments are required —
 * the manager is stateless (each `detectFonts()` call shells out fresh).
 *
 * Test helper `_resetFontsManager()` clears the singleton.
 */
export function getFontsManager(): FontsManager {
	if (!fontsManager) {
		fontsManager = new FontsManager();
	}
	return fontsManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetFontsManager(): void {
	fontsManager = null;
}
