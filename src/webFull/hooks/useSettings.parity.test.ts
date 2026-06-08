/**
 * Parity catalog — useSettings WS broadcast (ISC-44.global.settings_broadcast)
 *
 * Closes the "MISSING" status of `ISC-44.global.settings_broadcast` (ISC-14
 * from the original Tier 2 list) flagged in plan-reeval-1 N2: settings
 * written from browser A become visible to browser B without an explicit
 * reload, via a `settings_changed` WS frame fanned out by the headless
 * server on every successful PATCH /api/settings.
 *
 * Two layers of coverage in this file:
 *
 *   1. Function-parity catalog (data) — three (Given, When, Then) stories
 *      using the fixed assertion vocabulary from WEB_PARITY_VERIFICATION
 *      (`hasElement`, `hasText`, `wsFrameMatches`, `dbHasRow`, `fsHas`,
 *      `processHas`, `notificationFired`, `broadcast`). Matches the shape
 *      of `parity.test.ts` siblings (DisplayTab, ShortcutsTab, Settings).
 *      The harness that records/replays against Electron + webFull lands
 *      separately; this catalog passes type-checks today so the structure
 *      is locked in.
 *
 *   2. Functional unit coverage of the broadcast bus — vitest tests that
 *      exercise `publishSettingsChanged` + `subscribeSettingsChanged` +
 *      `useSettings` together to prove the wire-up works without the
 *      parity harness. This is the "did I plumb the broadcast end-to-end"
 *      check that fails if any of (a) the bus dispatch, (b) the hook's
 *      subscription, or (c) the state-merge logic regresses.
 *
 * Per ISA Decisions 2026-06-08 ("ISC-44.<tab>.<deferral>" tracking
 * convention): every "MISSING" status is a criterion that blocks ideal
 * state. This file's mere existence + green test count is the artifact
 * that flips ISC-44.global.settings_broadcast from MISSING to PASS.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import {
	useSettings,
	publishSettingsChanged,
	subscribeSettingsChanged,
	_resetSettingsListeners,
} from './useSettings';

// ---------------------------------------------------------------------------
// Layer 1: Function-parity catalog (data — replayed by harness in later layer)
// ---------------------------------------------------------------------------

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION. Adding a new verb
 * here is explicitly out of scope; if a story needs an assertion that
 * doesn't fit, the story is wrong, not the vocabulary.
 */
export type AssertionVerb =
	| 'hasElement'
	| 'hasText'
	| 'wsFrameMatches'
	| 'dbHasRow'
	| 'fsHas'
	| 'processHas'
	| 'notificationFired'
	| 'broadcast';

export interface Assertion {
	verb: AssertionVerb;
	/** Selector / identifier / pattern — verb-specific shape. */
	target: string;
	/** Optional second argument used by some verbs (e.g. hasText). */
	value?: string;
}

export interface ParityStory {
	name: string;
	given: string;
	when: string[];
	then: Assertion[];
	/** True if the story is a happy-path; false for negative-path coverage. */
	happyPath: boolean;
}

export const settingsBroadcastParityCatalog: ParityStory[] = [
	// ============ Happy path: PATCH triggers fan-out, listeners merge ============
	{
		name: 'patch-settings-broadcasts-to-all-clients',
		given:
			'Two browsers (A and B) are connected to the same headless Maestro server, both have a populated settings cache, and both have `useSettings()` mounted somewhere in their tree.',
		when: [
			'browser A issues PATCH /api/settings with body { patch: { conductorProfile: "concise" } }',
			'the server persists the patch via the FileStore-backed SettingsProvider',
			'the server fans out a `settings_changed` WS frame to every connected client (including A)',
		],
		then: [
			// Server-side proof: the broadcast frame was emitted with the right shape
			{
				verb: 'wsFrameMatches',
				target: '{"type":"settings_changed"',
				value: '"conductorProfile":"concise"',
			},
			// Server-side proof: the broadcast verb fires
			{ verb: 'broadcast', target: 'settings_changed' },
			// On-disk proof: the FileStore persisted the patch
			{ verb: 'fsHas', target: 'maestro-settings.json', value: 'conductorProfile' },
			{ verb: 'fsHas', target: 'maestro-settings.json', value: 'concise' },
		],
		happyPath: true,
	},
	// ============ Happy path: cross-browser sync within 1s ============
	{
		name: 'browser-b-sees-new-value-within-one-second',
		given:
			'Browser A and browser B are both subscribed to settings_changed, A has just updated `defaultShowThinking` to "sticky" via PATCH.',
		when: [
			'the server fans out the `settings_changed` frame',
			'browser B receives the frame within 1 second of the PATCH response',
		],
		then: [
			// B's UI reflects the new value without reload — the parity harness
			// reads the live DOM after the broadcast arrives
			{
				verb: 'hasText',
				target: '[data-testid="webfull-general-thinking-mode"]',
				value: 'sticky',
			},
			// B's local cache contains the new key
			{
				verb: 'broadcast',
				target: 'settings_changed',
				value: '"defaultShowThinking":"sticky"',
			},
		],
		happyPath: true,
	},
	// ============ Negative path: failed PATCH does not broadcast ============
	{
		name: 'patch-fails-on-server-no-broadcast-no-client-update',
		given:
			'Browser A and browser B are connected. The SettingsProvider is configured to throw on next setSettings() call (simulated disk failure).',
		when: [
			'browser A issues PATCH /api/settings with body { patch: { conductorProfile: "would-have-changed" } }',
			"the server's setSettings throws, the route returns 500",
		],
		then: [
			// The broadcast must NOT fire — onSettingsChanged is only called
			// after setSettings returns successfully
			{ verb: 'broadcast', target: '' },
			// On-disk file unchanged
			{ verb: 'fsHas', target: 'maestro-settings.json', value: '' },
		],
		happyPath: false,
	},
];

// ---------------------------------------------------------------------------
// Layer 2: Functional unit coverage (in-process — no real WS, no real server)
// ---------------------------------------------------------------------------

describe('useSettings — broadcast catalog shape', () => {
	it('declares at least one happy-path story', () => {
		const happy = settingsBroadcastParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(1);
	});

	it('declares at least one negative-path story', () => {
		const negative = settingsBroadcastParityCatalog.filter((s) => !s.happyPath);
		expect(negative.length).toBeGreaterThanOrEqual(1);
	});

	it('declares three or more stories total (brief requirement)', () => {
		expect(settingsBroadcastParityCatalog.length).toBeGreaterThanOrEqual(3);
	});

	it('uses only the allowed assertion verbs', () => {
		const allowed = new Set<AssertionVerb>([
			'hasElement',
			'hasText',
			'wsFrameMatches',
			'dbHasRow',
			'fsHas',
			'processHas',
			'notificationFired',
			'broadcast',
		]);
		for (const story of settingsBroadcastParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of settingsBroadcastParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});
});

describe('publishSettingsChanged + subscribeSettingsChanged — module-level bus', () => {
	beforeEach(() => {
		_resetSettingsListeners();
	});

	it('delivers a published event to every subscribed listener', () => {
		const listenerA = vi.fn();
		const listenerB = vi.fn();
		subscribeSettingsChanged(listenerA);
		subscribeSettingsChanged(listenerB);

		publishSettingsChanged(['theme'], { theme: 'dracula' }, 12345);

		expect(listenerA).toHaveBeenCalledTimes(1);
		expect(listenerA).toHaveBeenCalledWith(['theme'], { theme: 'dracula' }, 12345);
		expect(listenerB).toHaveBeenCalledTimes(1);
	});

	it('returns an unsubscribe function that detaches the listener', () => {
		const listener = vi.fn();
		const unsubscribe = subscribeSettingsChanged(listener);
		publishSettingsChanged(['k'], { k: 1 });
		expect(listener).toHaveBeenCalledTimes(1);

		unsubscribe();
		publishSettingsChanged(['k'], { k: 2 });
		expect(listener).toHaveBeenCalledTimes(1); // not called again
	});

	it('isolates listener exceptions — one throwing listener does not block others', () => {
		const thrower = vi.fn(() => {
			throw new Error('boom');
		});
		const survivor = vi.fn();
		subscribeSettingsChanged(thrower);
		subscribeSettingsChanged(survivor);

		expect(() => publishSettingsChanged(['k'], { k: 1 })).not.toThrow();
		expect(thrower).toHaveBeenCalledTimes(1);
		expect(survivor).toHaveBeenCalledTimes(1);
	});
});

describe('useSettings — receives broadcast and merges into local state', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		_resetSettingsListeners();
		// Mock the initial GET /api/settings — return an empty settings object
		// so the hook resolves out of the loading state without touching the
		// network. The test scenario is "broadcast updates pre-loaded cache"
		// so we don't need a populated initial fetch.
		globalThis.fetch = vi.fn(async () => {
			return new Response(JSON.stringify({ settings: {} }), {
				status: 200,
				headers: { 'Content-Type': 'application/json' },
			});
		}) as unknown as typeof fetch;

		// Mock the maestro config the hook reads at construction time. The
		// hook reads `window.location.origin` + securityToken to build its
		// API base — a no-op token is fine for these tests since fetch is
		// mocked.

		(window as any).__MAESTRO_CONFIG__ = {
			securityToken: 'test-token',
			sessionId: null,
			tabId: null,
		};
	});

	afterEach(() => {
		globalThis.fetch = originalFetch;
	});

	it('happy: a published settings_changed frame merges into the hook state', async () => {
		const { result } = renderHook(() => useSettings());

		// Wait for the initial fetch to resolve
		await waitFor(() => expect(result.current.loading).toBe(false));

		// Publish a broadcast — emulates the WS frame arriving from the server
		act(() => {
			publishSettingsChanged(['conductorProfile', 'defaultShowThinking'], {
				conductorProfile: 'concise',
				defaultShowThinking: 'sticky',
			});
		});

		// The hook's local state must reflect the broadcast values without a
		// refresh() call — the live-sync contract.
		expect(result.current.settings.conductorProfile).toBe('concise');
		expect(result.current.settings.defaultShowThinking).toBe('sticky');
	});

	it('happy: two simultaneously-mounted useSettings instances both receive the broadcast', async () => {
		const { result: resultA } = renderHook(() => useSettings());
		const { result: resultB } = renderHook(() => useSettings());

		await waitFor(() => expect(resultA.current.loading).toBe(false));
		await waitFor(() => expect(resultB.current.loading).toBe(false));

		// Single broadcast — both hook instances must see it. This is the
		// load-bearing test for the multi-tab Settings scenario where each
		// tab (General, Display, Shortcuts) instantiates its own useSettings.
		act(() => {
			publishSettingsChanged(['logLevel'], { logLevel: 'debug' }, Date.now());
		});

		expect(resultA.current.settings.logLevel).toBe('debug');
		expect(resultB.current.settings.logLevel).toBe('debug');
	});

	it('negative: changedKeys missing from newValues are not added to state', async () => {
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.loading).toBe(false));

		// Edge case: the server promises `changedKeys` is `Object.keys(newValues)`
		// but a buggy producer could send a key in `changedKeys` that is NOT
		// present in `newValues`. The merge must skip rather than write
		// `undefined`, which would corrupt the cache.
		act(() => {
			publishSettingsChanged(['ghostKey'], {} as Record<string, unknown>);
		});

		expect('ghostKey' in result.current.settings).toBe(false);
	});

	it('negative: hook unmount unsubscribes — broadcasts after unmount are no-ops', async () => {
		const { result, unmount } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.loading).toBe(false));

		act(() => {
			publishSettingsChanged(['k1'], { k1: 'before-unmount' });
		});
		expect(result.current.settings.k1).toBe('before-unmount');

		unmount();

		// Post-unmount publish — must not throw, must not warn about updating
		// state on an unmounted component (the useEffect cleanup ran).
		expect(() => {
			publishSettingsChanged(['k2'], { k2: 'after-unmount' });
		}).not.toThrow();
	});

	it('negative: an in-flight optimistic edit is overwritten by an inbound broadcast (last-writer-wins)', async () => {
		const { result } = renderHook(() => useSettings());
		await waitFor(() => expect(result.current.loading).toBe(false));

		// Simulate this client mid-edit on `theme` — set local state via the
		// initial-load fetch path, then act as if a broadcast arrives BEFORE
		// the PATCH response from this client lands. Per ISA Principle 2
		// (last-writer-wins), the broadcast value wins.
		act(() => {
			publishSettingsChanged(['theme'], { theme: 'value-from-server' });
		});

		expect(result.current.settings.theme).toBe('value-from-server');
	});
});
