/**
 * webFull-side platform detection helpers.
 *
 * Mirrors the public API of `src/renderer/utils/platformUtils.ts` so that
 * components which were originally written for the Electron renderer can be
 * lifted into webFull with their `isMacOSPlatform()` / `isWindowsPlatform()` /
 * `isLinuxPlatform()` callsites unchanged.
 *
 * Divergence from renderer (NOT a verbatim lift — this is a deliberate
 * platform-specific divergence per the L2.3 brief):
 * - Renderer reads `window.maestro.platform`, which is set by the Electron
 *   preload bridge to Node's `process.platform` ('darwin' / 'win32' / 'linux').
 * - webFull runs in a browser tab with no preload bridge. There is no reliable
 *   `process.platform` analog; the closest signal is `navigator.userAgent`.
 *
 * Re-export instead of copy was rejected here because the source-of-truth
 * differs between environments. The renderer file stays correct for desktop;
 * this file stays correct for browsers.
 *
 * Precursor infrastructure: per the L2.2.5 leaf-component audit, the platform
 * shim unblocks ~25 future renderer components whose only blocker for lift is
 * a transitive dependency on `window.maestro.platform` via these helpers.
 */

function getUserAgent(): string {
	if (typeof navigator === 'undefined') return '';
	return navigator.userAgent ?? '';
}

/**
 * Returns true when the page is running on macOS / iOS.
 *
 * Detection: matches `Mac`, `iPhone`, or `iPad` in the user-agent string.
 * iPad is intentionally included because iPadOS reports the same Mac-like
 * UA as desktop Safari and is functionally a macOS-keyboard-layout device.
 */
export function isMacOSPlatform(): boolean {
	return /Mac|iPhone|iPad/i.test(getUserAgent());
}

/**
 * Returns true when the page is running on Windows.
 */
export function isWindowsPlatform(): boolean {
	return /Windows/i.test(getUserAgent());
}

/**
 * Returns true when the page is running on Linux (excluding Android, which
 * has a distinct UA token even though the kernel is Linux).
 */
export function isLinuxPlatform(): boolean {
	const ua = getUserAgent();
	return /Linux/i.test(ua) && !/Android/i.test(ua);
}

/**
 * Returns true when the page is running on a mobile device (iOS or Android).
 * Not present on the renderer; useful for webFull-specific UI affordances.
 */
export function isMobilePlatform(): boolean {
	return /iPhone|iPad|iPod|Android/i.test(getUserAgent());
}

/**
 * Returns the platform-appropriate label for the "reveal in file manager" action.
 *
 * In webFull the host OS is the user's browser machine; "reveal" is informational
 * (the server may be remote and not actually expose a file manager), but the
 * label matching the user's local convention reduces cognitive load.
 *
 *   macOS (and other/unknown) → "Reveal in Finder"
 *   Windows                   → "Reveal in Explorer"
 *   Linux                     → "Reveal in File Manager"
 *
 * Argument shape mirrors the renderer's `getRevealLabel(platform: string)` so
 * that callers passing through a stored / received platform string keep
 * working without modification.
 */
export function getRevealLabel(platform: string): string {
	if (platform === 'win32') return 'Reveal in Explorer';
	if (platform === 'linux') return 'Reveal in File Manager';
	return 'Reveal in Finder';
}

/**
 * Returns the platform-appropriate label for "open folder in file manager".
 *   macOS (and other/unknown) → "Open in Finder"
 *   Windows                   → "Open in Explorer"
 *   Linux                     → "Open in File Manager"
 */
export function getOpenInLabel(platform: string): string {
	if (platform === 'win32') return 'Open in Explorer';
	if (platform === 'linux') return 'Open in File Manager';
	return 'Open in Finder';
}
