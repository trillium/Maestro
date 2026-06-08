/**
 * webFull-side shortcut formatter.
 *
 * Mirrors the public API of `src/renderer/utils/shortcutFormatter.ts` so that
 * components which were originally written for the Electron renderer can be
 * lifted into webFull with their `formatShortcutKeys(...)` /
 * `formatKey(...)` / `formatMetaKey()` / `formatEnterToSend(...)` /
 * `formatEnterToSendTooltip(...)` / `isMacOS()` callsites unchanged.
 *
 * Divergence from renderer (NOT a verbatim lift — this is the same
 * platform-detection divergence pattern as `src/webFull/utils/platformUtils.ts`):
 * - The renderer file imports `isMacOSPlatform` from
 *   `'../utils/platformUtils'`, which transitively reads
 *   `window.maestro.platform` (Electron preload bridge). That bridge does NOT
 *   exist in webFull's browser runtime, so importing the renderer's
 *   shortcutFormatter directly would break at module-load time on the page.
 * - This file imports `isMacOSPlatform` from
 *   `'./platformUtils'` (the webFull shim, which uses `navigator.userAgent`).
 *   The rest of the formatter logic — key-map tables, single-character
 *   uppercasing, separator selection, format helpers — is verbatim from
 *   the renderer source.
 *
 * Re-export was rejected here because the source-of-truth for "is this
 * macOS?" differs between environments (preload bridge vs. user-agent
 * sniffing). The renderer file stays correct for desktop; this file stays
 * correct for browsers.
 *
 * Precursor infrastructure: per the L2.5 leaf-component audit, the formatter
 * shim unblocks `AutoRunnerHelpModal` (504 LOC) — the only blocker for its
 * verbatim lift was the transitive `window.maestro.platform` dependency via
 * the renderer's `shortcutFormatter` → `platformUtils` chain. Future
 * renderer components with the same shape can lift through this shim too.
 */

import { isMacOSPlatform } from './platformUtils';

// Detect if running on macOS — uses webFull's navigator.userAgent shim.
function isMac(): boolean {
	return isMacOSPlatform();
}

// macOS key symbol mappings
const MAC_KEY_MAP: Record<string, string> = {
	Meta: '⌘',
	Alt: '⌥',
	Shift: '⇧',
	Control: '⌃',
	Ctrl: '⌃',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Backspace: '⌫',
	Delete: '⌦',
	Enter: '↩',
	Return: '↩',
	Escape: '⎋',
	Tab: '⇥',
	Space: '␣',
};

// Windows/Linux key mappings (more readable text)
const OTHER_KEY_MAP: Record<string, string> = {
	Meta: 'Ctrl',
	Alt: 'Alt',
	Shift: 'Shift',
	Control: 'Ctrl',
	Ctrl: 'Ctrl',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Backspace: 'Backspace',
	Delete: 'Delete',
	Enter: 'Enter',
	Return: 'Enter',
	Escape: 'Esc',
	Tab: 'Tab',
	Space: 'Space',
};

/**
 * Format a single key for display based on platform.
 */
export function formatKey(key: string): string {
	const keyMap = isMac() ? MAC_KEY_MAP : OTHER_KEY_MAP;

	// Check if there's a mapping for this key
	if (keyMap[key]) {
		return keyMap[key];
	}

	// For single character keys, uppercase them
	if (key.length === 1) {
		return key.toUpperCase();
	}

	// For other keys (like F1, F2, etc.), return as-is
	return key;
}

/**
 * Format an array of keys for display.
 *
 * @param keys - Array of key names (e.g., ['Meta', 'Shift', 'k'])
 * @param separator - Separator between keys (default: ' ' for macOS, '+' for others)
 * @returns Formatted string for display
 *
 * @example
 * // On macOS:
 * formatShortcutKeys(['Meta', 'Shift', 'k']) // '⌘ ⇧ K'
 * formatShortcutKeys(['Alt', 'Meta', 'ArrowRight']) // '⌥ ⌘ →'
 *
 * // On Windows/Linux:
 * formatShortcutKeys(['Meta', 'Shift', 'k']) // 'Ctrl+Shift+K'
 * formatShortcutKeys(['Alt', 'Meta', 'ArrowRight']) // 'Alt+Ctrl+→'
 */
export function formatShortcutKeys(keys: string[], separator?: string): string {
	const defaultSeparator = isMac() ? ' ' : '+';
	const sep = separator ?? defaultSeparator;

	return keys.map(formatKey).join(sep);
}

/**
 * Format the platform-appropriate meta/command key.
 * Returns '⌘' on macOS, 'Ctrl' on Windows/Linux.
 */
export function formatMetaKey(): string {
	return isMac() ? '⌘' : 'Ctrl';
}

/**
 * Format the enter-to-send display text.
 * Used by input areas that toggle between Enter and Cmd+Enter to send.
 *
 * @param enterToSend - Whether Enter sends (true) or Cmd/Ctrl+Enter sends (false)
 * @returns Display string like 'Enter' or '⌘ + Enter' / 'Ctrl + Enter'
 */
export function formatEnterToSend(enterToSend: boolean): string {
	if (enterToSend) return 'Enter';
	return isMac() ? '⌘ + Enter' : 'Ctrl + Enter';
}

/**
 * Format the enter-to-send tooltip text for the toggle button.
 *
 * @param enterToSend - Whether Enter sends (true) or Cmd/Ctrl+Enter sends (false)
 * @returns Tooltip like 'Switch to Cmd+Enter to send' or 'Switch to Enter to send'
 */
export function formatEnterToSendTooltip(enterToSend: boolean): string {
	if (enterToSend) {
		return `Switch to ${isMac() ? 'Cmd' : 'Ctrl'}+Enter to send`;
	}
	return 'Switch to Enter to send';
}

/**
 * Check if running on macOS.
 * Useful for conditional rendering.
 */
export function isMacOS(): boolean {
	return isMac();
}
