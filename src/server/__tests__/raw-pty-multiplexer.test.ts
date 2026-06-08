/**
 * RawPtyMultiplexer tests (Layer 6.1).
 *
 * Covers:
 *   1. Monotonic seq across publishes.
 *   2. Subscribe-after-publish delivers backfill in seq order.
 *   3. Subscribe-then-publish delivers live data via broadcaster.
 *   4. Ring buffer wraparound: when total bytes exceeds hard cap, oldest
 *      entries are evicted and `oldestSeq` advances.
 *   5. Drop-with-marker semantics: a client whose `lastSeq` predates
 *      `oldestSeq` gets `droppedBeforeBackfill > 0`.
 *   6. Unsubscribe stops live delivery to that client; other subscribers
 *      keep receiving.
 *   7. `unsubscribeAll` evicts a client from every session.
 *   8. Coalesce flush threshold fires immediately on large publishes
 *      without waiting for the timer.
 *   9. EventEmitter producer wiring: emitting `raw-pty-data` lands in the
 *      session's ring.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import {
	RawPtyMultiplexer,
	type RawPtyBroadcaster,
	RAW_PTY_FLUSH_INTERVAL_MS,
} from '../raw-pty-multiplexer';

interface Captured {
	clientId: string;
	sessionId: string;
	bytes: Buffer;
	seq: number;
}

function makeBroadcaster(): {
	broadcaster: RawPtyBroadcaster;
	data: Captured[];
	dropped: Array<{ clientId: string; sessionId: string; droppedBytes: number; lastSeq: number }>;
} {
	const data: Captured[] = [];
	const dropped: Array<{
		clientId: string;
		sessionId: string;
		droppedBytes: number;
		lastSeq: number;
	}> = [];
	const broadcaster: RawPtyBroadcaster = {
		sendData(clientId, sessionId, bytes, seq) {
			// Clone bytes so the test doesn't share buffer memory with the mux.
			data.push({ clientId, sessionId, bytes: Buffer.from(bytes), seq });
		},
		sendDropped(clientId, sessionId, droppedBytes, lastSeq) {
			dropped.push({ clientId, sessionId, droppedBytes, lastSeq });
		},
	};
	return { broadcaster, data, dropped };
}

describe('RawPtyMultiplexer', () => {
	let mux: RawPtyMultiplexer;

	beforeEach(() => {
		mux = new RawPtyMultiplexer({
			// Tight bounds so we can exercise wraparound without GB of data.
			softRingBytes: 1024,
			hardRingBytes: 2048,
			flushIntervalMs: 5,
			flushThresholdBytes: 256,
		});
	});

	it('assigns monotonic, strictly-increasing seq numbers', () => {
		mux.publish('s1', Buffer.from('a'));
		mux.publish('s1', Buffer.from('b'));
		mux.publish('s1', Buffer.from('c'));
		const stats = mux.getSessionStats('s1');
		expect(stats).not.toBeNull();
		expect(stats!.nextSeq).toBe(4); // 1, 2, 3 assigned → next is 4
		expect(stats!.oldestSeq).toBe(1);
		expect(stats!.ringLength).toBe(3);
	});

	it('subscribe-after-publish delivers backfill bytes in order', () => {
		mux.publish('s1', Buffer.from('hello '));
		mux.publish('s1', Buffer.from('world'));
		const { broadcaster, data } = makeBroadcaster();
		mux.setBroadcaster(broadcaster);
		const slice = mux.subscribe('s1', 'clientA');
		expect(slice.bytes.toString('utf-8')).toBe('hello world');
		expect(slice.fromSeq).toBe(1);
		expect(slice.toSeq).toBe(2);
		expect(slice.droppedBeforeBackfill).toBe(0);
		// No live data yet — backfill is delivered separately by the caller.
		expect(data.length).toBe(0);
	});

	it('subscribe-then-publish delivers live data through broadcaster', async () => {
		const { broadcaster, data } = makeBroadcaster();
		mux.setBroadcaster(broadcaster);
		mux.subscribe('s1', 'clientA');
		mux.publish('s1', Buffer.from('live1'));
		// Flush is timer-based; wait one tick longer than the interval.
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		expect(data.length).toBe(1);
		expect(data[0].clientId).toBe('clientA');
		expect(data[0].bytes.toString('utf-8')).toBe('live1');
		expect(data[0].seq).toBe(1);
	});

	it('ring buffer drops oldest entries when hard cap exceeded', () => {
		// Hard cap is 2048 in beforeEach. Push 4 × 800-byte chunks (3200 total).
		const big = Buffer.alloc(800, 0x41); // 'A' × 800
		mux.publish('s1', big);
		mux.publish('s1', big);
		mux.publish('s1', big);
		mux.publish('s1', big);
		const stats = mux.getSessionStats('s1');
		expect(stats).not.toBeNull();
		// At most floor(2048/800) = 2 entries fit. Ring evicted oldest until
		// totalBytes <= hardCap.
		expect(stats!.totalBytes).toBeLessThanOrEqual(2048);
		expect(stats!.ringLength).toBeLessThanOrEqual(3);
		// oldestSeq advances as entries are evicted. We pushed 4 entries
		// (seq 1..4), nextSeq is 5. At least one entry was evicted.
		expect(stats!.nextSeq).toBe(5);
		expect(stats!.oldestSeq).toBeGreaterThan(1);
	});

	it('subscribe with lastSeq < oldestSeq reports droppedBeforeBackfill > 0', () => {
		// Push enough to force eviction.
		const big = Buffer.alloc(800, 0x41);
		mux.publish('s1', big); // seq 1
		mux.publish('s1', big); // seq 2
		mux.publish('s1', big); // seq 3
		mux.publish('s1', big); // seq 4 — should evict seq 1
		const stats = mux.getSessionStats('s1');
		expect(stats!.oldestSeq).toBeGreaterThan(1);
		// Subscribe claiming we last saw seq=1; ring has rotated past it.
		const slice = mux.subscribe('s1', 'clientA', 1);
		expect(slice.droppedBeforeBackfill).toBeGreaterThan(0);
		// Backfill still delivers what survives.
		expect(slice.bytes.length).toBeGreaterThan(0);
		expect(slice.fromSeq).toBe(stats!.oldestSeq);
	});

	it('subscribe with lastSeq at current tail returns empty backfill, no drops', () => {
		mux.publish('s1', Buffer.from('x'));
		mux.publish('s1', Buffer.from('y'));
		// nextSeq=3, tail seq=2. Subscribe claiming we already saw 2.
		const slice = mux.subscribe('s1', 'clientA', 2);
		expect(slice.bytes.length).toBe(0);
		expect(slice.fromSeq).toBeNull();
		expect(slice.toSeq).toBeNull();
		expect(slice.droppedBeforeBackfill).toBe(0);
	});

	it('unsubscribe stops live delivery for that client only', async () => {
		const { broadcaster, data } = makeBroadcaster();
		mux.setBroadcaster(broadcaster);
		mux.subscribe('s1', 'clientA');
		mux.subscribe('s1', 'clientB');
		mux.publish('s1', Buffer.from('first'));
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		const initialCount = data.length;
		expect(initialCount).toBe(2); // both clients
		mux.unsubscribe('s1', 'clientA');
		mux.publish('s1', Buffer.from('second'));
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		// Only clientB receives 'second'.
		const secondRound = data.slice(initialCount);
		expect(secondRound.length).toBe(1);
		expect(secondRound[0].clientId).toBe('clientB');
		expect(secondRound[0].bytes.toString('utf-8')).toBe('second');
	});

	it('unsubscribeAll evicts a client from every session', async () => {
		const { broadcaster, data } = makeBroadcaster();
		mux.setBroadcaster(broadcaster);
		mux.subscribe('s1', 'clientA');
		mux.subscribe('s2', 'clientA');
		mux.subscribe('s2', 'clientB');
		mux.unsubscribeAll('clientA');
		mux.publish('s1', Buffer.from('one'));
		mux.publish('s2', Buffer.from('two'));
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		// Only clientB on s2 should receive anything.
		expect(data.length).toBe(1);
		expect(data[0].clientId).toBe('clientB');
		expect(data[0].sessionId).toBe('s2');
	});

	it('flush threshold fires immediately on large publishes', () => {
		const { broadcaster, data } = makeBroadcaster();
		mux.setBroadcaster(broadcaster);
		mux.subscribe('s1', 'clientA');
		// flushThresholdBytes is 256 in beforeEach; publish 300 → immediate flush.
		const chunk = Buffer.alloc(300, 0x42);
		mux.publish('s1', chunk);
		// No await — threshold path is synchronous.
		expect(data.length).toBe(1);
		expect(data[0].bytes.length).toBe(300);
	});

	it('EventEmitter producer wiring lands bytes in the ring', () => {
		const emitter = new EventEmitter();
		mux.attachProducer(emitter);
		emitter.emit('raw-pty-data', 's1', Buffer.from('from-emitter'));
		const stats = mux.getSessionStats('s1');
		expect(stats).not.toBeNull();
		expect(stats!.totalBytes).toBe('from-emitter'.length);
		expect(stats!.nextSeq).toBe(2);
		// Detach so subsequent emits do not affect.
		mux.detachProducer();
		emitter.emit('raw-pty-data', 's1', Buffer.from('after-detach'));
		const after = mux.getSessionStats('s1');
		// totalBytes unchanged.
		expect(after!.totalBytes).toBe('from-emitter'.length);
	});

	it('empty publishes are no-ops (do not advance seq)', () => {
		mux.publish('s1', Buffer.alloc(0));
		const stats = mux.getSessionStats('s1');
		// Session is not created for zero-byte publishes — the path returns
		// before ensureSession() runs. Either null OR nextSeq=1 is acceptable.
		if (stats !== null) {
			expect(stats.nextSeq).toBe(1);
			expect(stats.ringLength).toBe(0);
		}
	});

	it('removeSession purges all state for that session', () => {
		mux.publish('s1', Buffer.from('a'));
		mux.publish('s2', Buffer.from('b'));
		expect(mux.getActiveSessionIds().sort()).toEqual(['s1', 's2']);
		mux.removeSession('s1');
		expect(mux.getActiveSessionIds()).toEqual(['s2']);
		expect(mux.getSessionStats('s1')).toBeNull();
	});

	it('does not deliver duplicate live messages for backfilled bytes', async () => {
		// Pre-populate ring, then subscribe — backfill returns those bytes.
		// Subsequent live publishes should ONLY deliver new bytes, not the
		// already-backfilled ones.
		const { broadcaster, data } = makeBroadcaster();
		mux.publish('s1', Buffer.from('old1'));
		mux.publish('s1', Buffer.from('old2'));
		mux.setBroadcaster(broadcaster);
		const slice = mux.subscribe('s1', 'clientA');
		expect(slice.bytes.toString('utf-8')).toBe('old1old2');
		// Now publish new bytes — only those should be delivered live.
		mux.publish('s1', Buffer.from('new1'));
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		expect(data.length).toBe(1);
		expect(data[0].bytes.toString('utf-8')).toBe('new1');
		expect(data[0].seq).toBe(3);
	});

	it('multiple sessions maintain independent seq counters and rings', () => {
		mux.publish('s1', Buffer.from('a'));
		mux.publish('s2', Buffer.from('b'));
		mux.publish('s1', Buffer.from('c'));
		const s1 = mux.getSessionStats('s1');
		const s2 = mux.getSessionStats('s2');
		expect(s1!.nextSeq).toBe(3); // 1, 2 used
		expect(s2!.nextSeq).toBe(2); // 1 used
		expect(s1!.totalBytes).toBe(2);
		expect(s2!.totalBytes).toBe(1);
	});

	it('broadcaster set after subscribe is honored on subsequent publishes', async () => {
		const subscribeBeforeBroadcaster = vi.fn();
		const { broadcaster, data } = makeBroadcaster();
		// Subscribe first, no broadcaster yet.
		mux.subscribe('s1', 'clientA');
		// Publish without broadcaster — should not throw, queues live data,
		// but cannot deliver.
		mux.publish('s1', Buffer.from('pre'));
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		expect(subscribeBeforeBroadcaster).not.toHaveBeenCalled();
		expect(data.length).toBe(0);
		// Now install broadcaster and publish again — delivery resumes.
		mux.setBroadcaster(broadcaster);
		mux.publish('s1', Buffer.from('post'));
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 20));
		// We won't get 'pre' back (it was flushed without a broadcaster), but
		// 'post' should land.
		const postEntries = data.filter((d) => d.bytes.toString('utf-8') === 'post');
		expect(postEntries.length).toBe(1);
	});
});
