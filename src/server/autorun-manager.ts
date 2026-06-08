/**
 * Server-side Auto Run image manager — headless variant of the image-handling
 * subset of the `autorun:*` IPC handlers at `src/main/ipc/handlers/autorun.ts`
 * (specifically `autorun:saveImage`, `autorun:deleteImage`, `autorun:listImages`
 * at lines 501-752).
 *
 * Ported for W3-autorun-images (closes the server half of
 * `ISC-44.shim.autorun_images_routes`, tracked in `ISA.md` under the umbrella
 * `ISC-44.shim.big_3_ipc_strategy`). This is the last gap blocking the AutoRun
 * lift: the AutoRun shell's `useAutoRunImageHandling` hook
 * (`src/renderer/hooks/batch/useAutoRunImageHandling.ts`) calls
 * `window.maestro.autorun.{listImages,saveImage,deleteImage}` at three sites
 * — paste-image (line 278), file-upload (line 368), and remove-attachment
 * (line 419 + the lightbox-delete site at 484). Without server-side equivalents,
 * the hook compiled but no-op'd in webFull. The AutoRun lift STOPPED here.
 *
 * Differences from the renderer-side handlers match the posture established by
 * the W2-wakatime / W3-fs / W3-marketplace ports:
 *
 *   1. **No `electron` import.** No `ipcMain.handle`, no `BrowserWindow`,
 *      no `app.getPath()`. The handlers in autorun.ts depend on those for IPC
 *      registration + dialog access; the server-side surface is plain method
 *      calls invoked by the Fastify route handlers in `apiRoutes.ts`.
 *
 *   2. **No SSH remote dispatch.** The renderer-side handlers accept an
 *      optional `sshRemoteId` that proxies to `writeFileRemote` /
 *      `deleteRemote` / `readDirRemote`. The server-side manager is strictly
 *      local — SSH-remote support is its own future server-side port
 *      (`W3-ssh-remotes` per the umbrella Decision). The route layer rejects
 *      `?sshRemoteId=` with 501 so we fail loudly rather than silently
 *      serving a local path when a remote was requested. Matches the W3-fs
 *      precedent at `src/server/fs-manager.ts` header note #2.
 *
 *   3. **No `src/main/utils/logger` import.** Falls back to `console.*`
 *      with a `[Autorun]` prefix — matches the rest of `src/server/`.
 *
 *   4. **No `createIpcHandler` envelope.** The renderer-side handlers wrap
 *      each IPC call in `createIpcHandler(opts, fn)` for unified
 *      `{success: true, ...result}` envelopes; the server-side surface
 *      returns plain success-path payloads matching the renderer-side
 *      success-path shape, and the route handlers in `apiRoutes.ts`
 *      translate exceptions to the standard `{ error, message, timestamp }`
 *      reply shape.
 *
 *   5. **Path validation lives in BOTH the route layer and the manager**
 *      (defense-in-depth). All callers MUST pass an absolute `folderPath`
 *      with no `..` segments and no NUL bytes. `docName` / `docFilename` is
 *      sanitized via `path.basename()` + strict character whitelist to
 *      prevent directory traversal in the filename component. `extension`
 *      is checked against a fixed allowlist (png, jpg, jpeg, gif, webp,
 *      svg). `relativePath` for delete must start with `images/` and must
 *      not include `..` segments. Belt-and-suspenders re-validation in the
 *      manager matches the renderer-side autorun.ts:515-525 / 600-608 /
 *      664-667 checks.
 *
 *   6. **Public API matches the renderer-side IPC reply shapes 1:1** for
 *      the three methods the REST routes call:
 *        - `saveImage(folderPath, docFilename, dataUrl, extension)` returns
 *          `{ filename, relativePath }`. The dataUrl is decoded server-side
 *          (so the wire format matches what the AutoRun paste/upload sites
 *          already produce — a `data:image/...;base64,...` URL).
 *        - `deleteImage(folderPath, relativePath)` returns `{ removed: bool }`.
 *          The renderer-side handler returns `{}` (the createIpcHandler
 *          envelope adds `success: true`); we surface the boolean explicitly
 *          for the route reply shape per the brief.
 *        - `listImages(folderPath, docFilename)` returns
 *          `{ images: Array<{filename, relativePath, sizeBytes, modifiedAt}> }`.
 *          The renderer-side handler returns
 *          `{ images: [{filename, relativePath}] }`; we additionally surface
 *          `sizeBytes` + `modifiedAt` from `fs.stat()` per the brief's
 *          reply contract (the AutoRun shell will use these for sort /
 *          cache-bust affordances once the lift continues).
 *
 *   7. **Singleton accessor matches `FsManager` / `WakaTimeManager` /
 *      `FontsManager` patterns.** `getAutorunManager()` returns a cached
 *      instance; the constructor is parameterless (image ops are pure-stdlib,
 *      no config / DB / network). A `_resetAutorunManager()` test helper
 *      clears the cache for unit tests.
 *
 * `src/main/ipc/handlers/autorun.ts` is NOT touched. This file is the new
 * server-side surface; the renderer continues to import from the main
 * variant. Both can run side by side in a hybrid (Electron + headless
 * sidecar) deployment because the underlying filesystem layout
 * (`<folderPath>/images/{docName}-{timestamp}.{ext}`) is the cross-mode
 * contract.
 */

import * as fsp from 'fs/promises';
import * as path from 'path';

const LOG_CONTEXT = '[Autorun]';

const ALLOWED_IMAGE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'] as const;
type AllowedImageExtension = (typeof ALLOWED_IMAGE_EXTENSIONS)[number];

/* ============ Path / name validation ============ */

/**
 * Validate an absolute folderPath for cross-process use. Returns a short
 * human-readable reason on failure; null on success. Mirrors the
 * `isValidFsPath()` validator in `src/server/fs-manager.ts` 1:1 so the two
 * stay in sync.
 */
export function isValidAutorunFolderPath(p: string): string | null {
	if (typeof p !== 'string' || p.length === 0) return 'folderPath must be a non-empty string';
	if (!path.isAbsolute(p)) return 'folderPath must be absolute';
	if (p.includes('\0')) return 'folderPath must not contain NUL byte';
	const segments = p.split(/[/\\]/);
	if (segments.includes('..')) return 'folderPath must not contain `..` segments';
	if (p.includes('%2e%2e') || p.includes('%2E%2E')) {
		return 'folderPath must not contain encoded `..` segments';
	}
	return null;
}

/**
 * Sanitize a document filename to the doc-name component used for image
 * naming. Strips a trailing `.md` (case-insensitive), rejects path
 * separators, NUL bytes, and `..` segments. Mirrors the renderer-side
 * autorun.ts:515-518 check.
 *
 * Returns either the sanitized stem (no extension) or a short reason on
 * failure. The strict-character-whitelist re-check (`/^[\w.\- ]+$/`) is
 * additive defense — the renderer-side handler doesn't do that explicitly
 * but its filename insertion into `{stem}-{timestamp}.{ext}` would produce
 * a broken filesystem entry on any character we wouldn't accept anyway.
 */
export function sanitizeDocName(docName: string): { stem: string } | { error: string } {
	if (typeof docName !== 'string' || docName.length === 0) {
		return { error: 'docFilename must be a non-empty string' };
	}
	if (docName.includes('\0')) return { error: 'docFilename must not contain NUL byte' };
	const basename = path.basename(docName).replace(/\.md$/i, '');
	if (basename.length === 0) return { error: 'docFilename must not be empty after sanitization' };
	if (basename.includes('..') || basename.includes('/') || basename.includes('\\')) {
		return { error: 'docFilename must not contain path separators or `..`' };
	}
	if (!/^[\w.\- ]+$/.test(basename)) {
		return { error: 'docFilename contains characters outside the allowlist (\\w, ., -, space)' };
	}
	return { stem: basename };
}

/**
 * Validate an image extension against the fixed allowlist. The renderer-side
 * autorun.ts:521-525 has the same allowlist; we duplicate it here so a typo
 * in one place doesn't silently expand the surface.
 */
export function sanitizeExtension(extension: string): AllowedImageExtension | null {
	if (typeof extension !== 'string') return null;
	const cleaned = extension
		.toLowerCase()
		.replace(/^\./, '')
		.replace(/[^a-z]/g, '');
	if ((ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(cleaned)) {
		return cleaned as AllowedImageExtension;
	}
	return null;
}

/**
 * Validate the `relativePath` for delete-image. The renderer-side
 * autorun.ts:599-608 requires the path to be normalized, non-absolute, and
 * start with `images/`. We re-implement the same rule here.
 */
export function isValidImageRelativePath(relativePath: string): string | null {
	if (typeof relativePath !== 'string' || relativePath.length === 0) {
		return 'relativePath must be a non-empty string';
	}
	if (relativePath.includes('\0')) return 'relativePath must not contain NUL byte';
	const normalized = path.normalize(relativePath);
	const posix = normalized.replace(/\\/g, '/');
	if (normalized.includes('..')) return 'relativePath must not contain `..` segments';
	if (path.isAbsolute(normalized)) return 'relativePath must be relative';
	if (!posix.startsWith('images/')) return 'relativePath must start with `images/`';
	// Belt-and-suspenders: the filename portion must not contain path separators
	// after the `images/` prefix (i.e. flat under `images/`, no nested dirs).
	const remainder = posix.slice('images/'.length);
	if (remainder.length === 0) return 'relativePath must include an image filename after `images/`';
	if (remainder.includes('/') || remainder.includes('\\')) {
		return 'relativePath must not include nested directories under `images/`';
	}
	return null;
}

/* ============ dataUrl decoding ============ */

/**
 * Decode a `data:image/<ext>;base64,<payload>` URL into a Buffer. The
 * AutoRun paste/upload sites in
 * `src/renderer/hooks/batch/useAutoRunImageHandling.ts:267-274` already
 * produce this shape via `FileReader.readAsDataURL()`. We accept either the
 * full data URL or the bare base64 payload — same as the renderer-side
 * handler which strips the prefix on the caller side and passes only the
 * base64 payload through the IPC channel.
 *
 * Returns the decoded Buffer or a short reason on failure.
 */
export function decodeImageDataUrl(dataUrl: string): { buffer: Buffer } | { error: string } {
	if (typeof dataUrl !== 'string' || dataUrl.length === 0) {
		return { error: 'dataUrl must be a non-empty string' };
	}
	let payload = dataUrl;
	const match = dataUrl.match(/^data:[a-z]+\/[a-z0-9+.-]+(?:;[^,]+)?,(.*)$/i);
	if (match) {
		payload = match[1];
	}
	// `base64,` prefix the spec sometimes inlines without the full data URL
	// shape (e.g. `base64,iVBORw0...`) — strip it defensively.
	payload = payload.replace(/^base64,/i, '');
	// `Buffer.from(..., 'base64')` is permissive — it tolerates whitespace
	// but silently drops invalid chars. We do a structural check on the
	// remaining string to fail fast on obvious garbage.
	if (!/^[A-Za-z0-9+/=\r\n\t ]*$/.test(payload)) {
		return { error: 'dataUrl payload contains characters outside the base64 alphabet' };
	}
	try {
		const buffer = Buffer.from(payload, 'base64');
		if (buffer.length === 0) {
			return { error: 'dataUrl payload decoded to zero bytes' };
		}
		return { buffer };
	} catch (err: any) {
		return { error: `failed to decode dataUrl: ${err?.message ?? String(err)}` };
	}
}

/* ============ Reply shapes ============ */

export interface SaveImageResult {
	filename: string;
	relativePath: string;
}

export interface DeleteImageResult {
	removed: boolean;
}

export interface ListedImage {
	filename: string;
	relativePath: string;
	sizeBytes: number;
	modifiedAt: string;
}

export interface ListImagesResult {
	images: ListedImage[];
}

export interface DeleteFolderResult {
	removed: boolean;
}

/**
 * The literal AutoRun Docs folder name — must match
 * `AUTO_RUN_FOLDER_NAME` at `src/renderer/utils/existingDocsDetector.ts:11` and
 * the IPC handler's safety check at `src/main/ipc/handlers/autorun.ts:786`.
 * Inlined here (rather than imported from the renderer tree) because
 * `src/server/` deliberately does not depend on `src/renderer/`.
 */
const AUTO_RUN_FOLDER_NAME = 'Auto Run Docs';

/* ============ AutorunManager (server-side) ============ */

export class AutorunManager {
	/**
	 * Save an image alongside a document. Generates the filename
	 * `{docStem}-{timestamp}.{ext}` (matches the renderer-side autorun.ts:528-529
	 * 1:1) and writes it under `<folderPath>/images/`.
	 *
	 * The renderer-side handler accepts the base64 payload WITHOUT the
	 * `data:image/...;base64,` prefix (the AutoRun shell strips it at
	 * `useAutoRunImageHandling.ts:274` before the IPC call). The server-side
	 * variant accepts EITHER the bare payload or the full data URL — the
	 * decoder handles both — so a future webFull caller can pass the
	 * FileReader result directly without manual stripping. The brief's
	 * reply contract is `{ filename, relativePath }`; we surface both
	 * fields for caller convenience (the AutoRun shell uses `relativePath`
	 * to write the markdown reference, and `filename` for the lightbox
	 * navigation map).
	 */
	async saveImage(
		folderPath: string,
		docFilename: string,
		dataUrl: string,
		extension: string
	): Promise<SaveImageResult> {
		const folderReason = isValidAutorunFolderPath(folderPath);
		if (folderReason) throw new Error(folderReason);

		const stemResult = sanitizeDocName(docFilename);
		if ('error' in stemResult) throw new Error(stemResult.error);

		const ext = sanitizeExtension(extension);
		if (!ext) {
			throw new Error(
				`extension must be one of ${ALLOWED_IMAGE_EXTENSIONS.join(', ')} (got ${JSON.stringify(extension)})`
			);
		}

		const decoded = decodeImageDataUrl(dataUrl);
		if ('error' in decoded) throw new Error(decoded.error);

		const timestamp = Date.now();
		const filename = `${stemResult.stem}-${timestamp}.${ext}`;
		const relativePath = `images/${filename}`;

		const imagesDir = path.join(folderPath, 'images');
		try {
			await fsp.mkdir(imagesDir, { recursive: true });
		} catch (err: any) {
			throw new Error(`failed to create images directory: ${err?.message ?? String(err)}`);
		}

		const filePath = path.join(imagesDir, filename);

		// Defense-in-depth: re-verify the resolved path stays inside the
		// folderPath after path.join, in case a future change to the filename
		// generator introduces a separator-containing component. Matches the
		// renderer-side autorun.ts:575-580 check.
		const resolvedPath = path.resolve(filePath);
		const resolvedFolder = path.resolve(folderPath);
		if (!resolvedPath.startsWith(resolvedFolder + path.sep) && resolvedPath !== resolvedFolder) {
			throw new Error('resolved image path escapes folderPath');
		}

		await fsp.writeFile(filePath, decoded.buffer);
		console.log(`${LOG_CONTEXT} saveImage ${filePath} (${decoded.buffer.length} bytes)`);
		return { filename, relativePath };
	}

	/**
	 * Delete an image previously written by `saveImage`. Validates the
	 * `relativePath` against the `images/<filename>` shape, then unlinks the
	 * resulting absolute path. Returns `{ removed: true }` when the file was
	 * present and deleted; `{ removed: false }` when the file was already
	 * absent (ENOENT) — matches the brief's reply contract. Other failures
	 * (permission, EISDIR) throw so the route layer surfaces a 500.
	 *
	 * The renderer-side autorun.ts:642-647 raises on ENOENT ("Image file not
	 * found"); we soft-fail because the AutoRun shell's removeAttachment
	 * flow tolerates double-deletes (the optimistic UI strips the entry
	 * before the IPC call completes; if the user clicks twice, the second
	 * delete should not throw).
	 */
	async deleteImage(folderPath: string, relativePath: string): Promise<DeleteImageResult> {
		const folderReason = isValidAutorunFolderPath(folderPath);
		if (folderReason) throw new Error(folderReason);

		const relReason = isValidImageRelativePath(relativePath);
		if (relReason) throw new Error(relReason);

		const normalized = path.normalize(relativePath);
		const filePath = path.join(folderPath, normalized);

		// Defense-in-depth: re-verify the resolved path stays inside folderPath.
		// Matches the renderer-side autorun.ts:635-640 check.
		const resolvedPath = path.resolve(filePath);
		const resolvedFolder = path.resolve(folderPath);
		if (!resolvedPath.startsWith(resolvedFolder + path.sep) && resolvedPath !== resolvedFolder) {
			throw new Error('resolved image path escapes folderPath');
		}

		try {
			await fsp.unlink(filePath);
			console.log(`${LOG_CONTEXT} deleteImage ${filePath} (removed)`);
			return { removed: true };
		} catch (err: any) {
			if (err?.code === 'ENOENT') {
				console.log(`${LOG_CONTEXT} deleteImage ${filePath} (already absent)`);
				return { removed: false };
			}
			throw err;
		}
	}

	/**
	 * List images previously saved for a document. Matches the renderer-side
	 * autorun.ts:657-752 prefix-match semantics 1:1 (image is included iff
	 * the filename starts with `{docStem}-` AND has a recognized image
	 * extension). Returns `{ images: [] }` when the `images/` directory does
	 * not exist — that's the normal "no images yet" case, not an error.
	 *
	 * The reply shape extends the renderer-side `{filename, relativePath}`
	 * with `sizeBytes` + `modifiedAt` (from `fs.stat()`) per the brief's
	 * contract. ISO-8601 mtime matches the `fs:stat` reply shape from
	 * `src/server/fs-manager.ts:196` for cross-route consistency.
	 */
	async listImages(folderPath: string, docFilename: string): Promise<ListImagesResult> {
		const folderReason = isValidAutorunFolderPath(folderPath);
		if (folderReason) throw new Error(folderReason);

		const stemResult = sanitizeDocName(docFilename);
		if ('error' in stemResult) throw new Error(stemResult.error);

		const imagesDir = path.join(folderPath, 'images');
		try {
			await fsp.access(imagesDir);
		} catch {
			return { images: [] };
		}

		let entries: string[];
		try {
			entries = await fsp.readdir(imagesDir);
		} catch (err: any) {
			throw new Error(`failed to read images directory: ${err?.message ?? String(err)}`);
		}

		const prefix = `${stemResult.stem}-`;
		const matched = entries.filter((name) => {
			if (!name.startsWith(prefix)) return false;
			const ext = name.split('.').pop()?.toLowerCase();
			return !!ext && (ALLOWED_IMAGE_EXTENSIONS as readonly string[]).includes(ext);
		});

		const images: ListedImage[] = [];
		for (const name of matched) {
			const filePath = path.join(imagesDir, name);
			try {
				const stat = await fsp.stat(filePath);
				if (!stat.isFile()) continue;
				images.push({
					filename: name,
					relativePath: `images/${name}`,
					sizeBytes: stat.size,
					modifiedAt: stat.mtime.toISOString(),
				});
			} catch {
				// File raced away between readdir and stat — skip it.
				continue;
			}
		}

		// Sort newest-first by modifiedAt for stable lightbox navigation. The
		// renderer-side handler returns readdir order, which is filesystem-
		// dependent; we make the order deterministic so the AutoRun shell
		// doesn't have to re-sort client-side.
		images.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));

		return { images };
	}

	/**
	 * Recursively delete the AutoRun Docs folder. Backs the Wizard "start
	 * fresh" / ExistingDocsModal flow (lift Phase 2). Mirrors the renderer-side
	 * `autorun:deleteFolder` IPC handler at
	 * `src/main/ipc/handlers/autorun.ts:754-797` — same safety check (basename
	 * must equal `'Auto Run Docs'`), same ENOENT-tolerant semantics.
	 *
	 * Returns `{ removed: true }` when the folder existed and was deleted;
	 * `{ removed: false }` when the folder was already absent (ENOENT or
	 * `fs.stat` failed). Other failures (permission, EBUSY, EROFS) throw so the
	 * route layer surfaces a 500.
	 *
	 * Defense-in-depth: the route layer pre-validates the basename, but this
	 * method re-checks. Both validators MUST stay in sync.
	 */
	async deleteFolder(folderPath: string): Promise<DeleteFolderResult> {
		const folderReason = isValidAutorunFolderPath(folderPath);
		if (folderReason) throw new Error(folderReason);

		// Safety check: only allow deletion of folders named `Auto Run Docs`.
		// Mirrors the IPC handler at `src/main/ipc/handlers/autorun.ts:786-789`.
		if (path.basename(folderPath) !== AUTO_RUN_FOLDER_NAME) {
			throw new Error(`folder basename must be '${AUTO_RUN_FOLDER_NAME}'`);
		}

		// Verify the path exists and is a directory before deleting. If
		// `fs.stat` throws ENOENT, the folder is already gone — return
		// `{ removed: false }` so callers can invoke idempotently. Other
		// stat failures (permission) bubble up.
		let stat;
		try {
			stat = await fsp.stat(folderPath);
		} catch (err: any) {
			if (err?.code === 'ENOENT') {
				console.log(`${LOG_CONTEXT} deleteFolder ${folderPath} (already absent)`);
				return { removed: false };
			}
			throw err;
		}
		if (!stat.isDirectory()) {
			throw new Error('folder path is not a directory');
		}

		await fsp.rm(folderPath, { recursive: true, force: true });
		console.log(`${LOG_CONTEXT} deleteFolder ${folderPath} (removed)`);
		return { removed: true };
	}
}

/* ============ Singleton accessor for the headless server ============ */

let autorunManager: AutorunManager | null = null;

/**
 * Get-or-create the singleton AutorunManager for the headless server.
 *
 * Mirrors the `getFsManager()` / `getWakaTimeManager()` / `getFontsManager()`
 * patterns. Parameterless because image ops are pure-stdlib (no config / DB /
 * network).
 */
export function getAutorunManager(): AutorunManager {
	if (!autorunManager) {
		autorunManager = new AutorunManager();
	}
	return autorunManager;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetAutorunManager(): void {
	autorunManager = null;
}
