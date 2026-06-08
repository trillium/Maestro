/**
 * Terminal — xterm.js host for raw PTY rendering inside webFull.
 *
 * Public surface for Layer 6.2 consumers (App, render branches, tests).
 * The Terminal component itself talks to:
 *   - the xterm.js / fit / web-links packages (npm deps),
 *   - the L6.1 raw-PTY WebSocket protocol (server side),
 *   - the PtyMessageRouter context (per-session subscriber registry).
 *
 * Anything else routing pty_* WS events should go through PtyMessageRouter
 * rather than constructing its own subscription mechanism.
 */

export {
	Terminal,
	defaultSeqStore,
	decodeBase64ToBytes,
	encodeStringToBase64,
	buildXtermTheme,
	buildDroppedMarker,
	DROPPED_MARKER_PREFIX,
	DROPPED_MARKER_SUFFIX,
} from './Terminal';
export type { TerminalProps, SeqStore } from './Terminal';
export {
	PtyMessageRouterProvider,
	usePtyMessageRouter,
	PtyMessageRouterContext,
} from './PtyMessageRouter';
export type { PtyMessageRouterApi, PtySessionListener } from './PtyMessageRouter';
