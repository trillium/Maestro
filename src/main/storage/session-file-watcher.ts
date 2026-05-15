/**
 * Generic session file watcher: streams activity for agent session files
 * regardless of who spawned them.
 *
 * SAME-USER ONLY — this module assumes the watched paths are owned by the
 * current OS user and relies on local filesystem permissions for access.
 * SSH paths are explicitly out of scope; cross-user/cross-account is not
 * supported. Watch-don't-spawn philosophy: we observe on-disk artifacts
 * each agent CLI writes, never PIDs. Phase 1 of Remote Agent Visibility.
 */

import { EventEmitter } from 'events';
import * as fs from 'fs';
import * as path from 'path';
import chokidar, { type FSWatcher } from 'chokidar';
import { logger } from '../utils/logger';
import { type SessionActivityEvent, EXTERNAL_ACTIVITY_IDLE_MS } from '../../shared/sessionActivity';
import type { ToolType } from '../../shared/types';

const LOG_CONTEXT = 'SessionFileWatcher';
const DEFAULT_DEBOUNCE_MS = 250;

/**
 * Returned from a {@link SessionFileMatcher} to flag a path as a session
 * file and identify it. Returning `null` means "not a session file, skip."
 */
export interface SessionFileMatch {
	sessionId: string;
	projectPath: string;
}

/**
 * Per-agent path-shape parser. Receives a path relative to `storageDir`
 * (using the platform's native separator) and returns either a
 * {@link SessionFileMatch} or `null` to ignore the file.
 */
export type SessionFileMatcher = (relPath: string) => SessionFileMatch | null;

export interface SessionFileWatcherConfig {
	agentId: ToolType;
	storageDir: string;
	fileMatcher: SessionFileMatcher;
	debounceMs?: number;
}

/**
 * Internal per-session bookkeeping. We collapse rapid bursts of writes
 * into a single emission per `debounceMs` window, and forget the session
 * entirely after `EXTERNAL_ACTIVITY_IDLE_MS` of quiet (firing `'idle'`).
 */
interface SessionState {
	sessionId: string;
	projectPath: string;
	absPath: string;
	lastActivityAt: number;
	sizeBytes: number;
	debounceTimer: ReturnType<typeof setTimeout> | null;
	idleTimer: ReturnType<typeof setTimeout> | null;
	pendingEvent: 'append' | 'create' | null;
}

/**
 * Watches a single agent's session storage directory and emits structured
 * `SessionActivityEvent`s whenever a session file appears or grows.
 *
 * Events:
 * - `'create'` — a new session file matched and was first seen
 * - `'append'` — an existing session file grew
 * - `'idle'` — a previously-active session went quiet for `EXTERNAL_ACTIVITY_IDLE_MS`
 *
 * All emitted events carry `source: 'external'`. Consumers cross-reference
 * the `sessionId` against Maestro's known/managed sessions to re-classify
 * locally-spawned ones if they need that distinction.
 */
export class SessionFileWatcher extends EventEmitter {
	readonly agentId: ToolType;
	readonly storageDir: string;
	private readonly fileMatcher: SessionFileMatcher;
	private readonly debounceMs: number;
	private watcher: FSWatcher | null = null;
	private readonly states = new Map<string, SessionState>();
	private started = false;
	private stopped = false;

	constructor(config: SessionFileWatcherConfig) {
		super();
		this.agentId = config.agentId;
		this.storageDir = path.resolve(config.storageDir);
		this.fileMatcher = config.fileMatcher;
		this.debounceMs = config.debounceMs ?? DEFAULT_DEBOUNCE_MS;
	}

	async start(): Promise<void> {
		if (this.started) return;
		this.started = true;

		// Same-user scope: a missing or unreadable storage dir is normal
		// (e.g., user has Claude installed but not Codex). Log once and
		// resolve quietly so callers can spin up a watcher per agent.
		try {
			const stat = await fs.promises.stat(this.storageDir);
			if (!stat.isDirectory()) {
				logger.warn(
					`Storage dir for ${this.agentId} is not a directory: ${this.storageDir}`,
					LOG_CONTEXT
				);
				return;
			}
		} catch (err) {
			const code = (err as NodeJS.ErrnoException).code;
			if (code === 'ENOENT' || code === 'EACCES' || code === 'EPERM') {
				logger.warn(
					`Cannot access storage dir for ${this.agentId} (${code}): ${this.storageDir}`,
					LOG_CONTEXT
				);
				return;
			}
			throw err;
		}

		this.watcher = chokidar.watch(this.storageDir, {
			ignoreInitial: true,
			persistent: true,
			depth: 99,
		});

		this.watcher.on('add', (p) => this.handleEvent('create', p));
		this.watcher.on('change', (p) => this.handleEvent('append', p));
		this.watcher.on('error', (err) => {
			logger.warn(`Watcher error for ${this.agentId} at ${this.storageDir}: ${err}`, LOG_CONTEXT);
		});
	}

	async stop(): Promise<void> {
		if (this.stopped) return;
		this.stopped = true;

		for (const state of this.states.values()) {
			if (state.debounceTimer) clearTimeout(state.debounceTimer);
			if (state.idleTimer) clearTimeout(state.idleTimer);
		}
		this.states.clear();

		if (this.watcher) {
			await this.watcher.close();
			this.watcher = null;
		}
	}

	/**
	 * Currently-tracked sessions — those that have shown activity since
	 * `start()` and have not yet been declared idle.
	 */
	listActive(): SessionActivityEvent[] {
		const events: SessionActivityEvent[] = [];
		for (const state of this.states.values()) {
			events.push(this.toEvent(state));
		}
		return events;
	}

	private handleEvent(kind: 'create' | 'append', emittedPath: string): void {
		if (this.stopped) return;

		const absPath = path.isAbsolute(emittedPath)
			? emittedPath
			: path.resolve(this.storageDir, emittedPath);
		const relPath = path.relative(this.storageDir, absPath);
		const match = this.fileMatcher(relPath);
		if (!match) return;

		const now = Date.now();
		let state = this.states.get(match.sessionId);

		if (!state) {
			state = {
				sessionId: match.sessionId,
				projectPath: match.projectPath,
				absPath,
				lastActivityAt: now,
				sizeBytes: 0,
				debounceTimer: null,
				idleTimer: null,
				pendingEvent: null,
			};
			this.states.set(match.sessionId, state);
		} else {
			state.absPath = absPath;
		}

		state.lastActivityAt = now;

		// 'create' wins over 'append' within a debounce window — a brand-new
		// session file appearing matters more than the writes that follow it.
		if (state.pendingEvent !== 'create') {
			state.pendingEvent = kind;
		}

		if (state.debounceTimer) clearTimeout(state.debounceTimer);
		state.debounceTimer = setTimeout(() => {
			void this.flush(state!);
		}, this.debounceMs);

		this.scheduleIdle(state);
	}

	private async flush(state: SessionState): Promise<void> {
		state.debounceTimer = null;
		const eventKind = state.pendingEvent;
		state.pendingEvent = null;
		if (!eventKind) return;

		try {
			const stat = await fs.promises.stat(state.absPath);
			state.sizeBytes = stat.size;
		} catch {
			// File vanished mid-flush — drop the event and forget the session.
			if (state.idleTimer) clearTimeout(state.idleTimer);
			this.states.delete(state.sessionId);
			return;
		}

		this.emit(eventKind, this.toEvent(state));
	}

	private scheduleIdle(state: SessionState): void {
		if (state.idleTimer) clearTimeout(state.idleTimer);
		state.idleTimer = setTimeout(() => {
			state.idleTimer = null;
			const event = this.toEvent(state);
			this.states.delete(state.sessionId);
			this.emit('idle', event);
		}, EXTERNAL_ACTIVITY_IDLE_MS);
	}

	private toEvent(state: SessionState): SessionActivityEvent {
		return {
			agentId: this.agentId,
			sessionId: state.sessionId,
			projectPath: state.projectPath,
			lastActivityAt: state.lastActivityAt,
			source: 'external',
			sizeBytes: state.sizeBytes,
		};
	}
}
