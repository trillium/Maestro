/**
 * Tests for the generic SessionFileWatcher.
 *
 * Uses real files in an os.tmpdir() workspace (NOT a mocked fs) and a real
 * chokidar instance so we exercise the same code path that runs in
 * production. The idle-window test uses fake timers and triggers the
 * watcher's internal handler directly — chokidar itself is timing-sensitive
 * and would never reliably fire a 30-second window in a unit test.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

vi.mock('../../../main/utils/logger', () => ({
	logger: {
		info: vi.fn(),
		warn: vi.fn(),
		error: vi.fn(),
		debug: vi.fn(),
	},
}));

import {
	SessionFileWatcher,
	type SessionFileMatcher,
} from '../../../main/storage/session-file-watcher';
import {
	EXTERNAL_ACTIVITY_IDLE_MS,
	type SessionActivityEvent,
} from '../../../shared/sessionActivity';

// chokidar `ready` can take noticeably longer on macOS fsevents than on
// Linux inotify. Lift the per-test timeout so CI doesn't flake on cold starts.
const TEST_TIMEOUT_MS = 15_000;

const SHORT_DEBOUNCE_MS = 50;
// Generous wait — chokidar's atomic-write debounce defaults to 100ms, plus our
// own debounce, plus filesystem propagation. Tests still finish in <1s on a
// healthy machine; this is the upper bound before they fail loudly.
const EVENT_WAIT_MS = 2_000;

let workdir = '';

beforeEach(() => {
	workdir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-file-watcher-'));
});

afterEach(() => {
	if (workdir && fs.existsSync(workdir)) {
		fs.rmSync(workdir, { recursive: true, force: true });
	}
});

/**
 * Promise that resolves when `emitter` fires `event`, or rejects on timeout.
 * Used to assert which event the watcher emitted without polling.
 */
function waitForEvent<T = SessionActivityEvent>(
	emitter: EventEmitter,
	event: string,
	timeoutMs = EVENT_WAIT_MS
): Promise<T> {
	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			emitter.off(event, listener);
			reject(new Error(`Timed out after ${timeoutMs}ms waiting for "${event}" event`));
		}, timeoutMs);
		const listener = (payload: T) => {
			clearTimeout(timer);
			resolve(payload);
		};
		emitter.once(event, listener);
	});
}

/**
 * Resolves once chokidar has finished its initial directory scan. Without
 * this, writes that race the scan can be classified as `'add'` (initial)
 * rather than `'change'` and silently swallowed by `ignoreInitial: true`.
 */
async function waitForChokidarReady(watcher: SessionFileWatcher): Promise<void> {
	const inner = (watcher as unknown as { watcher: EventEmitter | null }).watcher;
	if (!inner) return;
	await new Promise<void>((resolve) => {
		inner.once('ready', () => resolve());
	});
}

/**
 * Yield to the real event loop a few times so that pending libuv I/O
 * (e.g. `fs.promises.stat()` inside the watcher's `flush()`) has a chance
 * to resolve. Needed under fake timers when the only escape hatch is the
 * still-real `setImmediate` queue.
 */
async function flushRealIo(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await new Promise((resolve) => setImmediate(resolve));
	}
}

/**
 * Default matcher: any `.jsonl` file at any depth is treated as a session
 * file whose ID is the basename without the extension. Mirrors the shape
 * agents like Claude Code and Codex use on disk.
 */
const jsonlMatcher: SessionFileMatcher = (relPath) => {
	if (!relPath.endsWith('.jsonl')) return null;
	const base = path.basename(relPath, '.jsonl');
	const projectPath = path.dirname(relPath) || '.';
	return { sessionId: base, projectPath };
};

describe('SessionFileWatcher', () => {
	it(
		'fires "create" with the right sessionId when a new matching file appears',
		async () => {
			const watcher = new SessionFileWatcher({
				agentId: 'claude-code',
				storageDir: workdir,
				fileMatcher: jsonlMatcher,
				debounceMs: SHORT_DEBOUNCE_MS,
			});

			await watcher.start();
			await waitForChokidarReady(watcher);

			const eventPromise = waitForEvent<SessionActivityEvent>(watcher, 'create');

			const sessionId = 'session-create-1';
			const before = Date.now();
			fs.writeFileSync(path.join(workdir, `${sessionId}.jsonl`), 'line one\n');

			const event = await eventPromise;

			expect(event.agentId).toBe('claude-code');
			expect(event.sessionId).toBe(sessionId);
			expect(event.source).toBe('external');
			expect(event.sizeBytes).toBeGreaterThan(0);
			expect(event.lastActivityAt).toBeGreaterThanOrEqual(before);

			await watcher.stop();
		},
		TEST_TIMEOUT_MS
	);

	it(
		'fires "append" when an existing matching file grows',
		async () => {
			const sessionId = 'session-append-1';
			const filePath = path.join(workdir, `${sessionId}.jsonl`);
			// Pre-create the file BEFORE starting the watcher so chokidar's
			// initial scan picks it up and subsequent writes register as changes.
			fs.writeFileSync(filePath, 'initial\n');

			const watcher = new SessionFileWatcher({
				agentId: 'codex',
				storageDir: workdir,
				fileMatcher: jsonlMatcher,
				debounceMs: SHORT_DEBOUNCE_MS,
			});

			await watcher.start();
			await waitForChokidarReady(watcher);

			const eventPromise = waitForEvent<SessionActivityEvent>(watcher, 'append');

			const before = Date.now();
			fs.appendFileSync(filePath, 'appended bytes\n');

			const event = await eventPromise;

			expect(event.agentId).toBe('codex');
			expect(event.sessionId).toBe(sessionId);
			expect(event.source).toBe('external');
			expect(event.sizeBytes).toBeGreaterThan('initial\n'.length);
			expect(event.lastActivityAt).toBeGreaterThanOrEqual(before);

			await watcher.stop();
		},
		TEST_TIMEOUT_MS
	);

	it(
		'ignores files the matcher rejects',
		async () => {
			const watcher = new SessionFileWatcher({
				agentId: 'claude-code',
				storageDir: workdir,
				fileMatcher: jsonlMatcher,
				debounceMs: SHORT_DEBOUNCE_MS,
			});

			await watcher.start();
			await waitForChokidarReady(watcher);

			let createFired = false;
			let appendFired = false;
			watcher.on('create', () => {
				createFired = true;
			});
			watcher.on('append', () => {
				appendFired = true;
			});

			// Touch a file the matcher returns null for — should produce zero
			// emissions even after the debounce window has fully elapsed.
			fs.writeFileSync(path.join(workdir, 'README.md'), '# not a session\n');
			fs.writeFileSync(path.join(workdir, 'other.txt'), 'noise\n');

			await new Promise((resolve) => setTimeout(resolve, SHORT_DEBOUNCE_MS * 4));

			expect(createFired).toBe(false);
			expect(appendFired).toBe(false);
			expect(watcher.listActive()).toEqual([]);

			await watcher.stop();
		},
		TEST_TIMEOUT_MS
	);

	it(
		'collapses 10 rapid appends into a single debounced event',
		async () => {
			const sessionId = 'session-debounce-1';
			const filePath = path.join(workdir, `${sessionId}.jsonl`);
			fs.writeFileSync(filePath, 'init\n');

			const watcher = new SessionFileWatcher({
				agentId: 'claude-code',
				storageDir: workdir,
				fileMatcher: jsonlMatcher,
				// Wide enough that the burst below comfortably finishes inside
				// the debounce window even on a slow CI runner.
				debounceMs: 300,
			});

			await watcher.start();
			await waitForChokidarReady(watcher);

			const events: SessionActivityEvent[] = [];
			watcher.on('append', (e: SessionActivityEvent) => events.push(e));
			watcher.on('create', (e: SessionActivityEvent) => events.push(e));

			for (let i = 0; i < 10; i++) {
				fs.appendFileSync(filePath, `chunk ${i}\n`);
			}

			// Wait long enough for the debounce window to fully elapse plus
			// chokidar's atomic-write delay (default 100ms).
			await new Promise((resolve) => setTimeout(resolve, 800));

			expect(events).toHaveLength(1);
			expect(events[0].sessionId).toBe(sessionId);
			// The single emission should reflect the post-burst size, not a
			// snapshot mid-burst.
			expect(events[0].sizeBytes).toBeGreaterThanOrEqual(fs.statSync(filePath).size);

			await watcher.stop();
		},
		TEST_TIMEOUT_MS
	);

	it('start() resolves quietly when the storage directory does not exist', async () => {
		const missing = path.join(workdir, 'does', 'not', 'exist');
		const watcher = new SessionFileWatcher({
			agentId: 'claude-code',
			storageDir: missing,
			fileMatcher: jsonlMatcher,
		});

		// Should NOT throw — same-user scope assumes missing dirs are normal
		// (e.g. user has Claude installed but not Codex).
		await expect(watcher.start()).resolves.toBeUndefined();
		expect(watcher.listActive()).toEqual([]);

		await watcher.stop();
	});

	it('start() resolves quietly when the storage path is a file, not a directory', async () => {
		const filePath = path.join(workdir, 'not-a-dir');
		fs.writeFileSync(filePath, 'noise');

		const watcher = new SessionFileWatcher({
			agentId: 'claude-code',
			storageDir: filePath,
			fileMatcher: jsonlMatcher,
		});

		await expect(watcher.start()).resolves.toBeUndefined();
		await watcher.stop();
	});

	describe('idle scheduling', () => {
		// chokidar's 30-second wall clock is impractical to wait for in unit
		// tests, so we drive the watcher through its internal handler. The
		// underlying file is real — only the event delivery is shortcut.
		//
		// We deliberately leave `process.nextTick`, `setImmediate`, and
		// `queueMicrotask` REAL: `fs.promises.stat()` (called from the
		// watcher's `flush()`) resolves via those, and faking them would
		// stall the post-debounce emission.
		beforeEach(() => {
			vi.useFakeTimers({
				toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'],
			});
			vi.setSystemTime(new Date('2026-05-15T00:00:00Z'));
		});

		afterEach(() => {
			vi.useRealTimers();
		});

		it('emits "idle" exactly once after EXTERNAL_ACTIVITY_IDLE_MS of quiet', async () => {
			const sessionId = 'session-idle-1';
			const filePath = path.join(workdir, `${sessionId}.jsonl`);
			fs.writeFileSync(filePath, 'real bytes\n');

			const debounceMs = 100;
			const watcher = new SessionFileWatcher({
				agentId: 'claude-code',
				storageDir: workdir,
				fileMatcher: jsonlMatcher,
				debounceMs,
			});

			await watcher.start();

			const idleSpy = vi.fn();
			watcher.on('idle', idleSpy);
			const createSpy = vi.fn();
			watcher.on('create', createSpy);

			// Manually invoke the handler — equivalent to chokidar firing
			// 'add' for the path we just wrote. handleEvent schedules BOTH
			// the debounce and the idle timer relative to "now", so the idle
			// deadline is `EXTERNAL_ACTIVITY_IDLE_MS` from this moment, not
			// from the flush.
			(
				watcher as unknown as {
					handleEvent: (kind: 'create' | 'append', p: string) => void;
				}
			).handleEvent('create', filePath);

			// Flush the debounce window so 'create' is emitted. The debounce
			// callback kicks off `flush()`, which `await fs.promises.stat()`s
			// the real file before emitting — that I/O resolves on
			// setImmediate, NOT on the faked setTimeout queue, so we yield
			// once after each timer advance to let it land.
			await vi.advanceTimersByTimeAsync(debounceMs);
			await flushRealIo();
			expect(createSpy).toHaveBeenCalledTimes(1);
			expect(idleSpy).not.toHaveBeenCalled();

			// Sit just below the idle deadline (which is
			// EXTERNAL_ACTIVITY_IDLE_MS from the original handleEvent call,
			// not from the flush).
			await vi.advanceTimersByTimeAsync(EXTERNAL_ACTIVITY_IDLE_MS - debounceMs - 1);
			expect(idleSpy).not.toHaveBeenCalled();

			// Cross the threshold — idle should fire. Bump a few ms past the
			// deadline so the assertion doesn't ride exactly on the firing
			// tick.
			await vi.advanceTimersByTimeAsync(2);
			expect(idleSpy).toHaveBeenCalledTimes(1);

			const idleEvent = idleSpy.mock.calls[0][0] as SessionActivityEvent;
			expect(idleEvent.sessionId).toBe(sessionId);
			expect(idleEvent.source).toBe('external');

			// Session is forgotten after going idle.
			expect(watcher.listActive()).toEqual([]);

			await watcher.stop();
		});

		it('resets the idle timer when a fresh event arrives mid-window', async () => {
			const sessionId = 'session-idle-reset';
			const filePath = path.join(workdir, `${sessionId}.jsonl`);
			fs.writeFileSync(filePath, 'a\n');

			const watcher = new SessionFileWatcher({
				agentId: 'claude-code',
				storageDir: workdir,
				fileMatcher: jsonlMatcher,
				debounceMs: 50,
			});

			await watcher.start();

			const idleSpy = vi.fn();
			watcher.on('idle', idleSpy);

			const handle = (
				watcher as unknown as {
					handleEvent: (kind: 'create' | 'append', p: string) => void;
				}
			).handleEvent.bind(watcher);

			handle('create', filePath);
			await vi.advanceTimersByTimeAsync(50);
			await flushRealIo();

			// Sit halfway through the idle window, then poke the file again —
			// idle should be deferred a full window from the new event.
			await vi.advanceTimersByTimeAsync(EXTERNAL_ACTIVITY_IDLE_MS / 2);
			fs.appendFileSync(filePath, 'b\n');
			handle('append', filePath);
			await vi.advanceTimersByTimeAsync(50);
			await flushRealIo();

			// Original idle deadline passes — must NOT fire because we re-armed.
			await vi.advanceTimersByTimeAsync(EXTERNAL_ACTIVITY_IDLE_MS / 2);
			expect(idleSpy).not.toHaveBeenCalled();

			// Now actually exhaust the new window.
			await vi.advanceTimersByTimeAsync(EXTERNAL_ACTIVITY_IDLE_MS);
			expect(idleSpy).toHaveBeenCalledTimes(1);

			await watcher.stop();
		});
	});
});
