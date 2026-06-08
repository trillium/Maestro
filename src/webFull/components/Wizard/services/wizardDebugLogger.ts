/**
 * wizardDebugLogger (webFull)
 *
 * Extracted from `src/renderer/components/Wizard/services/phaseGenerator.ts:
 * 185-316` per WIZARD_LIFT_PLAN.md §368 — the renderer cross-couples
 * `conversationManager.ts:26` to the logger by importing from phaseGenerator,
 * which would force a same-PR rewrite of phaseGenerator. The plan's
 * recommended workaround is to land the logger as a Phase-1 leaf in webFull
 * first; this file is that leaf.
 *
 * No IPC, no Electron, no DOM-only assumptions beyond `navigator`
 * (already used by the renderer logger and tolerated in webFull). The
 * `startSession()` signature was widened to accept `Record<string, unknown>`
 * instead of `GenerationConfig` so this file doesn't pull `phaseGenerator`'s
 * types — the caller (phaseGenerator port, when it lands) reconstructs the
 * snapshot at the call site.
 */

export interface WizardDebugLogEntry {
	timestamp: number;
	type: 'info' | 'warn' | 'error' | 'data' | 'file' | 'timeout' | 'spawn' | 'exit';
	message: string;
	data?: Record<string, unknown>;
}

/**
 * Debug log collector for wizard generation. Mirrors the renderer's
 * `WizardDebugLogger` class verbatim except for the loosened
 * `startSession()` parameter shape (renderer: `GenerationConfig`,
 * webFull: pre-built snapshot object).
 */
class WizardDebugLogger {
	private logs: WizardDebugLogEntry[] = [];
	private maxLogs = 10000;
	private startTime: number = 0;
	private configSnapshot: Record<string, unknown> = {};

	/**
	 * Start a new generation session.
	 *
	 * @param snapshot Pre-built session metadata. Renderer's logger built
	 * this from a `GenerationConfig`; webFull pushes the construction to
	 * the caller so this file stays free of phaseGenerator types.
	 */
	startSession(snapshot: Record<string, unknown>): void {
		this.logs = [];
		this.startTime = Date.now();
		this.configSnapshot = snapshot;
		this.log('info', 'Generation session started', this.configSnapshot);
	}

	/**
	 * Add a log entry. When the buffer reaches `maxLogs`, the oldest 10%
	 * are dropped to prevent unbounded memory growth.
	 */
	log(type: WizardDebugLogEntry['type'], message: string, data?: Record<string, unknown>): void {
		if (this.logs.length >= this.maxLogs) {
			this.logs = this.logs.slice(-Math.floor(this.maxLogs * 0.9));
		}

		this.logs.push({
			timestamp: Date.now(),
			type,
			message,
			data,
		});
	}

	/** Get elapsed time since session start. */
	getElapsedMs(): number {
		return Date.now() - this.startTime;
	}

	/** Export logs as a downloadable JSON-shaped object. */
	exportLogs(): {
		sessionInfo: Record<string, unknown>;
		logs: WizardDebugLogEntry[];
		summary: Record<string, unknown>;
	} {
		const summary = {
			totalLogs: this.logs.length,
			elapsedMs: this.getElapsedMs(),
			logsByType: this.logs.reduce(
				(acc, log) => {
					acc[log.type] = (acc[log.type] || 0) + 1;
					return acc;
				},
				{} as Record<string, number>
			),
			dataChunksReceived: this.logs.filter((l) => l.type === 'data').length,
			filesDetected: this.logs.filter((l) => l.type === 'file').length,
			errors: this.logs.filter((l) => l.type === 'error').map((l) => l.message),
		};

		return {
			sessionInfo: {
				...this.configSnapshot,
				startTime: this.startTime,
				exportTime: Date.now(),
				userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
				platform: typeof navigator !== 'undefined' ? navigator.platform : 'unknown',
			},
			logs: this.logs,
			summary,
		};
	}

	/**
	 * Download logs as a JSON file. Browser-only — relies on DOM + Blob.
	 * Safe to call from webFull since this module is renderer-side.
	 */
	downloadLogs(): void {
		const data = this.exportLogs();
		const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
		const url = URL.createObjectURL(blob);
		const a = document.createElement('a');
		a.href = url;
		a.download = `wizard-debug-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);
		URL.revokeObjectURL(url);
	}

	/** Get the current logs (for display or analysis). */
	getLogs(): WizardDebugLogEntry[] {
		return [...this.logs];
	}

	/** Clear all logs. */
	clear(): void {
		this.logs = [];
		this.startTime = 0;
		this.configSnapshot = {};
	}
}

/**
 * Singleton debug logger instance — same shape as the renderer's
 * `wizardDebugLogger` export so consumers can swap imports verbatim.
 */
export const wizardDebugLogger = new WizardDebugLogger();
