/**
 * Claude usage snapshot store.
 *
 * Caches the most recent `maestro-p --status` output per Claude config directory
 * (`CLAUDE_CONFIG_DIR`, or `~/.claude` when unset). The mode selector consults this
 * store under `headlessMode === 'auto'` to decide whether the session/week quota
 * windows are exhausted enough to flip the next turn to api mode.
 *
 * Backed by its own electron-store namespace (`claude-usage-snapshots`). Snapshots
 * older than 24h are treated as absent so a stale cache never strands a tab on api
 * after the quota windows reset. Pruning happens on read and on write; we never
 * spawn a timer or background job.
 *
 * Singleton: the module-level Store is created lazily on first access so tests can
 * mock `electron-store` before any handler instantiates it.
 */

import os from 'os';
import path from 'path';
import Store from 'electron-store';

import type { UsageSnapshot } from '../agents/claude-mode-selector';

export type { UsageSnapshot } from '../agents/claude-mode-selector';

/** Hard 24h TTL for cached snapshots, measured against `sampledAt`. */
const SNAPSHOT_TTL_MS = 24 * 60 * 60 * 1000;

interface ClaudeUsageSnapshotsSchema {
	/** Keyed by `UsageSnapshot.configDirKey` — a `path.resolve()`-canonical absolute path. */
	snapshots: Record<string, UsageSnapshot>;
}

const SNAPSHOT_DEFAULTS: ClaudeUsageSnapshotsSchema = { snapshots: {} };

let _store: Store<ClaudeUsageSnapshotsSchema> | null = null;

function getStore(): Store<ClaudeUsageSnapshotsSchema> {
	if (!_store) {
		_store = new Store<ClaudeUsageSnapshotsSchema>({
			name: 'claude-usage-snapshots',
			defaults: SNAPSHOT_DEFAULTS,
		});
	}
	return _store;
}

function isExpired(snapshot: UsageSnapshot, nowMs: number): boolean {
	const sampledAtMs = new Date(snapshot.sampledAt).getTime();
	if (Number.isNaN(sampledAtMs)) {
		// Malformed timestamp — treat as expired so callers re-sample.
		return true;
	}
	return nowMs - sampledAtMs > SNAPSHOT_TTL_MS;
}

function readSnapshots(): Record<string, UsageSnapshot> {
	return getStore().get('snapshots', {});
}

function writeSnapshots(snapshots: Record<string, UsageSnapshot>): void {
	getStore().set('snapshots', snapshots);
}

/**
 * Persist a snapshot under its `configDirKey`. Overwrites any existing snapshot for
 * the same key and incidentally drops any other snapshot whose `sampledAt` is now
 * older than 24h.
 */
export function setSnapshot(snapshot: UsageSnapshot): void {
	const nowMs = Date.now();
	const existing = readSnapshots();
	const next: Record<string, UsageSnapshot> = {};
	for (const [key, snap] of Object.entries(existing)) {
		if (!isExpired(snap, nowMs)) {
			next[key] = snap;
		}
	}
	next[snapshot.configDirKey] = snapshot;
	writeSnapshots(next);
}

/**
 * Return the live snapshot for `configDirKey`, or `null` if none is cached or the
 * cached one has aged past 24h.
 */
export function getSnapshot(configDirKey: string): UsageSnapshot | null {
	const snapshot = readSnapshots()[configDirKey];
	if (!snapshot) return null;
	if (isExpired(snapshot, Date.now())) return null;
	return snapshot;
}

/**
 * Return all currently-live snapshots keyed by `configDirKey`. Expired entries are
 * filtered out so callers (e.g. a future debug helper) never see stale data.
 */
export function getAllSnapshots(): Record<string, UsageSnapshot> {
	const nowMs = Date.now();
	const existing = readSnapshots();
	const live: Record<string, UsageSnapshot> = {};
	for (const [key, snap] of Object.entries(existing)) {
		if (!isExpired(snap, nowMs)) {
			live[key] = snap;
		}
	}
	return live;
}

/** Drop every cached snapshot. Intended for tests; safe to call at runtime too. */
export function clear(): void {
	writeSnapshots({});
}

/**
 * Canonical key for the Claude config directory the snapshot describes. Mirrors the
 * resolution that the sampler (next task) and spawner will use, so identical envs
 * always produce identical keys regardless of how the path was written.
 */
export function resolveConfigDirKey(env: NodeJS.ProcessEnv): string {
	const dir = env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
	return path.resolve(dir);
}
