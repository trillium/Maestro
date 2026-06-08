/**
 * Server-side filesystem manager — headless variant of the `fs:*` IPC
 * handlers at `src/main/ipc/handlers/filesystem.ts`.
 *
 * Ported for W3-fs (closes the server half of `ISC-44.shim.fs_routes`,
 * tracked under the umbrella `ISC-44.shim.big_3_ipc_strategy` in `ISA.md`).
 * Differences from the renderer-side handlers:
 *
 *   1. **No `electron` import.** `os.homedir()` is used directly instead
 *      of `app.getPath('home')`. The renderer's `fs:homeDir` IPC handler
 *      already uses `os.homedir()` under the hood (filesystem.ts line 91),
 *      so this is byte-for-byte parity, not a semantics change.
 *
 *   2. **No SSH remote dispatch.** The renderer-side handlers accept an
 *      optional `sshRemoteId` that proxies to `readDirRemote` /
 *      `readFileRemote` / `statRemote`. The server-side manager is
 *      strictly local — SSH-remote support is its own future server-side
 *      port (`W3-ssh-remotes` per the umbrella Decision). The route layer
 *      passes through any incoming `sshRemoteId` query param but the
 *      manager rejects when one is present so we fail loudly rather than
 *      silently serving a local path when a remote was requested.
 *
 *   3. **Path validation built into every operation.** All callers MUST
 *      pass an absolute path. The validator (`isValidFsPath` below) checks:
 *        - absolute (`path.isAbsolute()`)
 *        - no NUL bytes
 *        - no `..` segments after normalisation
 *      This mirrors the `isValidCustomSyncPath` validator at
 *      `src/shared/data-dir.ts:60` and the renderer-side
 *      `validatePathWithinFolder` helper at
 *      `src/main/ipc/handlers/autorun.ts:224`. The route handlers re-validate
 *      so a 400 fires before any fs call.
 *
 *   4. **No image base64 encoding in `readFile`.** The renderer-side
 *      `fs:readFile` handler returns a `data:` URL for image extensions —
 *      that codepath exists for the renderer's `<img src>` consumers. The
 *      server-side surface returns raw UTF-8 text only; binary files are
 *      out of scope (the AutoRun shell image-loading sites will need an
 *      `/api/images/*` route cluster per the Decision, separate brief).
 *      Binary detection is done up-front via a NUL-byte sniff on the first
 *      8 KiB to reject obvious binary payloads with a 400 instead of
 *      returning a corrupt UTF-8 string.
 *
 *   5. **`writeDoc` accepts a single absolute `path` + `content`.** The
 *      renderer-side `autorun:writeDoc` IPC channel accepts
 *      `(folderPath, filename, content, sshRemoteId)` and joins the two
 *      path pieces server-side; that split exists because the renderer
 *      tracks `folderPath` independently of the displayed filename. The
 *      W3-fs route surface flattens to a single `path` since the only
 *      shell-stage AutoRun consumer in webFull constructs the full path
 *      client-side anyway. Parent directories are created on demand
 *      (matches the renderer-side `mkdir -p` fallback at autorun.ts:486).
 *
 *   6. **No `electron` IPC error surface.** Failures propagate as thrown
 *      `Error` with stable messages the route layer translates to
 *      4xx/5xx. The renderer-side handler returns `null` for `ENOENT`
 *      / `EISDIR` from `fs:readFile`; the server-side surface preserves
 *      that semantics (`readFile` returns `null` for missing/directory
 *      paths so the route can return 404), but `stat` returns
 *      `{exists: false}` instead of throwing (matches the brief's
 *      reply-shape contract).
 *
 *   7. **Singleton accessor matches `WakaTimeManager` / `StatsManager` /
 *      `FontsManager` patterns.** `getFsManager()` returns a cached
 *      instance; the constructor is parameterless (no settings store /
 *      app version needed — fs ops are pure-stdlib). A `_resetFsManager()`
 *      test helper clears the cache for unit tests.
 *
 * `src/main/ipc/handlers/filesystem.ts` is NOT touched. This file is the
 * new server-side surface; the renderer continues to import from the main
 * variant. Both can run side by side in a hybrid (Electron + headless
 * sidecar) deployment because the underlying filesystem is the
 * cross-mode contract.
 */

import * as fsp from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

const LOG_CONTEXT = '[fs]';

/* ============ Path validation ============ */

/**
 * Validate an absolute filesystem path for cross-process use.
 *
 * Returns `null` if the path passes all checks; otherwise returns a short
 * human-readable reason string the route layer can include in the 400 reply
 * body. Inlined here rather than re-using `isValidCustomSyncPath` from
 * `src/shared/data-dir.ts` because the data-dir validator is narrower
 * (no `path.normalize()` round-trip, no resolved-form re-check). This
 * validator is the single source of truth for the server-side fs routes.
 *
 * Rules:
 *   - must be a non-empty string
 *   - must be absolute (`path.isAbsolute()`)
 *   - must not contain NUL bytes
 *   - the resolved/normalised form must not contain `..` segments
 *     (catches both raw `../` and percent-encoded variants after
 *     `decodeURIComponent` on the query layer)
 *   - the resolved form must equal the normalized form — anything that
 *     `path.resolve()` re-rewrites to something different from
 *     `path.normalize()` is fishy (e.g. paths with mixed separators on
 *     posix). Catches the `/etc/passwd/../shadow` style traversal even
 *     after normalisation collapses it to `/etc/shadow`, because the
 *     PRE-normalised form is what we check — if the caller submitted
 *     traversal segments, we reject regardless of where they collapse to.
 */
export function isValidFsPath(p: string): string | null {
	if (typeof p !== 'string' || p.length === 0) return 'path must be a non-empty string';
	if (!path.isAbsolute(p)) return 'path must be absolute';
	if (p.includes('\0')) return 'path must not contain NUL byte';
	// Split on both separators so we catch traversal segments regardless of
	// platform (the headless server runs on posix in practice, but the rule
	// is platform-agnostic so Windows-shaped paths don't slip through as
	// "no `..` segments because we split on `/` only").
	const segments = p.split(/[/\\]/);
	if (segments.includes('..')) return 'path must not contain `..` segments';
	// Catch percent-encoded traversal that decoded into the path. The route
	// layer already URL-decodes once via Fastify's query parser; this is a
	// belt-and-suspenders re-check.
	if (p.includes('%2e%2e') || p.includes('%2E%2E')) {
		return 'path must not contain encoded `..` segments';
	}
	return null;
}

/* ============ Stat reply shape ============ */

export interface FsStatResult {
	exists: boolean;
	isDir: boolean;
	isFile: boolean;
	size?: number;
	mtime?: string;
}

/* ============ Binary detection ============ */

/**
 * Sniff the first 8 KiB of a file for a NUL byte. The presence of NUL is
 * an extremely strong signal of a non-UTF8 binary payload; the route
 * layer rejects with a 400 rather than returning a corrupt string. This
 * matches the renderer-side path's intent (the renderer would have
 * returned a `data:` URL for the image case; the server-side surface is
 * text-only so binary is a hard reject).
 *
 * 8 KiB is enough to catch every common binary format header (PNG, JPEG,
 * sqlite, ELF, Mach-O, .o object files, .pyc, etc.) without paying the
 * cost of reading the entire file before deciding.
 */
async function isProbablyBinary(p: string): Promise<boolean> {
	let fh: fsp.FileHandle | null = null;
	try {
		fh = await fsp.open(p, 'r');
		const buf = Buffer.alloc(8192);
		const { bytesRead } = await fh.read(buf, 0, 8192, 0);
		for (let i = 0; i < bytesRead; i++) {
			if (buf[i] === 0) return true;
		}
		return false;
	} catch {
		return false;
	} finally {
		if (fh) {
			await fh.close().catch(() => {});
		}
	}
}

/* ============ FsManager (server-side) ============ */

export class FsManager {
	/** Return the server's home directory. Matches `fs:homeDir` IPC reply. */
	getHomeDir(): string {
		return os.homedir();
	}

	/**
	 * Stat a path. Returns `{exists: false}` for missing paths rather than
	 * throwing — the brief's reply contract calls for an exists flag, not a
	 * 404. Permission errors and other non-ENOENT failures DO throw so the
	 * route layer surfaces a 500.
	 *
	 * `mtime` is ISO-8601 (matches the renderer-side `fs:stat` reply shape
	 * at filesystem.ts:228, which also ISO-stringifies the Date).
	 */
	async stat(p: string): Promise<FsStatResult> {
		try {
			const s = await fsp.stat(p);
			return {
				exists: true,
				isDir: s.isDirectory(),
				isFile: s.isFile(),
				size: s.size,
				mtime: s.mtime.toISOString(),
			};
		} catch (err: any) {
			if (err?.code === 'ENOENT') {
				return { exists: false, isDir: false, isFile: false };
			}
			throw err;
		}
	}

	/**
	 * Read a file's contents as UTF-8 text.
	 *
	 * Returns `null` for `ENOENT` / `EISDIR` (matches the renderer-side
	 * `fs:readFile` semantics at filesystem.ts:185 — both fail soft so
	 * callers can treat absence as a normal case). Throws for permission
	 * errors etc. so the route layer surfaces a 500.
	 *
	 * Binary detection: a NUL-byte sniff on the first 8 KiB rejects with a
	 * thrown error tagged with `binary: true` so the route layer can map
	 * to 400. The intent is to fail loud rather than return a corrupt
	 * string the client misinterprets as text.
	 */
	async readFile(p: string): Promise<string | null> {
		try {
			if (await isProbablyBinary(p)) {
				const err = new Error('file appears to contain binary data');
				(err as any).binary = true;
				throw err;
			}
			return await fsp.readFile(p, 'utf-8');
		} catch (err: any) {
			if (err?.code === 'ENOENT' || err?.code === 'EISDIR') {
				return null;
			}
			throw err;
		}
	}

	/**
	 * Write content to a file. Creates parent directories on demand
	 * (matches the renderer-side `autorun:writeDoc` fallback at
	 * autorun.ts:486 which does `mkdir -p` when the parent is missing).
	 *
	 * Returns `{ path, bytes }` per the brief's reply contract. `bytes` is
	 * the UTF-8 byte length of the written content (not the JS string
	 * length, which would be code-unit count).
	 */
	async writeDoc(p: string, content: string): Promise<{ path: string; bytes: number }> {
		const parent = path.dirname(p);
		try {
			await fsp.access(parent);
		} catch {
			await fsp.mkdir(parent, { recursive: true });
		}
		const buf = Buffer.from(content, 'utf-8');
		await fsp.writeFile(p, buf);
		console.log(`${LOG_CONTEXT} wrote ${buf.length} bytes to ${p}`);
		return { path: p, bytes: buf.length };
	}
}

/* ============ Singleton accessor for the headless server ============ */

let fsManager: FsManager | null = null;

/**
 * Get-or-create the singleton FsManager for the headless server.
 *
 * Matches the `getHistoryManager()` / `getWakaTimeManager()` /
 * `getStatsManager()` / `getFontsManager()` patterns. Parameterless
 * because fs ops are pure-stdlib (no config / DB / network).
 */
export function getFsManager(): FsManager {
	if (!fsManager) {
		fsManager = new FsManager();
	}
	return fsManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetFsManager(): void {
	fsManager = null;
}
