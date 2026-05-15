/**
 * Session Activity Types
 *
 * Shared types and constants describing activity on agent session files,
 * regardless of whether the session was spawned by Maestro itself ("local")
 * or by an outside actor on the same host such as an SSH user ("external").
 *
 * Phase 1 of the Remote Agent Visibility effort: surfaces activity from
 * agent sessions Maestro did not spawn by watching on-disk JSONL artifacts
 * each agent CLI writes. This module defines the wire shape; the watcher
 * lives in `src/main/storage/session-file-watcher.ts`.
 */

import type { ToolType } from './types';

/**
 * Distinguishes Maestro-spawned sessions from sessions started by another
 * actor on the same host (e.g. a user SSH'd into the same machine).
 */
export type SessionActivitySource = 'local' | 'external';

/**
 * Emitted whenever a watched session file grows or appears on disk.
 *
 * `lastActivityAt` is a Unix epoch in ms (matching the rest of the codebase).
 * `sizeBytes` is the current size of the underlying session file at the time
 * the event was emitted — consumers can diff this against a prior value to
 * estimate how much was appended.
 */
export interface SessionActivityEvent {
	agentId: ToolType;
	sessionId: string;
	projectPath: string;
	lastActivityAt: number;
	source: SessionActivitySource;
	sizeBytes: number;
}

/**
 * A session is treated as "thinking" if its file was appended to within
 * this window. Tuned to feel responsive without flapping on bursty writes.
 */
export const EXTERNAL_ACTIVITY_ACTIVE_MS = 3000;

/**
 * After this much quiet on a session file, the watcher emits `'idle'` and
 * any UI treatment for that session is cleared.
 */
export const EXTERNAL_ACTIVITY_IDLE_MS = 30000;

/**
 * Returns true when the event is recent enough to be considered active.
 *
 * @param event - The session activity event to test.
 * @param now - Optional clock override (defaults to `Date.now()`), useful for tests.
 */
export function isActive(event: SessionActivityEvent, now: number = Date.now()): boolean {
	return now - event.lastActivityAt <= EXTERNAL_ACTIVITY_ACTIVE_MS;
}
