// Stream-json emitter for the maestro-p wrapper.
//
// Phase 1 task 5 responsibilities: serialize the documented subset of
// `claude -p` stream-json events (system/init, assistant, result, status) to
// stdout as JSONL. Each emit method produces exactly one line.
//
// Why a class with state tracking rather than free functions:
//   - emitInit must be idempotent (no-op on duplicate calls). Free functions
//     would need an external flag held by the caller.
//   - assistantText / result before init is a programming error worth catching
//     loudly — fail fast so misuse doesn't silently produce a partial stream.
//   - status mode is mutually exclusive with init/result; mixing them in the
//     same emitter would mean the wrapper accidentally bridged two flows.
//
// The state machine here is intentionally narrow — it isn't trying to model
// every legal claude -p stream, only the discipline that emit calls follow the
// documented ordering. Tests in json-emitter.test.ts assert each transition.

export interface InitParams {
	sessionId: string;
	model?: string;
	cwd: string;
}

export interface ResultParams {
	sessionId: string;
	durationMs: number;
	isError: boolean;
	error?: string;
}

// Shape documented in the playbook for `maestro-p --status` output. The
// usage-parser task (phase 1 task 7) will import this type rather than redefine
// it — keeping the canonical declaration co-located with the emitter that
// writes it to stdout.
export interface StatusSnapshot {
	type: 'status';
	config_dir: string;
	session: { percent: number; resets_at: string };
	week_all_models: { percent: number; resets_at: string };
	week_sonnet_only: { percent: number; resets_at: string };
}

export class JsonEmitter {
	private readonly stdout: NodeJS.WritableStream;
	private initEmitted = false;
	private resultEmitted = false;
	private statusEmitted = false;

	constructor(stdout?: NodeJS.WritableStream) {
		this.stdout = stdout ?? process.stdout;
	}

	emitInit(params: InitParams): void {
		if (this.statusEmitted) {
			throw new Error('JsonEmitter: cannot emit init after status (mode mix-up)');
		}
		if (this.initEmitted) {
			// Documented contract: duplicate init is a no-op, not an error.
			// Callers race session-id discovery against a fallback "unknown",
			// so a second resolution may legitimately want to fire init again.
			return;
		}
		const obj: Record<string, unknown> = {
			type: 'system',
			subtype: 'init',
			session_id: params.sessionId,
			cwd: params.cwd,
		};
		// model is "<id-if-known>" per the playbook — omit when we don't have
		// it rather than serializing null / undefined, so the emitted JSON
		// stays a clean subset of the real claude -p schema.
		if (params.model !== undefined) {
			obj.model = params.model;
		}
		this.write(obj);
		this.initEmitted = true;
	}

	emitAssistantText(text: string): void {
		if (this.statusEmitted) {
			throw new Error('JsonEmitter: cannot emit assistant text in status mode');
		}
		if (!this.initEmitted) {
			throw new Error('JsonEmitter: cannot emit assistant text before init');
		}
		if (this.resultEmitted) {
			throw new Error('JsonEmitter: cannot emit assistant text after result');
		}
		this.write({
			type: 'assistant',
			message: {
				role: 'assistant',
				content: [{ type: 'text', text }],
			},
		});
	}

	emitResult(params: ResultParams): void {
		if (this.statusEmitted) {
			throw new Error('JsonEmitter: cannot emit result in status mode');
		}
		if (!this.initEmitted) {
			throw new Error('JsonEmitter: cannot emit result before init');
		}
		if (this.resultEmitted) {
			throw new Error('JsonEmitter: cannot emit result twice');
		}
		const obj: Record<string, unknown> = {
			type: 'result',
			// The playbook documents subtype: 'success' as the canonical shape.
			// is_error toggles to flag failures (timeout, limit-hit, general),
			// keeping our output a strict subset of the documented schema.
			subtype: 'success',
			session_id: params.sessionId,
			duration_ms: params.durationMs,
			is_error: params.isError,
		};
		if (params.error !== undefined) {
			obj.error = params.error;
		}
		this.write(obj);
		this.resultEmitted = true;
	}

	emitStatus(snapshot: StatusSnapshot): void {
		if (this.initEmitted || this.resultEmitted) {
			throw new Error('JsonEmitter: cannot emit status alongside run-mode events');
		}
		if (this.statusEmitted) {
			throw new Error('JsonEmitter: cannot emit status twice');
		}
		this.write(snapshot);
		this.statusEmitted = true;
	}

	private write(obj: unknown): void {
		this.stdout.write(`${JSON.stringify(obj)}\n`);
	}
}
