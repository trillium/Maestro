/**
 * useAutoRunImageHandling — webFull port backed by REST
 *
 * webFull-native replacement for `src/renderer/hooks/batch/useAutoRunImageHandling.ts`.
 * The renderer version touches six `window.maestro.*` IPC sites:
 *
 *   1. window.maestro.autorun.listImages(folderPath, docFilename, sshRemoteId)
 *      → GET  /api/autorun/list-images?folderPath=…&docFilename=…
 *
 *   2. window.maestro.fs.readFile(absolutePath, sshRemoteId)   (image path, inside list-images loop)
 *      → GET  /api/fs/read-image?path=<absolute>
 *
 *   3. window.maestro.autorun.saveImage(folderPath, docFilename, base64, ext, sshRemoteId)   (paste)
 *      → POST /api/autorun/save-image     body `{folderPath, docFilename, dataUrl, extension}`
 *
 *   4. window.maestro.autorun.saveImage(... same ...)                                     (file select)
 *      → POST /api/autorun/save-image
 *
 *   5. window.maestro.autorun.deleteImage(folderPath, relativePath, sshRemoteId)         (remove attachment)
 *      → DELETE /api/autorun/delete-image (body OR query — we send query-string for fetch parity)
 *
 *   6. window.maestro.autorun.deleteImage(... same ...)                                  (lightbox delete)
 *      → DELETE /api/autorun/delete-image
 *
 * All six routes already exist on `origin/main` `1b2ae0a53` per the W3
 * route wave; this hook is the leaf-side consumer that closes the
 * `ISC-44.shim.use_autorun_image_handling_webfull_port` slot of the
 * umbrella `ISC-44.shim.big_3_ipc_strategy` Decision (2026-06-08).
 *
 * ## SSH remote behavior
 *
 * The server-side routes 501 on `sshRemoteId` (the W3-autorun-images and
 * W3-fs-read-image contracts both refuse SSH redirection — that's the
 * Electron IPC path's job). The hook accepts `sshRemoteId` in its deps
 * interface for call-site parity with the renderer version but does NOT
 * forward it on the wire. webFull-mounted sessions running against an
 * SSH-remote AutoRun folder remain an out-of-scope surface; the Electron
 * preload path continues to own that case verbatim.
 *
 * ## Auth threading
 *
 * Uses `buildApiUrl()` from `'../utils/config'` — the same mechanism the
 * `useMarketplace` port documents. Pulls the server-injected security
 * token from `window.__MAESTRO_CONFIG__` and prefixes it as
 * `/${token}/api/…`.
 *
 * ## Wire-shape parity
 *
 * - GET /api/fs/read-image returns the bare `data:image/<ext>;base64,…`
 *   string in the response body (NOT JSON-wrapped). The hook reads it via
 *   `await res.text()` and feeds the string straight into the same
 *   `result.startsWith('data:')` shape-check the renderer source performs.
 *
 * - GET /api/autorun/list-images returns the renderer-side `listImages`
 *   reply field-for-field: `{success, images?: [{filename, relativePath}], error?}`.
 *   The route adds a `timestamp` field at the top level which we ignore.
 *
 * - POST /api/autorun/save-image accepts `{folderPath, docFilename, dataUrl, extension}`
 *   where `dataUrl` is either the bare base64 payload (the renderer source
 *   strips the `data:image/...;base64,` prefix before sending) OR a full
 *   `data:` URL. The route's `decodeImageDataUrl()` handles both shapes —
 *   we forward the bare base64 to match the renderer call shape exactly.
 *   Reply: `{success, relativePath?, error?}` mirroring the renderer.
 *
 * - DELETE /api/autorun/delete-image accepts `{folderPath, relativePath}`
 *   in EITHER the query string OR a JSON body. `fetch()` does not encourage
 *   DELETE bodies — we send the inputs in the query string for
 *   simplicity (the route handles both per its own comment block).
 *
 * ## Return shape
 *
 * Mirrors `UseAutoRunImageHandlingReturn` from the renderer source
 * field-for-field. The exported `imageCache` is preserved as a
 * module-level `Map<string, string>` singleton — preserves the cache-key
 * shape (`${folderPath}:${relativePath}`) and clears via
 * `imageCache.delete()` in `handleRemoveAttachment` / `handleLightboxDelete`
 * just like the renderer source.
 *
 * ## Pure browser runtime
 *
 * Zero `window.maestro.*` reads. Zero `electron`/`ipcRenderer` imports.
 * Zero module-load side effects. `grep "window.maestro\|electron\|ipcRenderer"
 * src/webFull/hooks/useAutoRunImageHandling.ts` returns zero hits. The only
 * window-touching APIs are `fetch` (standard browser-runtime) and DOM
 * event types (`React.ClipboardEvent`, `React.ChangeEvent`).
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { buildApiUrl } from '../utils/config';

/**
 * Cache for loaded images to avoid repeated HTTP fetches.
 * Module-level singleton that persists across hook instances — preserves
 * the cache-key shape from the renderer source: `${folderPath}:${relativePath}`.
 */
export const imageCache = new Map<string, string>();

/**
 * Dependencies required by useAutoRunImageHandling hook.
 * Mirrors the renderer source's `UseAutoRunImageHandlingDeps` field-for-field;
 * `sshRemoteId` is preserved for call-site parity but is NOT forwarded on
 * the wire (the server routes 501 on it; the Electron path owns SSH).
 */
export interface UseAutoRunImageHandlingDeps {
	folderPath: string | null;
	selectedFile: string | null;
	localContent: string;
	setLocalContent: (content: string) => void;
	handleContentChange: (content: string) => void;
	isLocked: boolean;
	textareaRef: React.RefObject<HTMLTextAreaElement>;
	pushUndoState: () => void;
	lastUndoSnapshotRef: React.MutableRefObject<string>;
	sshRemoteId?: string;
}

/**
 * Return type of useAutoRunImageHandling hook — mirrors the renderer
 * source's `UseAutoRunImageHandlingReturn` field-for-field.
 */
export interface UseAutoRunImageHandlingReturn {
	attachmentsList: string[];
	attachmentPreviews: Map<string, string>;
	attachmentsExpanded: boolean;
	setAttachmentsExpanded: (expanded: boolean) => void;
	lightboxFilename: string | null;
	lightboxExternalUrl: string | null;
	fileInputRef: React.RefObject<HTMLInputElement>;
	handlePaste: (e: React.ClipboardEvent) => Promise<void>;
	handleFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => Promise<void>;
	handleRemoveAttachment: (relativePath: string) => Promise<void>;
	openLightboxByFilename: (filenameOrUrl: string) => void;
	closeLightbox: () => void;
	handleLightboxNavigate: (filename: string | null) => void;
	handleLightboxDelete: (relativePath: string) => Promise<void>;
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const removeImageMarkdownReference = (content: string, relativePath: string): string => {
	const filename = relativePath.split('/').pop() || relativePath;
	const encodedPath = relativePath
		.split('/')
		.map((part) => encodeURIComponent(part))
		.join('/');
	const escapedFilename = escapeRegExp(filename);
	const escapedEncodedPath = escapeRegExp(encodedPath);
	const escapedRawPath = escapeRegExp(relativePath);
	const encodedRegex = new RegExp(`!\\[${escapedFilename}\\]\\(${escapedEncodedPath}\\)\\n?`, 'g');
	const rawRegex = new RegExp(`!\\[${escapedFilename}\\]\\(${escapedRawPath}\\)\\n?`, 'g');
	return content.replace(encodedRegex, '').replace(rawRegex, '');
};

/**
 * Fetch helpers — thin wrappers around the four REST endpoints used by
 * this hook. They throw on non-2xx so the surrounding `try/catch` blocks
 * in the renderer source still work unchanged.
 */
async function fetchListImages(
	folderPath: string,
	docFilename: string
): Promise<{
	success: boolean;
	images?: { filename: string; relativePath: string }[];
	error?: string;
}> {
	const url =
		buildApiUrl('/autorun/list-images') +
		`?folderPath=${encodeURIComponent(folderPath)}&docFilename=${encodeURIComponent(docFilename)}`;
	const res = await fetch(url);
	if (!res.ok) {
		// Match renderer error shape: surface `{success: false, error}` rather
		// than throwing, so the existing `.then(...).catch(...)` chain in the
		// effect lands in the `else` branch.
		const text = await res.text().catch(() => res.statusText);
		return { success: false, error: text || `HTTP ${res.status}` };
	}
	return (await res.json()) as {
		success: boolean;
		images?: { filename: string; relativePath: string }[];
		error?: string;
	};
}

async function fetchReadImage(absolutePath: string): Promise<string | null> {
	const url = buildApiUrl('/fs/read-image') + `?path=${encodeURIComponent(absolutePath)}`;
	const res = await fetch(url);
	if (!res.ok) {
		// 404 (file missing) → null, matches `readFile` semantic where the
		// renderer-side handler returns null for missing files. Other errors
		// propagate as null too — the calling code only inspects
		// `dataUrl.startsWith('data:')` and otherwise ignores the result.
		return null;
	}
	return await res.text();
}

async function fetchSaveImage(
	folderPath: string,
	docFilename: string,
	base64: string,
	extension: string
): Promise<{ success: boolean; relativePath?: string; error?: string }> {
	const res = await fetch(buildApiUrl('/autorun/save-image'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({
			folderPath,
			docFilename,
			dataUrl: base64,
			extension,
		}),
	});
	if (!res.ok) {
		const text = await res.text().catch(() => res.statusText);
		return { success: false, error: text || `HTTP ${res.status}` };
	}
	return (await res.json()) as {
		success: boolean;
		relativePath?: string;
		error?: string;
	};
}

async function fetchDeleteImage(folderPath: string, relativePath: string): Promise<void> {
	const url =
		buildApiUrl('/autorun/delete-image') +
		`?folderPath=${encodeURIComponent(folderPath)}&relativePath=${encodeURIComponent(relativePath)}`;
	// DELETE — using query string per the route's own dual-shape contract.
	await fetch(url, { method: 'DELETE' });
}

export function useAutoRunImageHandling({
	folderPath,
	selectedFile,
	localContent,
	setLocalContent,
	handleContentChange,
	isLocked,
	textareaRef,
	pushUndoState,
	lastUndoSnapshotRef,
}: UseAutoRunImageHandlingDeps): UseAutoRunImageHandlingReturn {
	// Attachment state
	const [attachmentsList, setAttachmentsList] = useState<string[]>([]);
	const [attachmentPreviews, setAttachmentPreviews] = useState<Map<string, string>>(new Map());
	const [attachmentsExpanded, setAttachmentsExpanded] = useState(true);

	// Lightbox state
	const [lightboxFilename, setLightboxFilename] = useState<string | null>(null);
	const [lightboxExternalUrl, setLightboxExternalUrl] = useState<string | null>(null);

	// File input ref
	const fileInputRef = useRef<HTMLInputElement>(null);

	// Load existing images for the current document from the Auto Run folder
	useEffect(() => {
		if (folderPath && selectedFile) {
			let isStale = false;

			setAttachmentsList([]);
			setAttachmentPreviews(new Map());

			fetchListImages(folderPath, selectedFile)
				.then((result) => {
					if (isStale) return;
					if (result.success && result.images) {
						const relativePaths = result.images.map((img) => img.relativePath);
						setAttachmentsList(relativePaths);
						// Load previews for existing images
						result.images.forEach((img) => {
							const absolutePath = `${folderPath}/${img.relativePath}`;
							fetchReadImage(absolutePath)
								.then((dataUrl) => {
									if (isStale) return;
									if (dataUrl && dataUrl.startsWith('data:')) {
										setAttachmentPreviews((prev) => new Map(prev).set(img.relativePath, dataUrl));
									}
								})
								.catch(() => {
									// Image file might be missing, ignore
								});
						});
					} else {
						setAttachmentsList([]);
						setAttachmentPreviews(new Map());
					}
				})
				.catch(() => {
					if (isStale) return;
					setAttachmentsList([]);
					setAttachmentPreviews(new Map());
				});

			return () => {
				isStale = true;
			};
		} else {
			// Clear attachments when no document is selected
			setAttachmentsList([]);
			setAttachmentPreviews(new Map());
		}
	}, [folderPath, selectedFile]);

	// Handle paste (images and text with whitespace trimming)
	const handlePaste = useCallback(
		async (e: React.ClipboardEvent) => {
			if (isLocked) {
				return;
			}

			const items = e.clipboardData?.items;
			if (!items) {
				return;
			}

			// Check if pasting an image
			const hasImage = Array.from(items).some((item) => item.type.startsWith('image/'));

			// Handle text paste with whitespace trimming (when no images)
			if (!hasImage) {
				const text = e.clipboardData.getData('text/plain');
				if (text) {
					const trimmedText = text.trim();
					if (trimmedText !== text) {
						e.preventDefault();
						const textarea = textareaRef.current;
						if (textarea) {
							const start = textarea.selectionStart ?? 0;
							const end = textarea.selectionEnd ?? 0;
							const newContent =
								localContent.slice(0, start) + trimmedText + localContent.slice(end);
							setLocalContent(newContent);
							handleContentChange(newContent);
							requestAnimationFrame(() => {
								textarea.selectionStart = textarea.selectionEnd = start + trimmedText.length;
							});
						}
					}
				}
				return;
			}

			// Image paste requires folder and file context
			if (!folderPath || !selectedFile) {
				return;
			}

			for (let i = 0; i < items.length; i++) {
				const item = items[i];
				if (item.type.startsWith('image/')) {
					e.preventDefault();

					const file = item.getAsFile();
					if (!file) {
						continue;
					}

					const reader = new FileReader();
					reader.onload = async (event) => {
						const base64Data = event.target?.result as string;
						if (!base64Data) {
							return;
						}

						const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
						const extension = item.type.split('/')[1] || 'png';

						const result = await fetchSaveImage(folderPath, selectedFile, base64Content, extension);
						if (result.success && result.relativePath) {
							const filename = result.relativePath.split('/').pop() || result.relativePath;
							setAttachmentsList((prev) => [...prev, result.relativePath!]);
							setAttachmentPreviews((prev) => new Map(prev).set(result.relativePath!, base64Data));

							const textarea = textareaRef.current;
							if (textarea) {
								const cursorPos = textarea.selectionStart;
								const textBefore = localContent.substring(0, cursorPos);
								const textAfter = localContent.substring(cursorPos);
								const encodedPath = result
									.relativePath!.split('/')
									.map((part) => encodeURIComponent(part))
									.join('/');
								const imageMarkdown = `![${filename}](${encodedPath})`;

								pushUndoState();

								let prefix = '';
								let suffix = '';
								if (textBefore.length > 0 && !textBefore.endsWith('\n')) {
									prefix = '\n';
								}
								if (textAfter.length > 0 && !textAfter.startsWith('\n')) {
									suffix = '\n';
								}

								const newContent = textBefore + prefix + imageMarkdown + suffix + textAfter;
								setLocalContent(newContent);
								handleContentChange(newContent);
								lastUndoSnapshotRef.current = newContent;

								const newCursorPos =
									cursorPos + prefix.length + imageMarkdown.length + suffix.length;
								setTimeout(() => {
									textarea.setSelectionRange(newCursorPos, newCursorPos);
									textarea.focus();
								}, 0);
							}
						}
					};
					reader.readAsDataURL(file);
					break; // Only handle first image
				}
			}
		},
		[
			localContent,
			isLocked,
			handleContentChange,
			folderPath,
			selectedFile,
			pushUndoState,
			setLocalContent,
			textareaRef,
			lastUndoSnapshotRef,
		]
	);

	// Handle file input for manual image upload
	const handleFileSelect = useCallback(
		async (e: React.ChangeEvent<HTMLInputElement>) => {
			const file = e.target.files?.[0];
			if (!file || !folderPath || !selectedFile) return;

			const reader = new FileReader();
			reader.onload = async (event) => {
				const base64Data = event.target?.result as string;
				if (!base64Data) return;

				const base64Content = base64Data.replace(/^data:image\/\w+;base64,/, '');
				const extension = file.name.split('.').pop() || 'png';

				const result = await fetchSaveImage(folderPath, selectedFile, base64Content, extension);
				if (result.success && result.relativePath) {
					const filename = result.relativePath.split('/').pop() || result.relativePath;
					setAttachmentsList((prev) => [...prev, result.relativePath!]);
					setAttachmentPreviews((prev) => new Map(prev).set(result.relativePath!, base64Data));

					pushUndoState();

					const encodedPath = result
						.relativePath!.split('/')
						.map((part) => encodeURIComponent(part))
						.join('/');
					const imageMarkdown = `\n![${filename}](${encodedPath})\n`;
					const newContent = localContent + imageMarkdown;
					setLocalContent(newContent);
					handleContentChange(newContent);
					lastUndoSnapshotRef.current = newContent;
				}
			};
			reader.readAsDataURL(file);

			// Reset input so same file can be selected again
			e.target.value = '';
		},
		[
			localContent,
			handleContentChange,
			folderPath,
			selectedFile,
			pushUndoState,
			setLocalContent,
			lastUndoSnapshotRef,
		]
	);

	// Handle removing an attachment (relativePath is like "images/{docName}-{timestamp}.{ext}")
	const handleRemoveAttachment = useCallback(
		async (relativePath: string) => {
			if (!folderPath) return;

			await fetchDeleteImage(folderPath, relativePath);
			setAttachmentsList((prev) => prev.filter((f) => f !== relativePath));
			setAttachmentPreviews((prev) => {
				const newMap = new Map(prev);
				newMap.delete(relativePath);
				return newMap;
			});

			pushUndoState();

			const newContent = removeImageMarkdownReference(localContent, relativePath);
			setLocalContent(newContent);
			handleContentChange(newContent);
			lastUndoSnapshotRef.current = newContent;

			// Clear from cache
			imageCache.delete(`${folderPath}:${relativePath}`);
		},
		[
			localContent,
			handleContentChange,
			folderPath,
			pushUndoState,
			setLocalContent,
			lastUndoSnapshotRef,
		]
	);

	// Lightbox helpers - handles both attachment filenames and external URLs
	const openLightboxByFilename = useCallback((filenameOrUrl: string) => {
		if (
			filenameOrUrl.startsWith('http://') ||
			filenameOrUrl.startsWith('https://') ||
			filenameOrUrl.startsWith('data:')
		) {
			setLightboxExternalUrl(filenameOrUrl);
			setLightboxFilename(filenameOrUrl);
		} else {
			setLightboxExternalUrl(null);
			setLightboxFilename(filenameOrUrl);
		}
	}, []);

	const closeLightbox = useCallback(() => {
		setLightboxFilename(null);
		setLightboxExternalUrl(null);
	}, []);

	const handleLightboxNavigate = useCallback((filename: string | null) => {
		setLightboxFilename(filename);
	}, []);

	const handleLightboxDelete = useCallback(
		async (relativePath: string) => {
			if (!folderPath) return;

			await fetchDeleteImage(folderPath, relativePath);
			setAttachmentsList((prev) => prev.filter((f) => f !== relativePath));
			setAttachmentPreviews((prev) => {
				const newMap = new Map(prev);
				newMap.delete(relativePath);
				return newMap;
			});

			pushUndoState();

			const newContent = removeImageMarkdownReference(localContent, relativePath);
			setLocalContent(newContent);
			handleContentChange(newContent);
			lastUndoSnapshotRef.current = newContent;

			// Clear from cache
			imageCache.delete(`${folderPath}:${relativePath}`);
		},
		[
			folderPath,
			localContent,
			handleContentChange,
			pushUndoState,
			setLocalContent,
			lastUndoSnapshotRef,
		]
	);

	return {
		attachmentsList,
		attachmentPreviews,
		attachmentsExpanded,
		setAttachmentsExpanded,
		lightboxFilename,
		lightboxExternalUrl,
		fileInputRef,
		handlePaste,
		handleFileSelect,
		handleRemoveAttachment,
		openLightboxByFilename,
		closeLightbox,
		handleLightboxNavigate,
		handleLightboxDelete,
	};
}
