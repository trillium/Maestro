/**
 * Claude headless-mode selector.
 *
 * Pure function that decides whether the spawner should launch Claude in `api` mode
 * (real `claude --print`, bills the API) or `interactive` mode (the `maestro-p` wrapper
 * that drives Claude's TUI to preserve a Max plan quota). The decision combines:
 *
 *   - the global setting (`claudeCode.headlessMode`),
 *   - the per-tab state recorded on `Session.claudeInteractive`,
 *   - the latest `UsageSnapshot` from the usage store (when `headlessMode === 'auto'`),
 *   - and the `claudeCode.autoFallbackToApiOnLimit` setting.
 *
 * No side effects. No I/O. Deterministic given identical inputs — exists primarily so
 * the rule table is unit-testable in isolation from the spawner plumbing.
 */

/**
 * Shape returned by `maestro-p --status`. The full snapshot also lives on disk in the
 * `claude-usage-snapshots` electron-store namespace (see `claudeUsageStore.ts`). The
 * selector only reads the percent + resetsAt fields it needs for limit decisions, but
 * the type is declared in full so the store can re-use it.
 */
export interface UsageSnapshot {
	/** ISO timestamp when `maestro-p --status` produced this snapshot. */
	sampledAt: string;
	/** Canonical resolved `CLAUDE_CONFIG_DIR` the snapshot belongs to. */
	configDirKey: string;
	session: { percent: number; resetsAt: string };
	weekAllModels: { percent: number; resetsAt: string };
	weekSonnetOnly: { percent: number; resetsAt: string };
}

export type ClaudeHeadlessMode = 'interactive' | 'api' | 'auto';
export type ClaudeModeReason = 'user' | 'auto' | 'limit';
export type ResolvedClaudeMode = 'interactive' | 'api';

/** Threshold (in percent) at which the auto-fallback rule trips. */
export const LIMIT_THRESHOLD_PERCENT = 95;

export interface SelectModeInput {
	/** Global setting (`claudeCode.headlessMode`). */
	headlessMode: ClaudeHeadlessMode;
	/** Per-tab reason from `session.claudeInteractive.modeReason`. */
	perTabReason: ClaudeModeReason;
	/** Per-tab resolved mode from `session.claudeInteractive.mode`. */
	perTabMode: ResolvedClaudeMode;
	/** Latest snapshot keyed by the tab's `CLAUDE_CONFIG_DIR`, or null if none sampled yet. */
	usageSnapshot: UsageSnapshot | null;
	/** `claudeCode.autoFallbackToApiOnLimit` — gates whether the >=95% rule may flip to api. */
	autoFallbackOnLimit: boolean;
	/** Injected clock; tests pin this. */
	now: Date;
}

export interface SelectModeResult {
	mode: ResolvedClaudeMode;
	reason: ClaudeModeReason;
}

/**
 * Resolve which Claude backend to spawn for the next turn. See module doc for the rule
 * table; tests in `claude-mode-selector.test.ts` are the executable spec.
 */
export function selectMode(input: SelectModeInput): SelectModeResult {
	const { headlessMode, perTabReason, perTabMode, usageSnapshot, autoFallbackOnLimit, now } = input;

	// Rule 1: an explicit global pin (`interactive` or `api`, anything other than `auto`)
	// wins over per-tab state. Treat the setting as a user-level pin.
	if (headlessMode === 'interactive' || headlessMode === 'api') {
		return { mode: headlessMode, reason: 'user' };
	}

	// Rule 2: per-tab manual override (overlay-menu toggle) wins under `auto`.
	if (perTabReason === 'user') {
		return { mode: perTabMode, reason: 'user' };
	}

	// Rule 3: `auto` mode — consult the snapshot if we have one.
	if (usageSnapshot) {
		const sessionResetsAt = new Date(usageSnapshot.session.resetsAt);
		const weekResetsAt = new Date(usageSnapshot.weekAllModels.resetsAt);

		const sessionOverLimit =
			usageSnapshot.session.percent >= LIMIT_THRESHOLD_PERCENT && now < sessionResetsAt;
		const weekOverLimit =
			usageSnapshot.weekAllModels.percent >= LIMIT_THRESHOLD_PERCENT && now < weekResetsAt;

		if (sessionOverLimit || weekOverLimit) {
			// User opted out of auto-fallback → stay interactive and let the next turn hit the
			// "limit reached" surface inside Claude's TUI instead of silently switching billing.
			return autoFallbackOnLimit
				? { mode: 'api', reason: 'limit' }
				: { mode: 'interactive', reason: 'auto' };
		}

		// Sticky-limit: if a prior turn already flipped this tab to `limit` and any tracked
		// reset window is still in the future, stay on api to avoid ping-ponging across
		// snapshot refreshes that oscillate around the threshold.
		if (perTabReason === 'limit' && (now < sessionResetsAt || now < weekResetsAt)) {
			return { mode: 'api', reason: 'limit' };
		}
	}

	// Default for `auto`: attempt interactive. Snapshot-less tabs also land here; the
	// spawner samples after the first turn so subsequent calls have data to consult.
	return { mode: 'interactive', reason: 'auto' };
}
