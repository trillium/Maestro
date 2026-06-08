/**
 * RawPtyMultiplexer — per-session ring buffer + monotonic seq + subscriber set
 * for streaming raw PTY bytes to web clients (Layer 6.1).
 *
 * Architecture rationale (additive, not replacement):
 *   - PtySpawner continues to emit ANSI-stripped data via DataBufferManager.
 *     Desktop renderer (TerminalOutput.tsx) consumes that stream unchanged.
 *   - PtySpawner ALSO emits raw bytes via a new 'raw-pty-data' event on the
 *     ProcessManager EventEmitter. This multiplexer subscribes there and is
 *     the only consumer of the raw path. The desktop renderer never sees
 *     these bytes; web clients with an active `pty_subscribe` do.
 *   - One instance, owns one ring buffer per active session, owns one
 *     subscriber set per session keyed by clientId.
 *
 * Budget parameters (per scoping doc §1.6 / §3):
 *   SOFT_RING_BYTES = 4 MB — typical retained scrollback per session.
 *   HARD_RING_BYTES = 8 MB — drop-oldest threshold; never exceeded.
 *   FLUSH_INTERVAL_MS = 5 — coalesce window for live broadcast.
 *   FLUSH_THRESHOLD_BYTES = 32 KB — early-flush threshold.
 *
 * Encoding choice (per scoping doc §6.4 Option B):
 *   base64 over JSON for protocol uniformity. ~33% wire overhead vs raw
 *   binary frames, but keeps the WS surface single-protocol and matches
 *   every other message type. Binary frames deferred to L6.3+ if measured
 *   bandwidth warrants it.
 *
 * What this module deliberately does NOT do:
 *   - No `lastCommand` echo-filter mitigation (scoping doc §8.3) — deferred
 *     with the TODO below.
 *   - No persistence across server restarts (ring is in-memory only; that's
 *     L6.3 scope per the brief).
 *   - No `socket.bufferedAmount` watchdog (the client-side renderer and the
 *     per-session ring are sufficient backpressure for L6.1; the watchdog is
 *     a polish item if real-world traffic shows pressure).
 */

import type { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';

// ---- Tuning constants (exported for tests and ops dashboards) -------------

export const RAW_PTY_SOFT_RING_BYTES = 4 * 1024 * 1024; // 4 MB
export const RAW_PTY_HARD_RING_BYTES = 8 * 1024 * 1024; // 8 MB
export const RAW_PTY_FLUSH_INTERVAL_MS = 5;
export const RAW_PTY_FLUSH_THRESHOLD_BYTES = 32 * 1024; // 32 KB

// ---- L6.3 disk persistence constants --------------------------------------

/**
 * Per-session log-file hard cap. When the on-disk `<sessionId>.log` exceeds
 * this size, the multiplexer rotates: truncates the log + seq index and
 * advances the `.meta` startSeq so subscribe still computes the right gap
 * for clients that asked for an earlier seq.
 *
 * Matches the in-memory hard cap by default; sized to be small enough that
 * a multi-day-old terminal doesn't grow unbounded on mini2's disk, and
 * large enough to hold a meaningful tail of activity per session.
 */
export const RAW_PTY_DISK_HARD_CAP_BYTES = 8 * 1024 * 1024; // 8 MB

/**
 * Sub-directory of `dataDir` where per-session scrollback files live. One
 * triplet per session: `<sessionId>.log` (raw bytes append-only),
 * `<sessionId>.seq` (fixed-width index: 16 B per entry), `<sessionId>.meta`
 * (rotation marker JSON).
 */
const SCROLLBACK_SUBDIR = 'pty-scrollback';

/**
 * Width of one seq-index record on disk. Fixed-width records keep the index
 * cheap to scan/append: O(1) seek to record N at offset N*16.
 *
 * Layout per record (all big-endian uint32):
 *   [0..4)   seq      — monotonic seq assigned when the chunk was published.
 *   [4..8)   offset   — byte offset in `<sessionId>.log` where this chunk begins
 *                       (offset is relative to current rotation generation).
 *   [8..12)  length   — number of bytes in this chunk.
 *   [12..16) reserved — zero; reserved for a future "chunk flags" word
 *                       (e.g. compression marker) without changing the
 *                       record width.
 */
const SEQ_RECORD_BYTES = 16;

// ---- Types ---------------------------------------------------------------

/**
 * One entry in the per-session ring buffer. Bytes are stored as Buffer (no
 * stringification roundtrip).
 */
interface RingEntry {
	seq: number;
	bytes: Buffer;
}

/**
 * Backfill result delivered by `subscribe()` to a freshly-connected client.
 */
export interface BackfillSlice {
	/**
	 * Concatenated bytes from the ring covering `[fromSeq..toSeq]` (inclusive).
	 * Empty buffer if the ring had no retained entries newer than `lastSeq`.
	 */
	bytes: Buffer;
	/**
	 * First seq number in this backfill slice (the oldest still-retained seq
	 * > lastSeq). `null` when `bytes.length === 0`.
	 */
	fromSeq: number | null;
	/**
	 * Last seq number in this backfill slice (the newest in the ring at the
	 * moment of subscription). `null` when `bytes.length === 0`.
	 */
	toSeq: number | null;
	/**
	 * Number of bytes lost from before `fromSeq` because the ring rotated past
	 * them. `0` when no loss occurred. Surfaced via a `pty_dropped` marker.
	 */
	droppedBeforeBackfill: number;
}

/**
 * Live broadcast callbacks. Wired by the server to push messages over WS.
 * Kept as a callback shape (rather than emitting events) so the multiplexer
 * stays vanilla and testable without a real WebServer.
 */
export interface RawPtyBroadcaster {
	/**
	 * Send a single coalesced chunk of bytes for one session to one client.
	 * Implementations should base64-encode in the WS message.
	 */
	sendData(clientId: string, sessionId: string, bytes: Buffer, seq: number): void;
	/**
	 * Send a `pty_dropped` marker after the ring rotated past a client's
	 * `lastSeq`. droppedBytes is the count of bytes the ring evicted before
	 * the surviving backfill slice started.
	 */
	sendDropped(clientId: string, sessionId: string, droppedBytes: number, lastSeq: number): void;
}

/**
 * Producer-side event payload. `processManager.emit('raw-pty-data', sessionId, bytes)`
 * lands here.
 */
type RawPtyEvent = [sessionId: string, bytes: Buffer];

// ---- Per-session state ---------------------------------------------------

/**
 * One session's ring buffer, monotonic seq, subscriber set, and pending
 * flush state.
 */
interface SessionState {
	// Monotonic counter — the seq assigned to the NEXT publish() call. Starts
	// at 1 so a fresh subscription with `lastSeq=0` (or undefined) is treated
	// as "give me everything I missed."
	nextSeq: number;
	// Ring buffer of retained entries, in seq order (oldest first).
	ring: RingEntry[];
	// Total bytes currently in the ring (for hard-cap enforcement).
	totalBytes: number;
	// Seq of the oldest entry still in the ring. When the ring rotates past
	// an entry, this advances. A client whose `lastSeq < oldestSeq - 1` gets
	// a `pty_dropped` marker before its backfill.
	oldestSeq: number;
	// Subscriber set: clientId → highest seq sent so far.
	subscribers: Map<string, number>;
	// Pending coalesce buffer for the live broadcast path. Drained on the
	// flush timer or when threshold is reached, whichever fires first.
	pending: { seq: number; bytes: Buffer }[];
	pendingBytes: number;
	flushTimer: NodeJS.Timeout | null;
	// ---- L6.3 disk-backed state (only populated when `dataDir` is set) ----
	// Lazily-opened file descriptors for the per-session log + seq index.
	// `null` when the multiplexer is in-memory-only (dataDir not set) OR the
	// fds have not been opened yet (lazy on first publish/restore).
	logFd: number | null;
	seqFd: number | null;
	// Current size of the on-disk `.log` file. Tracked in memory so we can
	// decide rotation without an fs.stat() per publish.
	diskLogBytes: number;
	// Seq of the first entry currently retained in `<sessionId>.log`.
	// 1 on a fresh session; advances on rotation. Differs from `oldestSeq`
	// because the in-memory ring can rotate independently from the disk log.
	diskStartSeq: number;
	// Aggregate byte offset of `<sessionId>.log`'s byte 0 in the original
	// (pre-rotation) byte stream. Used so the seq-index `offset` field is
	// relative to the current rotation generation, while clients can still
	// compute "true" stream positions if they want them. Currently used only
	// for `.meta` serialization; the seq index re-bases on each rotation.
	diskStartOffset: number;
}

// ---- Implementation ------------------------------------------------------

export interface RawPtyMultiplexerOptions {
	softRingBytes?: number;
	hardRingBytes?: number;
	flushIntervalMs?: number;
	flushThresholdBytes?: number;
	/**
	 * L6.3 — Enable disk-backed scrollback persistence. When set, every
	 * `publish()` additionally appends to
	 * `<dataDir>/pty-scrollback/<sessionId>.log` (and `.seq` index, `.meta`
	 * rotation marker). On construction, `<dataDir>/pty-scrollback/` is
	 * scanned for existing triplets and any found sessions are registered as
	 * "disk-only" — backfill on subscribe reads from disk until live
	 * publishes start populating the in-memory ring again.
	 *
	 * When unset (the L6.1 default), the multiplexer is in-memory only and
	 * behaves exactly as it did before L6.3.
	 */
	dataDir?: string;
	/**
	 * L6.3 — Per-session log-file hard cap in bytes. Defaults to
	 * `RAW_PTY_DISK_HARD_CAP_BYTES`. When the `.log` file exceeds this size,
	 * the multiplexer rotates the log: truncates the `.log` + `.seq` files
	 * and advances `.meta.startSeq` to the seq of the youngest dropped
	 * entry + 1. Subsequent subscribes will see `droppedBeforeBackfill > 0`
	 * if they asked for a seq below the new startSeq.
	 *
	 * Only meaningful when `dataDir` is set.
	 */
	diskHardCapBytes?: number;
}

/**
 * Server-side raw-PTY fanout. Public surface:
 *   - `attachProducer(emitter)` — subscribe to 'raw-pty-data' events.
 *   - `publish(sessionId, bytes)` — explicit producer hook (tests / direct use).
 *   - `subscribe(sessionId, clientId, lastSeq?)` — register a client, return
 *     backfill slice for replay. Subsequent live data goes to the broadcaster.
 *   - `unsubscribe(sessionId, clientId)` — drop a client.
 *   - `unsubscribeAll(clientId)` — drop a client from every session (called
 *     on WS close).
 *   - `setBroadcaster(broadcaster)` — install the WS sender. Must be called
 *     before subscribe().
 *
 * Backpressure model:
 *   - Live path: ring grows up to HARD cap, drop-oldest with marker for any
 *     subscriber whose lastSeq < new oldestSeq.
 *   - Coalesce: per-session pending buffer flushes every FLUSH_INTERVAL_MS
 *     or when pendingBytes ≥ FLUSH_THRESHOLD_BYTES.
 *
 * TODO(L6.2+): `lastCommand`-based echo filter mitigation. When the client
 * sends per-keystroke `pty_input`, the existing PtySpawner echo-filter (which
 * reads `managedProc.lastCommand`) silently degrades — the stripped path
 * still flows but stops eliding command echoes. Track a per-session input
 * accumulator here and snapshot to `lastCommand` on `\n` for parity with the
 * `send_command` path. ~15 LOC. Defer.
 */
export class RawPtyMultiplexer {
	private readonly softRingBytes: number;
	private readonly hardRingBytes: number;
	private readonly flushIntervalMs: number;
	private readonly flushThresholdBytes: number;
	private readonly sessions: Map<string, SessionState> = new Map();
	private broadcaster: RawPtyBroadcaster | null = null;
	private attachedEmitter: EventEmitter | null = null;
	private attachedListener: ((...args: RawPtyEvent) => void) | null = null;
	// L6.3 disk-persistence fields. `dataDir === null` means the multiplexer
	// is in-memory only (L6.1 default — the test suite's `beforeEach` mux
	// instantiates with no dataDir so every existing L6.1 test runs unchanged).
	private readonly dataDir: string | null;
	private readonly scrollbackDir: string | null;
	private readonly diskHardCapBytes: number;

	constructor(opts: RawPtyMultiplexerOptions = {}) {
		this.softRingBytes = opts.softRingBytes ?? RAW_PTY_SOFT_RING_BYTES;
		this.hardRingBytes = opts.hardRingBytes ?? RAW_PTY_HARD_RING_BYTES;
		this.flushIntervalMs = opts.flushIntervalMs ?? RAW_PTY_FLUSH_INTERVAL_MS;
		this.flushThresholdBytes = opts.flushThresholdBytes ?? RAW_PTY_FLUSH_THRESHOLD_BYTES;
		this.dataDir = opts.dataDir ?? null;
		this.scrollbackDir = this.dataDir
			? path.join(this.dataDir, SCROLLBACK_SUBDIR)
			: null;
		this.diskHardCapBytes = opts.diskHardCapBytes ?? RAW_PTY_DISK_HARD_CAP_BYTES;
		if (this.scrollbackDir) {
			this.scanScrollbackDirOnBoot();
		}
	}

	// ---- Producer wiring ------------------------------------------------

	/**
	 * Install the WS broadcaster. Required before any subscribe() that wants
	 * live deliveries.
	 */
	setBroadcaster(broadcaster: RawPtyBroadcaster): void {
		this.broadcaster = broadcaster;
	}

	/**
	 * Attach this multiplexer to an event emitter that fires
	 * `'raw-pty-data', sessionId, bytes` events. Idempotent on the same
	 * emitter; detaches the previous listener if rebinding.
	 */
	attachProducer(emitter: EventEmitter): void {
		this.detachProducer();
		const listener = (sessionId: string, bytes: Buffer): void => {
			this.publish(sessionId, bytes);
		};
		emitter.on('raw-pty-data', listener);
		this.attachedEmitter = emitter;
		this.attachedListener = listener as (...args: RawPtyEvent) => void;
	}

	/**
	 * Detach from the previously-attached producer (if any). Used by tests
	 * and shutdown.
	 */
	detachProducer(): void {
		if (this.attachedEmitter && this.attachedListener) {
			this.attachedEmitter.off('raw-pty-data', this.attachedListener);
		}
		this.attachedEmitter = null;
		this.attachedListener = null;
	}

	/**
	 * Publish raw bytes for a session. Called from the producer event handler
	 * (or directly by tests). Assigns the next monotonic seq, appends to the
	 * ring, evicts oldest entries past the hard cap, and queues the chunk for
	 * coalesced live broadcast.
	 */
	publish(sessionId: string, bytes: Buffer): void {
		if (bytes.length === 0) return;
		const state = this.ensureSession(sessionId);
		const seq = state.nextSeq++;
		state.ring.push({ seq, bytes });
		state.totalBytes += bytes.length;
		// L6.3 — disk persistence is additive: write to disk BEFORE in-memory
		// eviction, so a `kill -9` immediately after `publish()` returns still
		// has the bytes durable. The eviction loop below only drops the
		// in-memory copy; the on-disk copy survives until the disk hard cap
		// triggers `rotateDiskLog`.
		if (this.scrollbackDir) {
			this.appendToDisk(sessionId, state, seq, bytes);
		}
		// Drop-oldest until under hard cap. Soft cap is informational only —
		// the actual evict trigger is the hard ceiling per scoping doc §3.
		while (state.totalBytes > this.hardRingBytes && state.ring.length > 0) {
			const evicted = state.ring.shift()!;
			state.totalBytes -= evicted.bytes.length;
			state.oldestSeq = evicted.seq + 1;
		}
		// Queue for live broadcast.
		state.pending.push({ seq, bytes });
		state.pendingBytes += bytes.length;
		if (state.pendingBytes >= this.flushThresholdBytes) {
			this.flush(sessionId);
		} else if (!state.flushTimer) {
			state.flushTimer = setTimeout(() => {
				this.flush(sessionId);
			}, this.flushIntervalMs);
			// Don't keep the event loop alive solely for a pending flush.
			if (typeof state.flushTimer.unref === 'function') {
				state.flushTimer.unref();
			}
		}
	}

	/**
	 * Force a flush of the coalesce buffer for one session right now. Used by
	 * the threshold path and the timer.
	 *
	 * Per-subscriber slicing: each subscriber's `lastSent` may differ (a
	 * client that subscribed AFTER some pending entries were queued must not
	 * receive those older seqs — they would re-render bytes the subscriber
	 * already got via backfill, or worse, bytes the subscriber never asked
	 * for). We slice the pending list per subscriber by `entry.seq > lastSent`
	 * and coalesce only that suffix.
	 */
	private flush(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (!state) return;
		if (state.flushTimer) {
			clearTimeout(state.flushTimer);
			state.flushTimer = null;
		}
		if (state.pending.length === 0) return;
		const pending = state.pending;
		const tailSeq = pending[pending.length - 1].seq;
		// Snapshot then drain — even if we fail to send to one subscriber, the
		// pending list is consumed so subsequent publishes don't pile up.
		state.pending = [];
		state.pendingBytes = 0;
		if (!this.broadcaster) return;
		for (const [clientId, lastSent] of state.subscribers) {
			if (tailSeq <= lastSent) continue; // already past tail
			// Slice the suffix where entry.seq > lastSent. Pending is in seq
			// order (publishes assign seq monotonically and append), so a
			// linear scan from the front is fine.
			let firstNewIdx = 0;
			while (firstNewIdx < pending.length && pending[firstNewIdx].seq <= lastSent) {
				firstNewIdx++;
			}
			if (firstNewIdx >= pending.length) continue;
			const slice = pending.slice(firstNewIdx);
			const totalBytes = slice.reduce((acc, e) => acc + e.bytes.length, 0);
			const coalesced = Buffer.concat(slice.map((e) => e.bytes), totalBytes);
			this.broadcaster.sendData(clientId, sessionId, coalesced, tailSeq);
			state.subscribers.set(clientId, tailSeq);
		}
	}

	// ---- Subscriber surface --------------------------------------------

	/**
	 * Register a client for live raw-PTY bytes on `sessionId`. Returns a
	 * backfill slice covering `(lastSeq..currentTail]` from the ring; the
	 * caller is expected to deliver that to the client BEFORE relying on
	 * subsequent broadcaster.sendData() calls.
	 *
	 * If `lastSeq < oldestSeq - 1`, the backfill slice reports
	 * `droppedBeforeBackfill > 0` and the caller should emit a `pty_dropped`
	 * marker first.
	 */
	subscribe(sessionId: string, clientId: string, lastSeq?: number): BackfillSlice {
		const state = this.ensureSession(sessionId);
		// Treat absent / 0 as "fresh subscription — give me everything in the
		// ring." A real client that already saw some bytes sends lastSeq > 0.
		const effectiveLastSeq = lastSeq ?? 0;
		// Backfill = entries whose seq > effectiveLastSeq.
		const slice: RingEntry[] = [];
		let droppedBeforeBackfill = 0;
		for (const entry of state.ring) {
			if (entry.seq > effectiveLastSeq) slice.push(entry);
		}
		// In-memory oldest seq = first ring entry's seq if any, else state.oldestSeq.
		const inMemoryOldestSeq = state.ring.length > 0 ? state.ring[0].seq : state.oldestSeq;
		// L6.3 — if the client's lastSeq predates the in-memory ring AND we
		// have disk persistence enabled, read from disk to fill the gap.
		// We need disk bytes whose seq is in (effectiveLastSeq..inMemoryOldestSeq).
		// Reading the full disk slice (effectiveLastSeq..currentTail] and
		// discarding entries already in the in-memory slice would be cheaper
		// to reason about, but doubles I/O. Instead: read disk for
		// (effectiveLastSeq..inMemoryOldestSeq - 1], then prepend.
		let diskBytes: Buffer = Buffer.alloc(0);
		let diskFromSeq: number | null = null;
		let diskToSeq: number | null = null;
		if (
			this.scrollbackDir &&
			effectiveLastSeq + 1 < inMemoryOldestSeq
		) {
			const upperBoundSeq = inMemoryOldestSeq - 1;
			const disk = this.readDiskScrollback(sessionId, state, effectiveLastSeq);
			if (disk.bytes.length > 0 && disk.fromSeq !== null && disk.toSeq !== null) {
				// disk.toSeq could be the absolute tail of the disk log,
				// which might equal or exceed inMemoryOldestSeq if the
				// in-memory ring also covers some of those bytes. Trim the
				// disk slice to seqs strictly below inMemoryOldestSeq so we
				// don't duplicate bytes between disk and in-memory.
				if (disk.toSeq <= upperBoundSeq) {
					diskBytes = disk.bytes;
					diskFromSeq = disk.fromSeq;
					diskToSeq = disk.toSeq;
				} else {
					// Trim disk bytes: re-read with explicit per-record
					// slicing to the upper bound.
					const trimmed = this.readDiskScrollbackBounded(
						sessionId,
						effectiveLastSeq,
						upperBoundSeq,
					);
					diskBytes = trimmed.bytes;
					diskFromSeq = trimmed.fromSeq;
					diskToSeq = trimmed.toSeq;
				}
			}
		}
		// If after consulting disk we STILL don't reach effectiveLastSeq+1,
		// report a drop marker. effectiveLastSeq must be > 0 for a drop to
		// mean anything (lastSeq=0 means "fresh client, no prior progress").
		const earliestRecoveredSeq =
			diskFromSeq !== null
				? diskFromSeq
				: slice.length > 0
					? slice[0].seq
					: null;
		if (effectiveLastSeq > 0) {
			if (earliestRecoveredSeq === null) {
				// No bytes recovered at all — but the client claims progress.
				// Report the full gap.
				droppedBeforeBackfill = Math.max(0, state.oldestSeq - effectiveLastSeq - 1);
			} else if (earliestRecoveredSeq > effectiveLastSeq + 1) {
				droppedBeforeBackfill = earliestRecoveredSeq - effectiveLastSeq - 1;
			}
		}
		// Register subscriber AFTER computing backfill so it doesn't race with
		// a concurrent publish().
		const tailSeqInMemory = slice.length > 0 ? slice[slice.length - 1].seq : null;
		const tailSeq =
			tailSeqInMemory ??
			diskToSeq ??
			effectiveLastSeq;
		state.subscribers.set(clientId, tailSeq);
		if (slice.length === 0 && diskBytes.length === 0) {
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null, droppedBeforeBackfill };
		}
		const memBytes = slice.length > 0
			? Buffer.concat(slice.map((e) => e.bytes), slice.reduce((acc, e) => acc + e.bytes.length, 0))
			: Buffer.alloc(0);
		const combined = diskBytes.length > 0 && memBytes.length > 0
			? Buffer.concat([diskBytes, memBytes], diskBytes.length + memBytes.length)
			: diskBytes.length > 0
				? diskBytes
				: memBytes;
		const fromSeq = diskFromSeq ?? (slice.length > 0 ? slice[0].seq : null);
		const toSeq = tailSeqInMemory ?? diskToSeq;
		return {
			bytes: combined,
			fromSeq,
			toSeq,
			droppedBeforeBackfill,
		};
	}

	/**
	 * L6.3 — Read disk scrollback bounded above by `upperBoundSeq`. Used by
	 * `subscribe` when the in-memory ring overlaps part of the disk log; we
	 * need to slice the disk bytes precisely so the combined backfill doesn't
	 * duplicate any seq. Linear scan — bounded by the seq-index size.
	 */
	private readDiskScrollbackBounded(
		sessionId: string,
		lastSeq: number,
		upperBoundSeq: number,
	): { bytes: Buffer; fromSeq: number | null; toSeq: number | null } {
		if (!this.scrollbackDir)
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		const logPath = path.join(this.scrollbackDir, `${sessionId}.log`);
		const seqPath = path.join(this.scrollbackDir, `${sessionId}.seq`);
		if (!fs.existsSync(logPath) || !fs.existsSync(seqPath))
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		let seqBytes: Buffer;
		let logBytes: Buffer;
		try {
			seqBytes = fs.readFileSync(seqPath);
			logBytes = fs.readFileSync(logPath);
		} catch {
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		}
		const recordCount = Math.floor(seqBytes.length / SEQ_RECORD_BYTES);
		let firstOffset = -1;
		let lastOffsetEnd = -1;
		let fromSeq: number | null = null;
		let toSeq: number | null = null;
		for (let i = 0; i < recordCount; i++) {
			const seq = seqBytes.readUInt32BE(i * SEQ_RECORD_BYTES);
			if (seq <= lastSeq) continue;
			if (seq > upperBoundSeq) break;
			const offset = seqBytes.readUInt32BE(i * SEQ_RECORD_BYTES + 4);
			const length = seqBytes.readUInt32BE(i * SEQ_RECORD_BYTES + 8);
			if (firstOffset === -1) {
				firstOffset = offset;
				fromSeq = seq;
			}
			lastOffsetEnd = offset + length;
			toSeq = seq;
		}
		if (firstOffset === -1)
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		return {
			bytes: logBytes.slice(firstOffset, lastOffsetEnd),
			fromSeq,
			toSeq,
		};
	}

	/**
	 * Drop a client from one session. If this was the last subscriber the
	 * session state stays around (the PTY producer is still publishing into
	 * the ring); a subsequent subscribe gets the same scrollback.
	 */
	unsubscribe(sessionId: string, clientId: string): void {
		const state = this.sessions.get(sessionId);
		if (!state) return;
		state.subscribers.delete(clientId);
	}

	/**
	 * Drop a client from every session — used when a WS disconnects.
	 */
	unsubscribeAll(clientId: string): void {
		for (const state of this.sessions.values()) {
			state.subscribers.delete(clientId);
		}
	}

	/**
	 * Drop ALL state for a session. Called when the PTY exits / the session
	 * is removed. Frees the ring buffer and stops any pending flush timer.
	 */
	removeSession(sessionId: string): void {
		const state = this.sessions.get(sessionId);
		if (!state) return;
		if (state.flushTimer) {
			clearTimeout(state.flushTimer);
			state.flushTimer = null;
		}
		// L6.3 — release any disk fds. Disk files are NOT deleted here —
		// they're load-bearing for cross-restart survival per ISC-13.
		this.closeDiskFds(state);
		this.sessions.delete(sessionId);
	}

	// ---- Introspection (tests / ops) ----------------------------------

	/**
	 * For tests and ops dashboards. Returns a snapshot of per-session size.
	 */
	getSessionStats(sessionId: string): {
		nextSeq: number;
		oldestSeq: number;
		totalBytes: number;
		ringLength: number;
		subscribers: number;
	} | null {
		const state = this.sessions.get(sessionId);
		if (!state) return null;
		return {
			nextSeq: state.nextSeq,
			oldestSeq: state.oldestSeq,
			totalBytes: state.totalBytes,
			ringLength: state.ring.length,
			subscribers: state.subscribers.size,
		};
	}

	/** Active session IDs (those with any retained state). */
	getActiveSessionIds(): string[] {
		return Array.from(this.sessions.keys());
	}

	// ---- Internal ------------------------------------------------------

	private ensureSession(sessionId: string): SessionState {
		let state = this.sessions.get(sessionId);
		if (!state) {
			state = {
				nextSeq: 1,
				ring: [],
				totalBytes: 0,
				oldestSeq: 1,
				subscribers: new Map(),
				pending: [],
				pendingBytes: 0,
				flushTimer: null,
				// L6.3 disk-backed fields. fds open lazily on first append.
				logFd: null,
				seqFd: null,
				diskLogBytes: 0,
				diskStartSeq: 1,
				diskStartOffset: 0,
			};
			this.sessions.set(sessionId, state);
		}
		return state;
	}

	// ---- L6.3 disk persistence -----------------------------------------

	/**
	 * Boot-time scan of the scrollback directory. For each `<id>.log` +
	 * `<id>.seq` + `<id>.meta` triplet found, registers a SessionState whose
	 * `nextSeq` / `diskStartSeq` / `diskLogBytes` are recovered from disk.
	 * No bytes are loaded into memory — the in-memory ring stays empty for
	 * disk-only sessions. Subscribe will read from disk on demand.
	 *
	 * Designed to fail closed: any unreadable triplet is skipped with a
	 * console.warn (a single corrupted session must not block boot).
	 */
	private scanScrollbackDirOnBoot(): void {
		if (!this.scrollbackDir) return;
		try {
			fs.mkdirSync(this.scrollbackDir, { recursive: true });
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to create scrollback dir ${this.scrollbackDir}: ${(err as Error).message}`,
			);
			return;
		}
		let entries: string[];
		try {
			entries = fs.readdirSync(this.scrollbackDir);
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to scan scrollback dir ${this.scrollbackDir}: ${(err as Error).message}`,
			);
			return;
		}
		const sessionIds = new Set<string>();
		for (const entry of entries) {
			if (entry.endsWith('.log')) sessionIds.add(entry.slice(0, -'.log'.length));
		}
		for (const sessionId of sessionIds) {
			try {
				this.recoverDiskOnlySession(sessionId);
			} catch (err) {
				console.warn(
					`[RawPtyMultiplexer] failed to recover session ${sessionId} from disk: ${(err as Error).message}`,
				);
			}
		}
	}

	/**
	 * Reconstruct a SessionState from disk: read `.meta` for startSeq /
	 * startOffset, read the tail of `.seq` to learn the latest seq, stat
	 * `.log` for size. No log bytes are loaded — they stream on subscribe.
	 */
	private recoverDiskOnlySession(sessionId: string): void {
		if (!this.scrollbackDir) return;
		const logPath = path.join(this.scrollbackDir, `${sessionId}.log`);
		const seqPath = path.join(this.scrollbackDir, `${sessionId}.seq`);
		const metaPath = path.join(this.scrollbackDir, `${sessionId}.meta`);
		if (!fs.existsSync(logPath) || !fs.existsSync(seqPath)) return;
		const logStat = fs.statSync(logPath);
		const seqStat = fs.statSync(seqPath);
		if (seqStat.size === 0) return;
		// Read the last seq-record to learn `nextSeq`.
		const lastRecordOffset = seqStat.size - SEQ_RECORD_BYTES;
		if (lastRecordOffset < 0 || lastRecordOffset % SEQ_RECORD_BYTES !== 0) {
			console.warn(
				`[RawPtyMultiplexer] ${sessionId}.seq has malformed size ${seqStat.size}; skipping`,
			);
			return;
		}
		const fd = fs.openSync(seqPath, 'r');
		const recordBuf = Buffer.alloc(SEQ_RECORD_BYTES);
		try {
			fs.readSync(fd, recordBuf, 0, SEQ_RECORD_BYTES, lastRecordOffset);
		} finally {
			fs.closeSync(fd);
		}
		const lastSeq = recordBuf.readUInt32BE(0);

		// Read `.meta` for startSeq / startOffset; default to {1, 0} on
		// missing/malformed (matches a fresh-session state).
		let startSeq = 1;
		let startOffset = 0;
		try {
			const metaRaw = fs.readFileSync(metaPath, 'utf-8');
			const meta = JSON.parse(metaRaw) as { startSeq?: number; startOffset?: number };
			if (typeof meta.startSeq === 'number' && Number.isInteger(meta.startSeq) && meta.startSeq >= 1) {
				startSeq = meta.startSeq;
			}
			if (typeof meta.startOffset === 'number' && Number.isInteger(meta.startOffset) && meta.startOffset >= 0) {
				startOffset = meta.startOffset;
			}
		} catch {
			// Missing or unparseable meta — treat as a session that started
			// at seq=1, offset=0. The seq index still drives correctness.
		}

		const state: SessionState = {
			nextSeq: lastSeq + 1,
			ring: [],
			totalBytes: 0,
			oldestSeq: lastSeq + 1, // no in-memory entries yet
			subscribers: new Map(),
			pending: [],
			pendingBytes: 0,
			flushTimer: null,
			logFd: null,
			seqFd: null,
			diskLogBytes: logStat.size,
			diskStartSeq: startSeq,
			diskStartOffset: startOffset,
		};
		this.sessions.set(sessionId, state);
	}

	/**
	 * Ensure the per-session `.log` and `.seq` fds are open for append.
	 * Idempotent. The `.meta` file is written by `appendToDisk` after every
	 * batch and on rotation — no fd held for it.
	 */
	private openDiskFds(sessionId: string, state: SessionState): void {
		if (!this.scrollbackDir) return;
		if (state.logFd !== null && state.seqFd !== null) return;
		try {
			fs.mkdirSync(this.scrollbackDir, { recursive: true });
		} catch {
			/* best-effort */
		}
		const logPath = path.join(this.scrollbackDir, `${sessionId}.log`);
		const seqPath = path.join(this.scrollbackDir, `${sessionId}.seq`);
		if (state.logFd === null) state.logFd = fs.openSync(logPath, 'a');
		if (state.seqFd === null) state.seqFd = fs.openSync(seqPath, 'a');
		// Refresh diskLogBytes in case the file was pre-existing and stat
		// hasn't been called yet.
		if (state.diskLogBytes === 0) {
			try {
				state.diskLogBytes = fs.statSync(logPath).size;
			} catch {
				state.diskLogBytes = 0;
			}
		}
	}

	private writeMeta(sessionId: string, state: SessionState): void {
		if (!this.scrollbackDir) return;
		const metaPath = path.join(this.scrollbackDir, `${sessionId}.meta`);
		const payload = JSON.stringify({
			startSeq: state.diskStartSeq,
			startOffset: state.diskStartOffset,
		});
		try {
			fs.writeFileSync(metaPath, payload);
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to write meta for ${sessionId}: ${(err as Error).message}`,
			);
		}
	}

	/**
	 * Append one published chunk to the on-disk log + seq index. Synchronous
	 * `appendFileSync`-style writes for atomicity and so a `kill -9`
	 * immediately after `publish()` returns still has the bytes durable.
	 *
	 * After append, checks the log size against `diskHardCapBytes` and
	 * rotates if over.
	 */
	private appendToDisk(sessionId: string, state: SessionState, seq: number, bytes: Buffer): void {
		if (!this.scrollbackDir) return;
		this.openDiskFds(sessionId, state);
		if (state.logFd === null || state.seqFd === null) return;
		const offsetInGeneration = state.diskLogBytes;
		try {
			fs.writeSync(state.logFd, bytes);
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to append log for ${sessionId}: ${(err as Error).message}`,
			);
			return;
		}
		// Index record: seq | offset | length | reserved (all u32 BE).
		const record = Buffer.alloc(SEQ_RECORD_BYTES);
		record.writeUInt32BE(seq, 0);
		record.writeUInt32BE(offsetInGeneration, 4);
		record.writeUInt32BE(bytes.length, 8);
		record.writeUInt32BE(0, 12);
		try {
			fs.writeSync(state.seqFd, record);
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to append seq for ${sessionId}: ${(err as Error).message}`,
			);
			return;
		}
		state.diskLogBytes += bytes.length;

		// On first append after a fresh session, persist the meta so a
		// crash + restart finds the right startSeq even before rotation.
		this.writeMeta(sessionId, state);

		if (state.diskLogBytes > this.diskHardCapBytes) {
			this.rotateDiskLog(sessionId, state);
		}
	}

	/**
	 * Rotate the on-disk log: keeps the youngest entries whose total size
	 * fits under the hard cap; drops the older ones. Implemented as
	 * read-rewrite — read the surviving index entries, slice the
	 * corresponding bytes out of the old log, write fresh `.log` + `.seq`
	 * files, update `.meta`'s startSeq/startOffset.
	 *
	 * Failure is logged + the old files are left in place; the next
	 * `appendToDisk` will try rotation again on the next overflow.
	 */
	private rotateDiskLog(sessionId: string, state: SessionState): void {
		if (!this.scrollbackDir) return;
		const logPath = path.join(this.scrollbackDir, `${sessionId}.log`);
		const seqPath = path.join(this.scrollbackDir, `${sessionId}.seq`);
		try {
			// Close + reopen fds for a deterministic read after the writes.
			if (state.logFd !== null) {
				try {
					fs.closeSync(state.logFd);
				} catch {
					/* best-effort */
				}
				state.logFd = null;
			}
			if (state.seqFd !== null) {
				try {
					fs.closeSync(state.seqFd);
				} catch {
					/* best-effort */
				}
				state.seqFd = null;
			}
			const logBytes = fs.readFileSync(logPath);
			const seqBytes = fs.readFileSync(seqPath);
			const recordCount = Math.floor(seqBytes.length / SEQ_RECORD_BYTES);
			if (recordCount === 0) return;
			// Decide the survival point: walk records from the END backward,
			// accumulating bytes, until the cumulative byte count would
			// exceed `diskHardCapBytes / 2`. That keeps room for several more
			// publishes before the next rotation.
			const targetSurviveBytes = Math.floor(this.diskHardCapBytes / 2);
			let surviveFromIdx = recordCount; // exclusive lower bound; default: nothing survives
			let cumulative = 0;
			for (let i = recordCount - 1; i >= 0; i--) {
				const length = seqBytes.readUInt32BE(i * SEQ_RECORD_BYTES + 8);
				if (cumulative + length > targetSurviveBytes) break;
				cumulative += length;
				surviveFromIdx = i;
			}
			if (surviveFromIdx >= recordCount) {
				// Even the newest entry exceeds half the cap; keep just the
				// last entry so subsequent appends still grow normally.
				surviveFromIdx = recordCount - 1;
			}
			// First surviving record gives us the new generation's anchor.
			const firstSurviveOffset = seqBytes.readUInt32BE(
				surviveFromIdx * SEQ_RECORD_BYTES + 4,
			);
			const firstSurviveSeq = seqBytes.readUInt32BE(
				surviveFromIdx * SEQ_RECORD_BYTES,
			);
			const newLogBytes = logBytes.slice(firstSurviveOffset);
			// Rebuild the seq index relative to the new generation's
			// `firstSurviveOffset`.
			const survivingCount = recordCount - surviveFromIdx;
			const newSeq = Buffer.alloc(survivingCount * SEQ_RECORD_BYTES);
			for (let i = 0; i < survivingCount; i++) {
				const srcBase = (surviveFromIdx + i) * SEQ_RECORD_BYTES;
				const dstBase = i * SEQ_RECORD_BYTES;
				const seq = seqBytes.readUInt32BE(srcBase);
				const offset = seqBytes.readUInt32BE(srcBase + 4);
				const length = seqBytes.readUInt32BE(srcBase + 8);
				newSeq.writeUInt32BE(seq, dstBase);
				newSeq.writeUInt32BE(offset - firstSurviveOffset, dstBase + 4);
				newSeq.writeUInt32BE(length, dstBase + 8);
				newSeq.writeUInt32BE(0, dstBase + 12);
			}
			fs.writeFileSync(logPath, newLogBytes);
			fs.writeFileSync(seqPath, newSeq);
			state.diskLogBytes = newLogBytes.length;
			state.diskStartSeq = firstSurviveSeq;
			state.diskStartOffset = state.diskStartOffset + firstSurviveOffset;
			this.writeMeta(sessionId, state);
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to rotate disk log for ${sessionId}: ${(err as Error).message}`,
			);
		}
	}

	/**
	 * Read scrollback bytes from disk for `(lastSeq..currentTail]`. Returns
	 * the concatenated bytes plus the seq range covered.
	 *
	 * Reads the entire `.seq` index, scans it for entries with `seq > lastSeq`,
	 * then slices the matching bytes out of the `.log` file. For typical
	 * scrollback sizes the seq index is small (single KB) so the linear scan
	 * is fast enough; a binary search by seq could be added if profiling
	 * shows it matters.
	 */
	private readDiskScrollback(
		sessionId: string,
		state: SessionState,
		lastSeq: number,
	): { bytes: Buffer; fromSeq: number | null; toSeq: number | null } {
		if (!this.scrollbackDir) return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		const logPath = path.join(this.scrollbackDir, `${sessionId}.log`);
		const seqPath = path.join(this.scrollbackDir, `${sessionId}.seq`);
		if (!fs.existsSync(logPath) || !fs.existsSync(seqPath)) {
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		}
		// Flush any pending writes (the log fd is in append-mode so writes
		// are visible to readers, but explicit fsync would slow the publish
		// path; we accept the trade-off — only the most recent unflushed
		// bytes might be missed, and the in-memory ring covers those).
		let seqBytes: Buffer;
		let logBytes: Buffer;
		try {
			seqBytes = fs.readFileSync(seqPath);
			logBytes = fs.readFileSync(logPath);
		} catch (err) {
			console.warn(
				`[RawPtyMultiplexer] failed to read disk scrollback for ${sessionId}: ${(err as Error).message}`,
			);
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		}
		const recordCount = Math.floor(seqBytes.length / SEQ_RECORD_BYTES);
		if (recordCount === 0) return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		// Find the first record with seq > lastSeq.
		let firstIdx = -1;
		for (let i = 0; i < recordCount; i++) {
			const seq = seqBytes.readUInt32BE(i * SEQ_RECORD_BYTES);
			if (seq > lastSeq) {
				firstIdx = i;
				break;
			}
		}
		if (firstIdx === -1) return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null };
		const firstOffset = seqBytes.readUInt32BE(firstIdx * SEQ_RECORD_BYTES + 4);
		const fromSeq = seqBytes.readUInt32BE(firstIdx * SEQ_RECORD_BYTES);
		const toSeq = seqBytes.readUInt32BE((recordCount - 1) * SEQ_RECORD_BYTES);
		// All bytes from `firstOffset` to end of log belong to the slice
		// (the seq index is dense and append-only within a generation).
		const bytes = logBytes.slice(firstOffset);
		// Discard cached state.diskLogBytes if it disagrees with on-disk
		// size; this can happen when the in-memory tracker missed a write
		// (it shouldn't, but be defensive).
		state.diskLogBytes = logBytes.length;
		return { bytes, fromSeq, toSeq };
	}

	/**
	 * Close any open fds for a session. Called from `removeSession`.
	 */
	private closeDiskFds(state: SessionState): void {
		if (state.logFd !== null) {
			try {
				fs.closeSync(state.logFd);
			} catch {
				/* best-effort */
			}
			state.logFd = null;
		}
		if (state.seqFd !== null) {
			try {
				fs.closeSync(state.seqFd);
			} catch {
				/* best-effort */
			}
			state.seqFd = null;
		}
	}
}
