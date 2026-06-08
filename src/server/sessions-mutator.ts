/**
 * Maestro Server — sessions-store mutators.
 *
 * Pure functions that take the current sessions array and a mutation intent
 * and return a new sessions array. Used by the Layer 0c WRITE callbacks in
 * `src/server/index.ts` to (a) persist the mutation through `FileStore.set()`
 * and (b) hand the mutated session back to the caller for broadcasting.
 *
 * Returning `null` means "no such session" or "no-op" — the caller should
 * skip persistence + broadcast and return false to the WS client.
 *
 * These mutators are deliberately ignorant of FileStore / WebServer / I/O —
 * just data in, data out. That keeps them trivially unit-testable and keeps
 * `index.ts` declarative.
 */

import { randomUUID } from 'crypto';

export interface MutableSession {
	id: string;
	name?: string;
	state?: string;
	inputMode?: string;
	bookmarked?: boolean;
	aiTabs?: Array<Record<string, unknown>>;
	activeTabId?: string;
	[key: string]: unknown;
}

export interface MutationResult<T extends MutableSession = MutableSession> {
	sessions: T[];
	session: T;
}

/**
 * Locate a session by id. Returns the index AND a structurally-cloned copy so
 * the caller can mutate without aliasing the live store array.
 */
function locate<T extends MutableSession>(
	sessions: T[],
	sessionId: string
): { index: number; copy: T } | null {
	const index = sessions.findIndex((s) => s.id === sessionId);
	if (index === -1) return null;
	// shallow clone of the session; deeper structures (aiTabs) cloned by callers
	// when they actually mutate them.
	return { index, copy: { ...sessions[index] } };
}

function commit<T extends MutableSession>(sessions: T[], index: number, next: T): MutationResult<T> {
	const out = sessions.slice();
	out[index] = next;
	return { sessions: out, session: next };
}

export function switchMode<T extends MutableSession>(
	sessions: T[],
	sessionId: string,
	mode: 'ai' | 'terminal'
): MutationResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	if (found.copy.inputMode === mode) {
		// no-op but still report success — caller can skip broadcast
		return commit(sessions, found.index, found.copy);
	}
	found.copy.inputMode = mode;
	return commit(sessions, found.index, found.copy);
}

export function toggleBookmark<T extends MutableSession>(
	sessions: T[],
	sessionId: string
): MutationResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	found.copy.bookmarked = !found.copy.bookmarked;
	return commit(sessions, found.index, found.copy);
}

export function closeTab<T extends MutableSession>(
	sessions: T[],
	sessionId: string,
	tabId: string
): MutationResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	const tabs = (found.copy.aiTabs ?? []).slice();
	const before = tabs.length;
	const remaining = tabs.filter((t) => (t as { id?: string }).id !== tabId);
	if (remaining.length === before) return null;
	found.copy.aiTabs = remaining;
	// If the closed tab was active, fall back to the first remaining tab (or undefined).
	if (found.copy.activeTabId === tabId) {
		found.copy.activeTabId = remaining.length > 0 ? (remaining[0] as { id?: string }).id : undefined;
	}
	return commit(sessions, found.index, found.copy);
}

export function renameTab<T extends MutableSession>(
	sessions: T[],
	sessionId: string,
	tabId: string,
	newName: string
): MutationResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	const tabs = (found.copy.aiTabs ?? []).slice();
	const idx = tabs.findIndex((t) => (t as { id?: string }).id === tabId);
	if (idx === -1) return null;
	tabs[idx] = { ...tabs[idx], name: newName };
	found.copy.aiTabs = tabs;
	return commit(sessions, found.index, found.copy);
}

export function starTab<T extends MutableSession>(
	sessions: T[],
	sessionId: string,
	tabId: string,
	starred: boolean
): MutationResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	const tabs = (found.copy.aiTabs ?? []).slice();
	const idx = tabs.findIndex((t) => (t as { id?: string }).id === tabId);
	if (idx === -1) return null;
	tabs[idx] = { ...tabs[idx], starred };
	found.copy.aiTabs = tabs;
	return commit(sessions, found.index, found.copy);
}

/**
 * Result of an `addTab` call. Mirrors `MutationResult` but adds the `newTabId`
 * so the caller can both broadcast the new tab array AND return the new id to
 * the WS client (the `NewTabCallback` contract is `Promise<{tabId} | null>`).
 *
 * `newTabId === null` is the "session not found" signal — caller skips
 * persist + broadcast and returns null to the client.
 */
export interface AddTabResult<T extends MutableSession = MutableSession> {
	sessions: T[];
	session: T;
	newTabId: string;
}

/**
 * Append a new ai-tab to a session and return the new tab id.
 *
 * Layer 0f / pattern (B): web-driven tab creation is a pure store mutation —
 * no underlying pty/process is spawned here. The first command-send into the
 * new tab triggers `ProcessManager` on-demand spawn via the existing
 * `writeToSession` / `executeCommand` callback chain. That trade-off is
 * intentional and documented in ISA Decisions: (A) "real spawn at newTab"
 * would require inheriting the renderer's spawn-config-building logic and
 * is out of scope for L0f; (B) "store-only newTab + lazy spawn on first
 * command" matches what most web-driven flows expect.
 *
 * Tab shape mirrors `tabsForBroadcast`'s `AITabData` contract: id (UUID),
 * agentSessionId=null, name=null, starred=false, inputValue='', usageStats=null,
 * createdAt=now, state='idle', thinkingStartTime=null.
 *
 * Returns `null` when the session id does not exist in the store.
 */
export function addTab<T extends MutableSession>(
	sessions: T[],
	sessionId: string
): AddTabResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	const newTabId = randomUUID();
	const newTab: Record<string, unknown> = {
		id: newTabId,
		agentSessionId: null,
		name: null,
		starred: false,
		inputValue: '',
		usageStats: null,
		createdAt: Date.now(),
		state: 'idle',
		thinkingStartTime: null,
		logs: [],
	};
	const tabs = (found.copy.aiTabs ?? []).slice();
	tabs.push(newTab);
	found.copy.aiTabs = tabs;
	// New tab becomes active — matches the renderer-side behavior where
	// creating a tab focuses it. If a session had no active tab before, the
	// new one is also the only choice.
	found.copy.activeTabId = newTabId;
	const committed = commit(sessions, found.index, found.copy);
	return { sessions: committed.sessions, session: committed.session, newTabId };
}

export function reorderTab<T extends MutableSession>(
	sessions: T[],
	sessionId: string,
	fromIndex: number,
	toIndex: number
): MutationResult<T> | null {
	const found = locate(sessions, sessionId);
	if (!found) return null;
	const tabs = (found.copy.aiTabs ?? []).slice();
	if (fromIndex < 0 || fromIndex >= tabs.length) return null;
	if (toIndex < 0 || toIndex >= tabs.length) return null;
	if (fromIndex === toIndex) return commit(sessions, found.index, found.copy);
	const [moved] = tabs.splice(fromIndex, 1);
	tabs.splice(toIndex, 0, moved);
	found.copy.aiTabs = tabs;
	return commit(sessions, found.index, found.copy);
}
