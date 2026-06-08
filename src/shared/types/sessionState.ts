/**
 * Session state — the visible status of an agent session.
 *
 * Promoted from `src/renderer/types/index.ts` to `src/shared/types/` so it
 * can be consumed from both the Electron renderer and the web/webFull fork
 * without a cross-fork import.
 */
export type SessionState = 'idle' | 'busy' | 'waiting_input' | 'connecting' | 'error';
