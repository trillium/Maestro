/**
 * PtyMessageRouter — bridges the App-level useWebSocket `onPty*` handlers
 * to per-session Terminal instances.
 *
 * Background — why this exists:
 *   The existing `useWebSocket` hook holds a single set of handlers that
 *   live at the App root (passed via `sessionsHandlers`). Adding new
 *   typed-message cases (`pty_data` etc.) into that hook is the right
 *   place for the protocol-level dispatch (done in L6.2 of useWebSocket.ts),
 *   but the App root has no awareness of which Terminal component on the
 *   tree wants which session's bytes. Routing in the App switch by
 *   `if (sessionId === activeSessionId) {...}` would couple PTY routing to
 *   the active-session selection, which breaks the moment we add a "show
 *   another session in a panel" feature or a worktree child view.
 *
 * Solution: a tiny per-session subscriber registry behind a React context.
 *   - App calls `usePtyMessageRouter()` once at the root and forwards its
 *     dispatcher methods into the WS hook handlers (onPtyData, onPtyBackfill,
 *     onPtyDropped).
 *   - Each Terminal instance registers a listener for its `sessionId` on
 *     mount, unregisters on unmount.
 *   - Multiple Terminal instances for the same sessionId all receive the
 *     same dispatch (rare but possible — e.g. dashboard + detail view).
 *
 * The registry is held in refs so re-renders don't tear down listeners and
 * dispatches don't re-render the provider.
 */

import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	type PropsWithChildren,
} from 'react';

/**
 * Callback shape a Terminal instance registers. Mirrors the on-the-wire
 * payload of pty_data / pty_backfill / pty_dropped after typed-message
 * extraction in useWebSocket.ts.
 */
export interface PtySessionListener {
	onData?: (bytes: string, seq: number, tabId?: string) => void;
	onBackfill?: (bytes: string, fromSeq: number, toSeq: number, isFinal: boolean) => void;
	onDropped?: (droppedBytes: number, lastSeq: number) => void;
}

/**
 * Public surface exposed by the provider via context.
 */
export interface PtyMessageRouterApi {
	/**
	 * Register a listener for a session. Returns an unregister function.
	 * Multiple listeners per sessionId are supported; each receives every
	 * dispatched event for that session.
	 */
	register: (sessionId: string, listener: PtySessionListener) => () => void;
	/**
	 * Wire this into useWebSocket.handlers.onPtyData.
	 */
	dispatchData: (sessionId: string, bytes: string, seq: number, tabId?: string) => void;
	/**
	 * Wire this into useWebSocket.handlers.onPtyBackfill.
	 */
	dispatchBackfill: (
		sessionId: string,
		bytes: string,
		fromSeq: number,
		toSeq: number,
		isFinal: boolean
	) => void;
	/**
	 * Wire this into useWebSocket.handlers.onPtyDropped.
	 */
	dispatchDropped: (sessionId: string, droppedBytes: number, lastSeq: number) => void;
}

const PtyMessageRouterContext = createContext<PtyMessageRouterApi | null>(null);

/**
 * Provider — drop this near the root of webFull so any Terminal anywhere in
 * the tree can subscribe. The App component is responsible for wiring the
 * three `dispatch*` methods into the useWebSocket handlers.
 */
export function PtyMessageRouterProvider({ children }: PropsWithChildren): JSX.Element {
	// Map<sessionId, Set<listener>>. Refs so dispatching doesn't re-render
	// the provider (we have thousands of these per second under heavy PTY).
	const listenersRef = useRef<Map<string, Set<PtySessionListener>>>(new Map());

	const register = useCallback(
		(sessionId: string, listener: PtySessionListener): (() => void) => {
			const map = listenersRef.current;
			let set = map.get(sessionId);
			if (!set) {
				set = new Set<PtySessionListener>();
				map.set(sessionId, set);
			}
			set.add(listener);
			return (): void => {
				const current = listenersRef.current.get(sessionId);
				if (!current) return;
				current.delete(listener);
				if (current.size === 0) {
					listenersRef.current.delete(sessionId);
				}
			};
		},
		[]
	);

	const dispatchData = useCallback(
		(sessionId: string, bytes: string, seq: number, tabId?: string): void => {
			const set = listenersRef.current.get(sessionId);
			if (!set) return;
			for (const l of set) {
				l.onData?.(bytes, seq, tabId);
			}
		},
		[]
	);

	const dispatchBackfill = useCallback(
		(
			sessionId: string,
			bytes: string,
			fromSeq: number,
			toSeq: number,
			isFinal: boolean
		): void => {
			const set = listenersRef.current.get(sessionId);
			if (!set) return;
			for (const l of set) {
				l.onBackfill?.(bytes, fromSeq, toSeq, isFinal);
			}
		},
		[]
	);

	const dispatchDropped = useCallback(
		(sessionId: string, droppedBytes: number, lastSeq: number): void => {
			const set = listenersRef.current.get(sessionId);
			if (!set) return;
			for (const l of set) {
				l.onDropped?.(droppedBytes, lastSeq);
			}
		},
		[]
	);

	const value = useMemo<PtyMessageRouterApi>(
		() => ({
			register,
			dispatchData,
			dispatchBackfill,
			dispatchDropped,
		}),
		[register, dispatchData, dispatchBackfill, dispatchDropped]
	);

	return (
		<PtyMessageRouterContext.Provider value={value}>
			{children}
		</PtyMessageRouterContext.Provider>
	);
}

/**
 * Read the router from context. Throws if the provider isn't mounted —
 * Terminal components can't function without the router so the error is
 * a developer-time signal, not a runtime fallback.
 */
export function usePtyMessageRouter(): PtyMessageRouterApi {
	const ctx = useContext(PtyMessageRouterContext);
	if (!ctx) {
		throw new Error(
			'usePtyMessageRouter must be used within a PtyMessageRouterProvider — wrap the webFull root with <PtyMessageRouterProvider> and wire useWebSocket.handlers.onPty* to the returned dispatch methods.'
		);
	}
	return ctx;
}

export { PtyMessageRouterContext };
