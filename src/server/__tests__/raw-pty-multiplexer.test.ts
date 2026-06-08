/**
 * RawPtyMultiplexer tests (Layer 6.1 + L6.3 disk-backed scrollback).
 *
 * Covers L6.1 (15 tests):
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
 *
 * Covers L6.3 (≥6 disk-backed tests):
 *  10. Disk append on publish — `.log` and `.seq` files exist + grow.
 *  11. Disk read on subscribe with `fromSeq` older than in-memory ring.
 *  12. Seq index correctness across appends (entries align to byte offsets).
 *  13. File rotation at hard cap — `.log` truncates and starting seq advances.
 *  14. Cross-restart survival — fresh multiplexer with same dataDir reads
 *      pre-existing scrollback on subscribe with fromSeq=0.
 *  15. Concurrent publish + subscribe ordering — interleaved ops preserve seq.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
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

// ============================================================================
// L6.3 — Disk-backed scrollback tests
// ============================================================================
//
// Disk format (additive to L6.1's in-memory ring):
//   <dataDir>/pty-scrollback/<sessionId>.log — binary append-only log of bytes.
//   <dataDir>/pty-scrollback/<sessionId>.seq — fixed-width seq index:
//       16 bytes per entry: [seq:u32 BE | offset:u32 BE | length:u32 BE | reserved:u32 BE]
//   <dataDir>/pty-scrollback/<sessionId>.meta — JSON header for rotation:
//       { startSeq: number, startOffset: number }
//       startSeq = seq of the first entry currently retained in the .log file
//                  (advances on rotation; 1 on a fresh session).
//       startOffset = byte position in the original stream of the first byte
//                     currently in the .log file. Used to compute the "true"
//                     stream offset when consumers want it.
//
// When the .log file exceeds the hard cap, the multiplexer truncates the file
// and rewrites it starting from the current youngest in-memory entries (or
// drops history entirely if the ring is empty — we just rotate the meta).
//
// On construction with `dataDir`, the multiplexer scans `pty-scrollback/` for
// existing `.log` + `.seq` + `.meta` triplets and registers them as
// disk-only sessions. Subscribe on a disk-only session reads from disk only
// (no in-memory ring entries) up to the persisted end of the .log file.

describe('RawPtyMultiplexer — L6.3 disk-backed scrollback', () => {
	let tmpDir: string;
	let dataDir: string;
	let scrollbackDir: string;

	beforeEach(() => {
		tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'maestro-pty-l63-'));
		dataDir = tmpDir;
		scrollbackDir = path.join(dataDir, 'pty-scrollback');
	});

	afterEach(() => {
		try {
			fs.rmSync(tmpDir, { recursive: true, force: true });
		} catch {
			/* best-effort */
		}
	});

	it('publish writes append-only log and seq index to disk', () => {
		const mux = new RawPtyMultiplexer({
			dataDir,
			softRingBytes: 1024,
			hardRingBytes: 2048,
			flushIntervalMs: 5,
			flushThresholdBytes: 256,
		});
		mux.publish('s1', Buffer.from('alpha'));
		mux.publish('s1', Buffer.from('beta'));
		mux.publish('s1', Buffer.from('gamma'));

		const logPath = path.join(scrollbackDir, 's1.log');
		const seqPath = path.join(scrollbackDir, 's1.seq');
		const metaPath = path.join(scrollbackDir, 's1.meta');
		expect(fs.existsSync(logPath)).toBe(true);
		expect(fs.existsSync(seqPath)).toBe(true);
		expect(fs.existsSync(metaPath)).toBe(true);

		const logBytes = fs.readFileSync(logPath);
		expect(logBytes.toString('utf-8')).toBe('alphabetagamma');

		// Seq index: 3 entries × 16 bytes = 48 bytes.
		const seqBytes = fs.readFileSync(seqPath);
		expect(seqBytes.length).toBe(3 * 16);

		// First entry: seq=1, offset=0, length=5 ('alpha').
		expect(seqBytes.readUInt32BE(0)).toBe(1);
		expect(seqBytes.readUInt32BE(4)).toBe(0);
		expect(seqBytes.readUInt32BE(8)).toBe(5);

		// Second entry: seq=2, offset=5, length=4 ('beta').
		expect(seqBytes.readUInt32BE(16)).toBe(2);
		expect(seqBytes.readUInt32BE(20)).toBe(5);
		expect(seqBytes.readUInt32BE(24)).toBe(4);

		// Third entry: seq=3, offset=9, length=5 ('gamma').
		expect(seqBytes.readUInt32BE(32)).toBe(3);
		expect(seqBytes.readUInt32BE(36)).toBe(9);
		expect(seqBytes.readUInt32BE(40)).toBe(5);
	});

	it('subscribe with fromSeq older than in-memory ring reads from disk', () => {
		// Tight in-memory caps so the ring rotates past the oldest bytes; disk
		// retains them.
		const mux = new RawPtyMultiplexer({
			dataDir,
			softRingBytes: 32,
			hardRingBytes: 64,
			flushIntervalMs: 5,
			flushThresholdBytes: 1024,
		});
		// Push 4 × 40-byte chunks (160 bytes total). In-memory ring caps at
		// 64B so only the last 1-2 chunks survive in memory; the rest live
		// only on disk.
		const chunk = (label: string) => Buffer.from(label.padEnd(40, '.'));
		mux.publish('s1', chunk('A')); // seq 1
		mux.publish('s1', chunk('B')); // seq 2
		mux.publish('s1', chunk('C')); // seq 3
		mux.publish('s1', chunk('D')); // seq 4

		const stats = mux.getSessionStats('s1');
		expect(stats!.oldestSeq).toBeGreaterThan(1); // ring rotated

		// Subscribe with lastSeq=0 — caller wants everything from the start.
		// Disk should fill the gap that the rotated ring lost.
		const slice = mux.subscribe('s1', 'clientA', 0);
		expect(slice.bytes.length).toBe(40 * 4);
		// Bytes should start with 'A' chunk and end with 'D' chunk.
		expect(slice.bytes.slice(0, 1).toString('utf-8')).toBe('A');
		expect(slice.bytes.slice(40, 41).toString('utf-8')).toBe('B');
		expect(slice.bytes.slice(120, 121).toString('utf-8')).toBe('D');
		expect(slice.fromSeq).toBe(1);
		expect(slice.toSeq).toBe(4);
		// No drop reported — disk filled the gap exactly.
		expect(slice.droppedBeforeBackfill).toBe(0);
	});

	it('seq index byte offsets line up with the log file across appends', () => {
		const mux = new RawPtyMultiplexer({
			dataDir,
			softRingBytes: 1024 * 1024,
			hardRingBytes: 2 * 1024 * 1024,
			flushIntervalMs: 5,
			flushThresholdBytes: 1024,
		});
		const chunks = [
			Buffer.from('one'),
			Buffer.from('twothree'),
			Buffer.from('four'),
			Buffer.from('fivesixseven'),
			Buffer.from('!'),
		];
		for (const c of chunks) mux.publish('s1', c);

		const logBytes = fs.readFileSync(path.join(scrollbackDir, 's1.log'));
		const seqBytes = fs.readFileSync(path.join(scrollbackDir, 's1.seq'));
		expect(seqBytes.length).toBe(chunks.length * 16);

		let expectedOffset = 0;
		for (let i = 0; i < chunks.length; i++) {
			const seq = seqBytes.readUInt32BE(i * 16);
			const offset = seqBytes.readUInt32BE(i * 16 + 4);
			const length = seqBytes.readUInt32BE(i * 16 + 8);
			expect(seq).toBe(i + 1);
			expect(offset).toBe(expectedOffset);
			expect(length).toBe(chunks[i].length);
			// The byte slice at [offset..offset+length) in the log should be
			// exactly the published chunk.
			expect(
				logBytes.slice(offset, offset + length).toString('utf-8'),
			).toBe(chunks[i].toString('utf-8'));
			expectedOffset += length;
		}
	});

	it('rotates disk log when it exceeds the hard cap', () => {
		// Very small disk caps to force rotation quickly.
		const mux = new RawPtyMultiplexer({
			dataDir,
			softRingBytes: 256,
			hardRingBytes: 512,
			diskHardCapBytes: 512,
			flushIntervalMs: 5,
			flushThresholdBytes: 1024,
		});
		const big = Buffer.alloc(200, 0x41);
		mux.publish('s1', big); // seq 1
		mux.publish('s1', big); // seq 2 — 400 B on disk
		mux.publish('s1', big); // seq 3 — would push to 600 B, triggers rotate
		mux.publish('s1', big); // seq 4

		const logSize = fs.statSync(path.join(scrollbackDir, 's1.log')).size;
		// After rotation the log must be at or below the disk hard cap.
		expect(logSize).toBeLessThanOrEqual(512);

		// Meta file's startSeq must advance to reflect the dropped entries.
		const meta = JSON.parse(
			fs.readFileSync(path.join(scrollbackDir, 's1.meta'), 'utf-8'),
		) as { startSeq: number; startOffset: number };
		expect(meta.startSeq).toBeGreaterThan(1);
	});

	it('cross-restart survival — fresh multiplexer with same dataDir reads pre-existing scrollback', () => {
		// First multiplexer publishes some bytes.
		{
			const mux1 = new RawPtyMultiplexer({
				dataDir,
				softRingBytes: 1024,
				hardRingBytes: 2048,
				flushIntervalMs: 5,
				flushThresholdBytes: 1024,
			});
			mux1.publish('s1', Buffer.from('persisted-one '));
			mux1.publish('s1', Buffer.from('persisted-two '));
			mux1.publish('s1', Buffer.from('persisted-three'));
		}

		// Simulate `kill -9` + restart by instantiating a brand-new multiplexer
		// pointed at the same dataDir. No `publish()` calls before subscribe.
		const mux2 = new RawPtyMultiplexer({
			dataDir,
			softRingBytes: 1024,
			hardRingBytes: 2048,
			flushIntervalMs: 5,
			flushThresholdBytes: 1024,
		});

		// Subscribe with fromSeq=0 — expect to receive the persisted bytes.
		const slice = mux2.subscribe('s1', 'clientA', 0);
		expect(slice.bytes.toString('utf-8')).toBe(
			'persisted-one persisted-two persisted-three',
		);
		expect(slice.fromSeq).toBe(1);
		expect(slice.toSeq).toBe(3);
		expect(slice.droppedBeforeBackfill).toBe(0);

		// Stats should reflect the disk-recovered state: nextSeq must be > 3
		// so a follow-up publish would assign seq=4 (not collide).
		const stats = mux2.getSessionStats('s1');
		expect(stats).not.toBeNull();
		expect(stats!.nextSeq).toBe(4);

		// And a fresh publish on the restarted multiplexer should chain
		// correctly: seq=4, persisted to the same log file, recoverable on
		// another subscribe.
		mux2.publish('s1', Buffer.from(' postrestart'));
		const slice2 = mux2.subscribe('s1', 'clientB', 0);
		expect(slice2.bytes.toString('utf-8')).toBe(
			'persisted-one persisted-two persisted-three postrestart',
		);
	});

	it('concurrent publish + subscribe ordering preserves seq monotonicity', async () => {
		const mux = new RawPtyMultiplexer({
			dataDir,
			softRingBytes: 16384,
			hardRingBytes: 32768,
			flushIntervalMs: 5,
			flushThresholdBytes: 256,
		});
		const { broadcaster, data } = makeBroadcaster();
		mux.setBroadcaster(broadcaster);
		mux.subscribe('s1', 'clientA');

		// Interleave 20 publishes and one subscribe in the middle.
		const sent: string[] = [];
		for (let i = 0; i < 10; i++) {
			const tag = `chunk${i}-`;
			mux.publish('s1', Buffer.from(tag));
			sent.push(tag);
		}
		// Subscribe a second client mid-stream. It should see backfill for
		// what we already sent, then live data for what follows.
		const slice = mux.subscribe('s1', 'clientB', 0);
		expect(slice.bytes.toString('utf-8')).toBe(sent.join(''));
		for (let i = 10; i < 20; i++) {
			const tag = `chunk${i}-`;
			mux.publish('s1', Buffer.from(tag));
			sent.push(tag);
		}

		// Drain pending flushes.
		await new Promise((r) => setTimeout(r, RAW_PTY_FLUSH_INTERVAL_MS + 50));

		// Every captured broadcast must have a seq strictly larger than the
		// one before it (per client).
		const perClient = new Map<string, number[]>();
		for (const d of data) {
			if (!perClient.has(d.clientId)) perClient.set(d.clientId, []);
			perClient.get(d.clientId)!.push(d.seq);
		}
		for (const [, seqs] of perClient) {
			for (let i = 1; i < seqs.length; i++) {
				expect(seqs[i]).toBeGreaterThan(seqs[i - 1]);
			}
		}

		// Disk must hold every published chunk in seq order.
		const logBytes = fs.readFileSync(path.join(scrollbackDir, 's1.log'));
		expect(logBytes.toString('utf-8')).toBe(sent.join(''));

		// And a third client subscribing fresh after everything should see
		// the full stream from disk.
		const slice3 = mux.subscribe('s1', 'clientC', 0);
		expect(slice3.bytes.toString('utf-8')).toBe(sent.join(''));
		expect(slice3.toSeq).toBe(20);
	});

	it('scans pty-scrollback/ on construction and registers disk-only sessions', () => {
		// Manually pre-stage a session file (simulating a server that crashed
		// before this multiplexer instance existed).
		fs.mkdirSync(scrollbackDir, { recursive: true });
		const logPath = path.join(scrollbackDir, 'preexisting.log');
		const seqPath = path.join(scrollbackDir, 'preexisting.seq');
		const metaPath = path.join(scrollbackDir, 'preexisting.meta');
		const payload = Buffer.from('legacy-bytes');
		fs.writeFileSync(logPath, payload);
		// One seq entry: seq=1, offset=0, length=12, reserved=0.
		const seqBuf = Buffer.alloc(16);
		seqBuf.writeUInt32BE(1, 0);
		seqBuf.writeUInt32BE(0, 4);
		seqBuf.writeUInt32BE(payload.length, 8);
		seqBuf.writeUInt32BE(0, 12);
		fs.writeFileSync(seqPath, seqBuf);
		fs.writeFileSync(
			metaPath,
			JSON.stringify({ startSeq: 1, startOffset: 0 }),
		);

		const mux = new RawPtyMultiplexer({ dataDir });

		// The disk-only session should appear in active sessions.
		expect(mux.getActiveSessionIds()).toContain('preexisting');

		const slice = mux.subscribe('preexisting', 'clientA', 0);
		expect(slice.bytes.toString('utf-8')).toBe('legacy-bytes');
		expect(slice.fromSeq).toBe(1);
		expect(slice.toSeq).toBe(1);
	});
});
