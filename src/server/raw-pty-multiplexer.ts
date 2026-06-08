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

// ---- Tuning constants (exported for tests and ops dashboards) -------------

export const RAW_PTY_SOFT_RING_BYTES = 4 * 1024 * 1024; // 4 MB
export const RAW_PTY_HARD_RING_BYTES = 8 * 1024 * 1024; // 8 MB
export const RAW_PTY_FLUSH_INTERVAL_MS = 5;
export const RAW_PTY_FLUSH_THRESHOLD_BYTES = 32 * 1024; // 32 KB

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
}

// ---- Implementation ------------------------------------------------------

export interface RawPtyMultiplexerOptions {
	softRingBytes?: number;
	hardRingBytes?: number;
	flushIntervalMs?: number;
	flushThresholdBytes?: number;
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

	constructor(opts: RawPtyMultiplexerOptions = {}) {
		this.softRingBytes = opts.softRingBytes ?? RAW_PTY_SOFT_RING_BYTES;
		this.hardRingBytes = opts.hardRingBytes ?? RAW_PTY_HARD_RING_BYTES;
		this.flushIntervalMs = opts.flushIntervalMs ?? RAW_PTY_FLUSH_INTERVAL_MS;
		this.flushThresholdBytes = opts.flushThresholdBytes ?? RAW_PTY_FLUSH_THRESHOLD_BYTES;
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
		// If the client asked for bytes older than the oldest we still hold,
		// report the gap. oldestSeq is the seq of the first entry that WOULD
		// be in the ring (i.e. `state.ring[0]?.seq ?? state.oldestSeq`). We
		// only report drops when the client had progress (effectiveLastSeq > 0)
		// AND we no longer hold something at-or-after lastSeq + 1.
		if (effectiveLastSeq > 0 && effectiveLastSeq + 1 < state.oldestSeq) {
			// Count bytes between (effectiveLastSeq, state.oldestSeq) — we don't
			// retain those byte counts, but the gap is real. Report it as the
			// number of seq-gaps × a placeholder marker. Since we cannot recover
			// the lost byte count without retention, surface 0 bytes but signal
			// the gap via a non-null marker. Callers can interpret as "scrollback
			// truncated."
			droppedBeforeBackfill = Math.max(0, state.oldestSeq - effectiveLastSeq - 1);
		}
		// Register subscriber AFTER computing backfill so it doesn't race with
		// a concurrent publish().
		const tailSeq = slice.length > 0 ? slice[slice.length - 1].seq : effectiveLastSeq;
		state.subscribers.set(clientId, tailSeq);
		if (slice.length === 0) {
			return { bytes: Buffer.alloc(0), fromSeq: null, toSeq: null, droppedBeforeBackfill };
		}
		const totalBytes = slice.reduce((acc, e) => acc + e.bytes.length, 0);
		const bytes = Buffer.concat(slice.map((e) => e.bytes), totalBytes);
		return {
			bytes,
			fromSeq: slice[0].seq,
			toSeq: slice[slice.length - 1].seq,
			droppedBeforeBackfill,
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
			};
			this.sessions.set(sessionId, state);
		}
		return state;
	}
}
