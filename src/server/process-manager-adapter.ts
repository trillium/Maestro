/**
 * Maestro Server — ProcessManager adapter.
 *
 * Thin server-side wrapper around the existing `ProcessManager` from
 * `src/main/process-manager/`. Its only job today is to centralize sessionId
 * suffixing (`-ai` / `-terminal`) so the headless server's WRITE callbacks
 * stay readable.
 *
 * `ProcessManager` itself is electron-free (verified via grep across
 * `src/main/process-manager/`, `src/main/parsers/`, `src/main/agents/`, and
 * `src/shared/`). Importing it directly from the server is safe.
 *
 * Layer 0b scope:
 *   - writeToSession  → ProcessManager.write
 *   - interruptSession→ ProcessManager.interrupt
 *   - executeCommand  → same as writeToSession (appends newline)
 *
 * Out of scope (deferred to Layer 0c+):
 *   - Spawning new sessions / agents (full session-creation flow lives in the
 *     renderer today; needs a server-side port plus a UI surface).
 *   - switchMode, tab ops, bookmark — those still need a write-back path to
 *     the sessions store and to the WebSocket broadcaster.
 */

import { ProcessManager } from '../main/process-manager';

export type SessionInputMode = 'ai' | 'terminal' | string | undefined;

export interface SessionLookup {
	(sessionId: string): { inputMode?: SessionInputMode } | null | undefined;
}

/**
 * Compute the target process id used by ProcessManager. Mirrors the
 * renderer-side logic in `src/main/web-server/web-server-factory.ts`
 * (lines 248-272): `-ai` suffix when the session's inputMode is `'ai'`,
 * otherwise `-terminal`.
 */
export function resolveProcessId(sessionId: string, inputMode: SessionInputMode): string {
	return inputMode === 'ai' ? `${sessionId}-ai` : `${sessionId}-terminal`;
}

export class ServerProcessManagerAdapter {
	readonly processManager: ProcessManager;
	private readonly lookupSession: SessionLookup;

	constructor(lookupSession: SessionLookup, processManager?: ProcessManager) {
		this.processManager = processManager ?? new ProcessManager();
		this.lookupSession = lookupSession;
	}

	/**
	 * Write a raw chunk to the session's stdin. Used by both writeToSession
	 * (no automatic newline — the route appends one) and executeCommand
	 * (which always appends `\n`).
	 */
	write(sessionId: string, data: string): boolean {
		const session = this.lookupSession(sessionId);
		if (!session) {
			console.warn(
				`[maestro-server] write(): session ${sessionId} not in store; ` +
					`falling back to terminal suffix`
			);
		}
		const target = resolveProcessId(sessionId, session?.inputMode);
		return this.processManager.write(target, data);
	}

	/**
	 * Execute a command. Layer 0b semantics: if a process exists for the
	 * session's current mode, write the command + newline to its stdin.
	 *
	 * This intentionally does NOT spawn a new pty / child process — the full
	 * session-creation pipeline lives in the renderer today and is deferred
	 * to a later layer along with the "New Session" UI.
	 */
	async executeCommand(
		sessionId: string,
		command: string,
		inputModeOverride?: 'ai' | 'terminal'
	): Promise<boolean> {
		const session = this.lookupSession(sessionId);
		const inputMode = inputModeOverride ?? session?.inputMode;
		const target = resolveProcessId(sessionId, inputMode);
		const payload = command.endsWith('\n') ? command : `${command}\n`;
		return this.processManager.write(target, payload);
	}

	/**
	 * Interrupt the session's active process. Resolves true even if the
	 * underlying call returned false — interrupt is best-effort and the
	 * route layer turns false into a 500. ProcessManager.interrupt itself
	 * returns boolean (synchronous); we lift it into a Promise to match the
	 * WebServer's InterruptSessionCallback signature.
	 */
	async interrupt(sessionId: string): Promise<boolean> {
		const session = this.lookupSession(sessionId);
		const target = resolveProcessId(sessionId, session?.inputMode);
		return this.processManager.interrupt(target);
	}

	/**
	 * Cleanup — kill every managed process. Called on graceful shutdown.
	 */
	shutdown(): void {
		this.processManager.killAll();
	}
}
