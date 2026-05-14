import { describe, it, expect } from 'vitest';
import {
	selectMode,
	type SelectModeInput,
	type UsageSnapshot,
} from '../../../main/agents/claude-mode-selector';

/**
 * Helper: build a SelectModeInput with the named overrides applied on top of a
 * neutral baseline (auto / no per-tab pin / no snapshot / autoFallback on / fixed clock).
 */
function buildInput(overrides: Partial<SelectModeInput> = {}): SelectModeInput {
	return {
		headlessMode: 'auto',
		perTabReason: 'auto',
		perTabMode: 'interactive',
		usageSnapshot: null,
		autoFallbackOnLimit: true,
		now: new Date('2026-05-13T12:00:00Z'),
		...overrides,
	};
}

/**
 * Helper: build a UsageSnapshot keyed at "noon", with reset windows in the future by
 * default. Callers override the percent fields per test.
 */
function buildSnapshot(overrides: Partial<UsageSnapshot> = {}): UsageSnapshot {
	return {
		sampledAt: '2026-05-13T11:55:00Z',
		configDirKey: '/Users/test/.claude',
		session: { percent: 0, resetsAt: '2026-05-13T17:00:00Z' },
		weekAllModels: { percent: 0, resetsAt: '2026-05-20T00:00:00Z' },
		weekSonnetOnly: { percent: 0, resetsAt: '2026-05-20T00:00:00Z' },
		...overrides,
	};
}

describe('selectMode', () => {
	describe('rule 1 — global setting hard-pin', () => {
		it('returns api+user when headlessMode is api, regardless of per-tab state', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'api',
						perTabReason: 'user',
						perTabMode: 'interactive',
					})
				)
			).toEqual({ mode: 'api', reason: 'user' });
		});

		it('returns interactive+user when headlessMode is interactive, regardless of per-tab state', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'interactive',
						perTabReason: 'user',
						perTabMode: 'api',
					})
				)
			).toEqual({ mode: 'interactive', reason: 'user' });
		});

		it('headlessMode setting beats per-tab limit state (test case a)', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'interactive',
						perTabReason: 'limit',
						perTabMode: 'api',
						usageSnapshot: buildSnapshot({
							session: { percent: 99, resetsAt: '2026-05-13T17:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'user' });
		});

		it('global pin ignores the usage snapshot entirely', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'api',
						usageSnapshot: buildSnapshot({
							session: { percent: 99, resetsAt: '2026-05-13T17:00:00Z' },
						}),
						autoFallbackOnLimit: false,
					})
				)
			).toEqual({ mode: 'api', reason: 'user' });
		});
	});

	describe('rule 2 — per-tab user pin under auto', () => {
		it('per-tab user pin beats auto-default (test case b)', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'auto',
						perTabReason: 'user',
						perTabMode: 'api',
					})
				)
			).toEqual({ mode: 'api', reason: 'user' });
		});

		it('per-tab user pin to interactive sticks even when snapshot is over the limit', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'auto',
						perTabReason: 'user',
						perTabMode: 'interactive',
						usageSnapshot: buildSnapshot({
							session: { percent: 99, resetsAt: '2026-05-13T17:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'user' });
		});
	});

	describe('rule 3a — session window over limit', () => {
		it('flips to api+limit when session.percent >= 95 and autoFallback on (test case c)', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							session: { percent: 95, resetsAt: '2026-05-13T17:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'api', reason: 'limit' });
		});

		it('stays interactive+auto when autoFallback is off, even at 99% (test case c, opt-out)', () => {
			expect(
				selectMode(
					buildInput({
						autoFallbackOnLimit: false,
						usageSnapshot: buildSnapshot({
							session: { percent: 99, resetsAt: '2026-05-13T17:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});

		it('does not trigger when session.percent is below threshold', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							session: { percent: 94.9, resetsAt: '2026-05-13T17:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});

		it('does not trigger when session.resetsAt has already passed', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							session: { percent: 99, resetsAt: '2026-05-13T11:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});
	});

	describe('rule 3b — weekAllModels window over limit', () => {
		it('flips to api+limit when weekAllModels.percent >= 95 and autoFallback on', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							weekAllModels: { percent: 96, resetsAt: '2026-05-20T00:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'api', reason: 'limit' });
		});

		it('stays interactive+auto when weekAllModels triggers but autoFallback is off', () => {
			expect(
				selectMode(
					buildInput({
						autoFallbackOnLimit: false,
						usageSnapshot: buildSnapshot({
							weekAllModels: { percent: 99, resetsAt: '2026-05-20T00:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});

		it('does not trigger when weekAllModels resetsAt has passed', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							weekAllModels: { percent: 99, resetsAt: '2026-05-06T00:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});

		it('weekSonnetOnly does not gate the selector (only session + weekAllModels do)', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							weekSonnetOnly: { percent: 99, resetsAt: '2026-05-20T00:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});
	});

	describe('rule 3c — sticky limit', () => {
		it('keeps api+limit when perTabReason is limit and a reset window is still future', () => {
			expect(
				selectMode(
					buildInput({
						perTabReason: 'limit',
						perTabMode: 'api',
						usageSnapshot: buildSnapshot({
							// Both percents have since dropped, but we are still inside the session reset window.
							session: { percent: 20, resetsAt: '2026-05-13T17:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'api', reason: 'limit' });
		});

		it('post-reset transition flips back to auto-interactive (test case d)', () => {
			expect(
				selectMode(
					buildInput({
						perTabReason: 'limit',
						perTabMode: 'api',
						usageSnapshot: buildSnapshot({
							session: { percent: 10, resetsAt: '2026-05-13T11:00:00Z' },
							weekAllModels: { percent: 10, resetsAt: '2026-05-06T00:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});

		it('sticky limit does not fire when usageSnapshot is null', () => {
			expect(
				selectMode(
					buildInput({
						perTabReason: 'limit',
						perTabMode: 'api',
						usageSnapshot: null,
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});
	});

	describe('rule 3d — defaults', () => {
		it('returns interactive+auto when usageSnapshot is null (test case e)', () => {
			expect(
				selectMode(
					buildInput({
						headlessMode: 'auto',
						perTabReason: 'auto',
						usageSnapshot: null,
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});

		it('returns interactive+auto when snapshot is well under limits', () => {
			expect(
				selectMode(
					buildInput({
						usageSnapshot: buildSnapshot({
							session: { percent: 50, resetsAt: '2026-05-13T17:00:00Z' },
							weekAllModels: { percent: 60, resetsAt: '2026-05-20T00:00:00Z' },
						}),
					})
				)
			).toEqual({ mode: 'interactive', reason: 'auto' });
		});
	});

	describe('purity', () => {
		it('does not mutate the input object', () => {
			const input = buildInput({
				usageSnapshot: buildSnapshot({
					session: { percent: 99, resetsAt: '2026-05-13T17:00:00Z' },
				}),
			});
			const snapshotBefore = JSON.parse(JSON.stringify(input));
			selectMode(input);
			expect(JSON.parse(JSON.stringify(input))).toEqual(snapshotBefore);
		});

		it('returns identical results for identical inputs', () => {
			const input = buildInput({
				usageSnapshot: buildSnapshot({
					session: { percent: 96, resetsAt: '2026-05-13T17:00:00Z' },
				}),
			});
			expect(selectMode(input)).toEqual(selectMode(input));
		});
	});
});
