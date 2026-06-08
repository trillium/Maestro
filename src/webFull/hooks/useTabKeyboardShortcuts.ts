/**
 * useTabKeyboardShortcuts — webFull AI-tab keyboard navigation
 *
 * Layer 4.2. Wires the renderer's tab-navigation shortcut surface into
 * webFull. The existing `useMobileKeyboardHandler` already implements
 * Cmd+[ / Cmd+] (no Shift) as previous / next tab for the mobile web
 * surface. This hook adds the renderer-aligned set so the two stacks
 * read the same way for users who switch between Electron and webFull:
 *
 *   - Cmd+Shift+[  →  previous AI tab (wraps)
 *   - Cmd+Shift+]  →  next AI tab (wraps)
 *   - Cmd+1 .. Cmd+9  →  jump to AI tab at that index (1-based)
 *   - Cmd+0  →  jump to last AI tab
 *
 * Reference oracle: `src/renderer/constants/shortcuts.ts` (lines 58-59,
 * 183+ for `goToTab1..9` / `goToLastTab`) and
 * `src/renderer/hooks/keyboard/useMainKeyboardHandler.ts` (line 737+
 * for `nextTab` / `prevTab` / `goToTab{i}` dispatch). webFull intentionally
 * drops the unified-tab-order navigation since the file preview surface
 * isn't ported yet (see TabBar header DROPPED list).
 *
 * Browser-context caveats (flagged here so the parity catalog can mark
 * the affected stories as DROPPED-when-browser-intercepts):
 *
 *   - Chrome on macOS: Cmd+1..8 jumps the browser to that tab in the
 *     window's tab strip. Cmd+9 jumps to the LAST browser tab. Cmd+Shift+[
 *     and Cmd+Shift+] are also bound to "select previous/next browser
 *     tab" in Chrome's macOS bindings. These cannot be overridden from
 *     the page in a regular browser tab — `e.preventDefault()` runs AFTER
 *     the browser has already consumed the event for its tab strip
 *     ([standard chromium behavior, see CommandLineHandler]). They DO
 *     work inside a PWA / standalone display-mode window where the
 *     browser tab strip is gone, which is the intended deployment for
 *     webFull (mini2 over Tailscale, opened as an installed PWA from the
 *     phone or laptop).
 *   - Safari on macOS: same story (Cmd+Shift+[/] are browser tab nav).
 *   - Firefox on macOS: Cmd+1..8 jumps to browser tab; Cmd+Shift+[/]
 *     are reserved.
 *   - Linux / Windows: Ctrl variants are also browser-tab nav. The hook
 *     listens for Meta+digit so on Linux/Windows Ctrl+digit goes to
 *     the browser regardless. That's acceptable per the brief — the
 *     primary deployment is iOS Safari (Add-to-Home-Screen PWA) and
 *     macOS-as-PWA, both of which clear the browser tab strip.
 *
 * The hook calls `e.preventDefault()` defensively so that when the page
 * IS allowed to see the event (PWA mode, Electron-as-host, headless test
 * harness, focused iframe), the renderer-equivalent behavior triggers
 * and the browser doesn't ALSO act on it.
 *
 * Behavior contract:
 *
 *   - Hook is a no-op while the user is typing in an input/textarea/
 *     contenteditable element. The renderer's `useMainKeyboardHandler`
 *     guards on `isInputFocused` for the same reason — Cmd+1..9 inside
 *     an input should mean "select 9 characters", not switch tabs.
 *   - Wraps around at the ends for Cmd+Shift+[/]. Matches the renderer's
 *     `navigateToNextUnifiedTab` / `navigateToPrevUnifiedTab` wrap rule.
 *   - Out-of-range indices (Cmd+5 when there are 3 tabs) are no-ops,
 *     matching `navigateToUnifiedTabByIndex` returning null.
 *   - Cmd+0 jumps to the last tab regardless of count. Matches renderer
 *     `goToLastTab` semantics.
 */

import { useEffect } from 'react';
import type { AITabData } from './useWebSocket';

/**
 * Minimal session shape used by this hook. Accepts any object with the
 * needed fields to keep the call-site flexible.
 */
export type TabShortcutSession = {
	aiTabs?: AITabData[];
	activeTabId?: string;
	inputMode?: string;
};

export interface UseTabKeyboardShortcutsDeps {
	/**
	 * Active session view containing the tab list. If null or undefined,
	 * the hook is a no-op.
	 */
	activeSession: TabShortcutSession | null | undefined;
	/** Handler invoked with the resolved target tab id. */
	handleSelectTab: (tabId: string) => void;
	/**
	 * When true, the hook is fully disabled (used when modal overlays
	 * have keyboard focus and want to claim every key). Optional —
	 * defaults to false.
	 */
	disabled?: boolean;
}

/**
 * Returns true when the focused element should swallow keyboard shortcuts
 * (typing in an input / textarea / contenteditable).
 */
function isInputFocused(): boolean {
	const el = document.activeElement as HTMLElement | null;
	if (!el) return false;
	const tag = el.tagName;
	if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
	if (el.isContentEditable) return true;
	return false;
}

/**
 * Wire renderer-aligned AI-tab keyboard shortcuts into the webFull
 * window. Mount once at the App level.
 */
export function useTabKeyboardShortcuts(deps: UseTabKeyboardShortcutsDeps): void {
	const { activeSession, handleSelectTab, disabled = false } = deps;

	useEffect(() => {
		if (disabled) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			// Only act in AI mode (terminal mode owns its own key map).
			if (activeSession?.inputMode && activeSession.inputMode !== 'ai') return;
			const tabs = activeSession?.aiTabs;
			if (!tabs || tabs.length === 0) return;
			if (isInputFocused()) return;

			const isMeta = e.metaKey || e.ctrlKey;
			if (!isMeta) return;

			// Cmd+Shift+] — next tab (wraps)
			if (e.shiftKey && e.key === ']') {
				e.preventDefault();
				if (tabs.length < 2) return;
				const currentIndex = tabs.findIndex((t) => t.id === activeSession?.activeTabId);
				if (currentIndex === -1) return;
				const nextIndex = (currentIndex + 1) % tabs.length;
				handleSelectTab(tabs[nextIndex].id);
				return;
			}

			// Cmd+Shift+[ — previous tab (wraps)
			if (e.shiftKey && e.key === '[') {
				e.preventDefault();
				if (tabs.length < 2) return;
				const currentIndex = tabs.findIndex((t) => t.id === activeSession?.activeTabId);
				if (currentIndex === -1) return;
				const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
				handleSelectTab(tabs[prevIndex].id);
				return;
			}

			// Cmd+0 — jump to last tab
			// Use e.code/e.key with bare digit (no Shift), so Cmd+) on shifted
			// keyboard layouts doesn't accidentally match.
			if (!e.shiftKey && !e.altKey && e.key === '0') {
				e.preventDefault();
				const last = tabs[tabs.length - 1];
				if (last) handleSelectTab(last.id);
				return;
			}

			// Cmd+1..9 — jump to that index (1-based). Out-of-range = no-op.
			if (!e.shiftKey && !e.altKey && e.key >= '1' && e.key <= '9') {
				e.preventDefault();
				const idx = parseInt(e.key, 10) - 1;
				const target = tabs[idx];
				if (target) handleSelectTab(target.id);
				return;
			}
		};

		document.addEventListener('keydown', handleKeyDown);
		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [activeSession, handleSelectTab, disabled]);
}

export default useTabKeyboardShortcuts;
