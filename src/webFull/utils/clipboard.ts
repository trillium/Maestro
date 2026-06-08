/**
 * @file clipboard.ts
 * @description Safe clipboard operations that handle focus-related errors.
 *
 * Layer 2.5 leaf-parade lift of the pure surface from
 * `src/renderer/utils/clipboard.ts`. The renderer file exposes three helpers:
 *
 * - `safeClipboardWrite` — pure browser `navigator.clipboard.writeText`, no IPC
 * - `safeClipboardWriteBlob` — pure browser `navigator.clipboard.write`, no IPC
 * - `safeClipboardWriteImage` — reaches for `window.maestro.shell.copyImageToClipboard`,
 *   the Electron preload bridge, with a browser Clipboard API fallback
 *
 * webFull lifts only the first two — the pure surface. The `Image` helper is
 * NOT lifted because it depends on the `window.maestro` preload bridge that
 * does not exist in the webFull host. If a webFull consumer ever needs to
 * write images to the clipboard, the right move is either:
 *   1. an explicit webFull adapter that calls the browser Clipboard API
 *      directly (the renderer's fallback path is already pure), or
 *   2. a host-aware capability injection from the webFull entrypoint.
 *
 * Today's only consumer in webFull is `GroupChatMessages.tsx`, which only uses
 * `safeClipboardWrite`. Keeping the lift minimal avoids smuggling Electron-only
 * surface into the web fork.
 *
 * The Clipboard API throws `NotAllowedError` when the document is not focused.
 * These wrappers swallow the rejection so callers don't have to.
 *
 * Original bug ref: MAESTRO-4Z (renderer).
 */

/**
 * Safely write text to the clipboard.
 * Returns true on success, false if the document is not focused or clipboard is unavailable.
 */
export async function safeClipboardWrite(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		// NotAllowedError when document not focused, or other clipboard failures.
		// Not actionable — the user can retry when the window is focused.
		return false;
	}
}

/**
 * Safely write binary data (e.g. images) to the clipboard.
 * Returns true on success, false if the document is not focused or clipboard is unavailable.
 */
export async function safeClipboardWriteBlob(items: ClipboardItem[]): Promise<boolean> {
	try {
		await navigator.clipboard.write(items);
		return true;
	} catch {
		return false;
	}
}
