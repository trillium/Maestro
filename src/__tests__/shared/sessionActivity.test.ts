/**
 * Tests for the shared session-activity types module.
 *
 * Covers the `isActive` threshold helper across the
 * EXTERNAL_ACTIVITY_ACTIVE_MS boundary so that consumers (thinking pill,
 * stats listener, etc.) can rely on consistent active/idle classification.
 */

import { describe, it, expect } from 'vitest';
import {
	EXTERNAL_ACTIVITY_ACTIVE_MS,
	EXTERNAL_ACTIVITY_IDLE_MS,
	isActive,
	type SessionActivityEvent,
} from '../../shared/sessionActivity';

const baseEvent = (lastActivityAt: number): SessionActivityEvent => ({
	agentId: 'claude-code',
	sessionId: 'session-abc',
	projectPath: '/projects/test',
	lastActivityAt,
	source: 'external',
	sizeBytes: 0,
});

describe('sessionActivity', () => {
	describe('constants', () => {
		it('exposes the documented active and idle thresholds', () => {
			expect(EXTERNAL_ACTIVITY_ACTIVE_MS).toBe(3000);
			expect(EXTERNAL_ACTIVITY_IDLE_MS).toBe(30000);
		});

		it('keeps the active window strictly shorter than the idle window', () => {
			// Sanity guard: an "active" event should never already be classified
			// as idle, otherwise UI would flicker on the boundary.
			expect(EXTERNAL_ACTIVITY_ACTIVE_MS).toBeLessThan(EXTERNAL_ACTIVITY_IDLE_MS);
		});
	});

	describe('isActive', () => {
		it('returns true when the event is fresh (now == lastActivityAt)', () => {
			const now = 1_700_000_000_000;
			expect(isActive(baseEvent(now), now)).toBe(true);
		});

		it('returns true exactly at the active threshold (boundary inclusive)', () => {
			const now = 1_700_000_000_000;
			const lastActivityAt = now - EXTERNAL_ACTIVITY_ACTIVE_MS;
			expect(isActive(baseEvent(lastActivityAt), now)).toBe(true);
		});

		it('returns false 1ms past the active threshold', () => {
			const now = 1_700_000_000_000;
			const lastActivityAt = now - EXTERNAL_ACTIVITY_ACTIVE_MS - 1;
			expect(isActive(baseEvent(lastActivityAt), now)).toBe(false);
		});

		it('returns false for events well outside the active window', () => {
			const now = 1_700_000_000_000;
			const lastActivityAt = now - EXTERNAL_ACTIVITY_IDLE_MS;
			expect(isActive(baseEvent(lastActivityAt), now)).toBe(false);
		});

		it('defaults the clock to Date.now() when omitted', () => {
			const event = baseEvent(Date.now());
			expect(isActive(event)).toBe(true);
		});

		it('handles future lastActivityAt without false-negatives (clock skew)', () => {
			// If a remote/SSH host clock runs slightly ahead, lastActivityAt may
			// be in our future. Treat as active rather than dropping the event.
			const now = 1_700_000_000_000;
			expect(isActive(baseEvent(now + 500), now)).toBe(true);
		});
	});
});
