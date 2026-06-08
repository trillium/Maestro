/**
 * Terminal — xterm.js host for raw PTY rendering inside webFull.
 *
 * This is the client half of the Layer 6.2 protocol. The server side
 * (RawPtyMultiplexer + pty_* WS messages) landed in L6.1; this component
 * subscribes to a session's raw stream, feeds bytes into xterm.js, and
 * forwards user input + resize events back over the WS.
 *
 * Protocol contract (from `src/server/raw-pty-multiplexer.ts` + the
 * server-side message handlers):
 *   client → server:
 *     - pty_subscribe   { sessionId, lastSeq? }
 *     - pty_unsubscribe { sessionId }
 *     - pty_input       { sessionId, bytes: base64, encoding: 'base64' }
 *     - pty_resize      { sessionId, cols, rows }
 *   server → client:
 *     - pty_data     { sessionId, seq, bytes: base64 }
 *     - pty_backfill { sessionId, fromSeq, toSeq, bytes: base64, isFinal }
 *     - pty_dropped  { sessionId, droppedBytes, lastSeq }
 *
 * The component is responsible for:
 *   1. Owning one XTerm instance + FitAddon + WebLinksAddon.
 *   2. Registering with the PtyMessageRouter so the App-level WS handlers
 *      route this session's events here.
 *   3. Decoding base64 bytes to a Uint8Array and writing into xterm.
 *   4. Encoding xterm.onData keystrokes back to base64 and sending via WS.
 *   5. Calling FitAddon.fit() on resize and sending pty_resize.
 *   6. Persisting the latest seq to sessionStorage so a reconnect picks up
 *      with the right `lastSeq`.
 *   7. Applying the active theme to xterm's `theme` option (background,
 *      foreground, ANSI palette).
 *
 * Out of scope for L6.2:
 *   - Backpressure / WS bufferedAmount watchdog (server side decides).
 *   - Mobile-specific input affordances (defer to the App branch deciding
 *     whether to render <Terminal> on mobile at all).
 *   - Toggle to switch between xterm and the parsed MessageHistory — per
 *     brief, unconditionally render for `toolType === 'terminal'`.
 */

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Terminal as XTerm, type ITheme } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { WebLinksAddon } from 'xterm-addon-web-links';
import 'xterm/css/xterm.css';
import { useThemeColors } from '../ThemeProvider';
import type { ThemeColors } from '../../../shared/theme-types';
import { usePtyMessageRouter, type PtySessionListener } from './PtyMessageRouter';

/**
 * Props for Terminal.
 *
 * The brief mentions `{ sessionId; tabId }`, but the L6.1 server protocol
 * (see `raw-pty-multiplexer.ts` and `messageHandlers.ts`) routes raw PTY
 * by sessionId only — terminal sessions are 1:1 with PTYs. `tabId` is
 * accepted here for forward-compat (the protocol already reserves the
 * field) but currently unused for routing.
 */
export interface TerminalProps {
	/** Session whose raw PTY bytes this terminal renders. */
	sessionId: string;
	/** Reserved for future multi-tab PTY work. Forwarded to pty_subscribe untouched. */
	tabId?: string;
	/**
	 * Function for sending WS messages. Typically `useWebSocket().send`,
	 * passed down from App. We take a function rather than calling
	 * useWebSocket() here because the WS hook holds connection state that
	 * the caller (App) already owns; re-subscribing on every render would
	 * be wrong.
	 */
	send: (message: object) => boolean;
	/**
	 * Optional. When set, the Terminal will use this in place of
	 * sessionStorage for persisting the last-seen seq. Lets tests inject
	 * a controllable store without touching real sessionStorage.
	 */
	seqStore?: SeqStore;
	/**
	 * Optional override for the xterm `Terminal` constructor — exists so
	 * tests can pass a fake without monkey-patching the module. Production
	 * leaves this undefined and the real xterm.js is used.
	 */
	xtermFactory?: typeof XTerm;
}

/**
 * Pluggable seq store. Default impl wraps sessionStorage.
 */
export interface SeqStore {
	get(sessionId: string): number | undefined;
	set(sessionId: string, seq: number): void;
}

/**
 * sessionStorage-backed default. Keys are namespaced under `pty-seq-`.
 */
export const defaultSeqStore: SeqStore = {
	get(sessionId: string): number | undefined {
		try {
			const raw = sessionStorage.getItem(`pty-seq-${sessionId}`);
			if (!raw) return undefined;
			const n = Number(raw);
			return Number.isFinite(n) && n > 0 ? n : undefined;
		} catch {
			// sessionStorage can throw in private browsing on some platforms.
			return undefined;
		}
	},
	set(sessionId: string, seq: number): void {
		try {
			sessionStorage.setItem(`pty-seq-${sessionId}`, String(seq));
		} catch {
			// best-effort persistence; reconnect will refetch from oldest in ring.
		}
	},
};

/**
 * Decode a base64 string to a Uint8Array suitable for xterm.write().
 *
 * xterm.write accepts string OR Uint8Array; Uint8Array preserves arbitrary
 * bytes (e.g. cursor-position CSI sequences containing 0x1b) without UTF-8
 * surrogate corruption. We always use the bytes path.
 */
export function decodeBase64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		bytes[i] = bin.charCodeAt(i) & 0xff;
	}
	return bytes;
}

/**
 * Encode a UTF-8 string into base64 for sending pty_input.
 *
 * xterm's onData emits strings (it's already converted keypresses into
 * UTF-8 byte sequences as a string of code points 0-255). We convert via
 * TextEncoder to ensure multi-byte chars round-trip correctly when the
 * user pastes unicode text into the terminal.
 */
export function encodeStringToBase64(s: string): string {
	const encoder = new TextEncoder();
	const bytes = encoder.encode(s);
	let bin = '';
	for (let i = 0; i < bytes.length; i++) {
		bin += String.fromCharCode(bytes[i]);
	}
	return btoa(bin);
}

/**
 * Build an xterm `theme` from our ThemeColors.
 *
 * xterm exposes only a subset (foreground/background/cursor + 16 ANSI
 * colors). We map the four most-visible Maestro tokens and let xterm
 * fall back to its built-in palette for the rest. The palette choice
 * tilts toward "readable in a Dracula-ish dark mode" — adapting to
 * light themes is a future refinement.
 */
export function buildXtermTheme(colors: ThemeColors): ITheme {
	return {
		background: colors.bgMain,
		foreground: colors.textMain,
		cursor: colors.accent,
		cursorAccent: colors.accentForeground,
		selectionBackground: colors.accentDim,
	};
}

/**
 * Marker text written to xterm when the server reports a dropped slice.
 * Kept as a string constant so the parity catalog can refer to it without
 * embedding a moving substring in test assertions.
 */
export const DROPPED_MARKER_PREFIX = '\r\n[server dropped ';
export const DROPPED_MARKER_SUFFIX = ' bytes; some output lost]\r\n';

/**
 * Build the visible dropped-marker string. Public for tests.
 */
export function buildDroppedMarker(droppedBytes: number): string {
	return `${DROPPED_MARKER_PREFIX}${droppedBytes}${DROPPED_MARKER_SUFFIX}`;
}

/**
 * The terminal host component.
 *
 * Lifecycle (visible in the useEffect):
 *   mount
 *     → instantiate XTerm + addons
 *     → register with PtyMessageRouter (per-session listener)
 *     → send pty_subscribe (with lastSeq if known)
 *     → send initial pty_resize
 *     → install ResizeObserver
 *     → install xterm.onData → pty_input handler
 *   unmount
 *     → dispose listener
 *     → send pty_unsubscribe
 *     → dispose ResizeObserver
 *     → dispose xterm
 */
export function Terminal({
	sessionId,
	tabId,
	send,
	seqStore = defaultSeqStore,
	xtermFactory,
}: TerminalProps): JSX.Element {
	const containerRef = useRef<HTMLDivElement | null>(null);
	const xtermRef = useRef<XTerm | null>(null);
	const fitAddonRef = useRef<FitAddon | null>(null);
	const lastSeqRef = useRef<number | undefined>(seqStore.get(sessionId));
	const colors = useThemeColors();
	const router = usePtyMessageRouter();

	// xterm theme is recomputed when colors change. Stored as memo so the
	// effect's deps list doesn't churn when an unrelated provider re-renders.
	const xtermTheme = useMemo(() => buildXtermTheme(colors), [colors]);

	// The listener handle for the PtyMessageRouter. We rebuild it each
	// mount; the registry returns an unregister fn we call on unmount.
	const handleData = useCallback(
		(bytes: string, seq: number): void => {
			const xterm = xtermRef.current;
			if (!xterm) return;
			xterm.write(decodeBase64ToBytes(bytes));
			lastSeqRef.current = seq;
			seqStore.set(sessionId, seq);
		},
		[sessionId, seqStore]
	);

	const handleBackfill = useCallback(
		(bytes: string, _fromSeq: number, toSeq: number): void => {
			const xterm = xtermRef.current;
			if (!xterm) return;
			xterm.write(decodeBase64ToBytes(bytes));
			lastSeqRef.current = toSeq;
			seqStore.set(sessionId, toSeq);
		},
		[sessionId, seqStore]
	);

	const handleDropped = useCallback((droppedBytes: number, _lastSeq: number): void => {
		const xterm = xtermRef.current;
		if (!xterm) return;
		xterm.write(buildDroppedMarker(droppedBytes));
	}, []);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Allow tests to inject a fake constructor. Production uses real XTerm.
		const XTermCtor = xtermFactory ?? XTerm;
		const xterm = new XTermCtor({
			scrollback: 10_000,
			fontFamily: 'JetBrainsMono, Menlo, Monaco, monospace',
			fontSize: 13,
			cursorBlink: true,
			allowProposedApi: true,
			theme: xtermTheme,
			// Convert end-of-line for sane copy/paste; xterm handles \n vs \r\n
			// transparently for write() — this affects user-visible selection.
			convertEol: false,
		});
		xtermRef.current = xterm;

		const fitAddon = new FitAddon();
		const webLinksAddon = new WebLinksAddon();
		xterm.loadAddon(fitAddon);
		xterm.loadAddon(webLinksAddon);
		fitAddonRef.current = fitAddon;

		xterm.open(container);
		// First fit must happen after open() so the renderer has measured
		// glyph metrics; in tests this is a no-op when the canvas/DOM is
		// stubbed.
		try {
			fitAddon.fit();
		} catch {
			// jsdom / non-layout environments can throw inside fit; ignore
			// for tests, real browser always has layout.
		}

		// Register with the router BEFORE sending pty_subscribe so any
		// immediate pty_backfill that the server delivers between our
		// subscribe and the React effect timing slot lands in our listener.
		const listener: PtySessionListener = {
			onData: handleData,
			onBackfill: handleBackfill,
			onDropped: handleDropped,
		};
		const unregister = router.register(sessionId, listener);

		// Subscribe (optionally with lastSeq for reconnect resume).
		const subscribeMsg: Record<string, unknown> = { type: 'pty_subscribe', sessionId };
		if (lastSeqRef.current !== undefined) {
			subscribeMsg.lastSeq = lastSeqRef.current;
		}
		if (tabId !== undefined) {
			subscribeMsg.tabId = tabId;
		}
		send(subscribeMsg);

		// Initial resize so the server PTY's cols/rows match our cell grid.
		// xterm's rows/cols are populated after open()+fit().
		send({ type: 'pty_resize', sessionId, cols: xterm.cols, rows: xterm.rows });

		// User keystrokes → server. xterm calls onData with strings; we
		// base64-encode for safe transit of control bytes (\x1b, \x03, etc).
		const inputDisposable = xterm.onData((data) => {
			send({
				type: 'pty_input',
				sessionId,
				bytes: encodeStringToBase64(data),
				encoding: 'base64',
			});
		});

		// Resize → server. Use ResizeObserver on the container, debouncing
		// the fit-and-send so a continuous drag doesn't spam the WS. The
		// debounce is intentionally short (60ms) to keep vim's redraw
		// snappy under window resize.
		let resizeTimer: ReturnType<typeof setTimeout> | null = null;
		const ro = new ResizeObserver(() => {
			if (resizeTimer) clearTimeout(resizeTimer);
			resizeTimer = setTimeout(() => {
				try {
					fitAddon.fit();
				} catch {
					// see fit() above
				}
				send({ type: 'pty_resize', sessionId, cols: xterm.cols, rows: xterm.rows });
			}, 60);
		});
		ro.observe(container);

		return (): void => {
			if (resizeTimer) clearTimeout(resizeTimer);
			ro.disconnect();
			inputDisposable.dispose();
			unregister();
			// Tell the server we're gone so it can drop the per-client
			// subscription. The PTY itself keeps running server-side.
			send({ type: 'pty_unsubscribe', sessionId });
			xterm.dispose();
			xtermRef.current = null;
			fitAddonRef.current = null;
		};
	}, [
		sessionId,
		tabId,
		send,
		router,
		handleData,
		handleBackfill,
		handleDropped,
		xtermTheme,
		xtermFactory,
	]);

	// Apply theme updates without re-mounting the entire xterm. xterm
	// supports live theme swaps via the `options.theme` setter.
	useEffect(() => {
		const xterm = xtermRef.current;
		if (!xterm) return;
		xterm.options.theme = xtermTheme;
	}, [xtermTheme]);

	return (
		<div
			ref={containerRef}
			data-testid={`webfull-terminal-${sessionId}`}
			style={{
				width: '100%',
				height: '100%',
				minHeight: 0,
				backgroundColor: colors.bgMain,
			}}
		/>
	);
}

export default Terminal;
