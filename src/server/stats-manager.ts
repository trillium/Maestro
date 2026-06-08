/**
 * Server-side stats database manager — headless variant of
 * `src/main/stats/stats-db.ts` + its sibling CRUD modules.
 *
 * Ported for W2 (closes the server half of `ISC-44.general.stats`,
 * tracked in `ISA.md`). Differences from the renderer-side `StatsDB`:
 *
 *   1. **No `electron` import.** `app.getPath('userData')` is replaced
 *      with `getDataDir()` from `src/shared/data-dir.ts`. The on-disk
 *      file lands at `<dataDir>/stats.db`, matching the Electron-mode
 *      layout exactly when `MAESTRO_DATA_DIR` points at
 *      `~/Library/Application Support/maestro-dev`.
 *
 *   2. **No `src/main/utils/logger` import.** Falls back to `console.*`
 *      with a `[StatsDB]` prefix — matches the rest of `src/server/`,
 *      which standardizes on `console.log/warn/error` to avoid
 *      re-pulling the main-process logger graph into the server build.
 *
 *   3. **No `PerformanceMetrics` integration.** The renderer-side
 *      manager has an opt-in metrics logger that wraps every read; the
 *      server-side variant skips it. The REST routes are the only
 *      consumer and they don't need per-query timing instrumentation.
 *      If a future change wants it, `src/shared/performance-metrics.ts`
 *      is electron-free and can be wired in additively here without
 *      touching the renderer surface.
 *
 *   4. **No daily-backup / VACUUM / corruption-recovery scheduling.**
 *      The headless server's stats DB shares the same on-disk file as
 *      Electron in hybrid deploys; running parallel backup loops from
 *      both processes would race. The renderer-side `StatsDB` already
 *      owns these maintenance routines and runs on every Electron
 *      boot. The server-side variant trusts that contract and limits
 *      itself to read-mostly access plus the explicit
 *      `clearOldData()` write the REST route exposes.
 *
 *   5. **Migration runner kept.** The L0a brief documented that the
 *      stats DB has 4 migrations baked in. The server-side manager
 *      must NOT bypass them — a fresh DB created here (e.g.
 *      `MAESTRO_DATA_DIR=/tmp/...` on first boot) needs the same
 *      schema as an Electron-side DB. The migration logic is inlined
 *      here so this module stays self-contained, but it is byte-for-
 *      byte identical to `src/main/stats/migrations.ts` —
 *      same version numbers, same `_migrations` table, same
 *      `user_version` pragma. Running this manager against an
 *      Electron-created DB is a no-op (current_version >= 4).
 *
 *   6. **Public API matches `StatsDB` for the methods the REST routes
 *      call.** `initialize()`, `close()`, `getDbSize()`,
 *      `getEarliestTimestamp()`, `clearOldData()`, `getQueryEvents()`,
 *      `getAggregatedStats()`, `getSessionLifecycleEvents()`,
 *      `getAutoRunSessions()`. The write surface (`insertQueryEvent`,
 *      etc.) is NOT exposed here — the headless server does not
 *      record stats events; the renderer does, and a hybrid deploy
 *      sees the same on-disk file.
 *
 *   7. **No `BrowserWindow.webContents.send` anywhere.** The renderer
 *      pushes `stats:updated` events to the renderer after every IPC
 *      write; the server-side variant has no equivalent and matches
 *      polling-based semantics (the webFull stats panel re-fetches on
 *      mount or explicit refresh). If a future change wires push, the
 *      hook is `WebServer.broadcastService.broadcastStatsChanged`
 *      (additive on `broadcastService.ts`) — NOT this module.
 *
 * The renderer-side `src/main/stats/*.ts` files are NOT touched. This
 * module is the new server-side surface; the renderer continues to
 * import from `src/main/stats/`. Both can run side by side in a
 * hybrid (Electron + headless sidecar) deployment because the on-disk
 * SQLite file is the contract between modes.
 */

import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';

import { getDataDir } from '../shared/data-dir';
import type {
	QueryEvent,
	AutoRunSession,
	SessionLifecycleEvent,
	StatsTimeRange,
	StatsFilters,
	StatsAggregation,
} from '../shared/stats-types';

const LOG_CONTEXT = '[StatsDB]';

/* ============ Time-range helper (mirrors src/main/stats/utils.ts) ============ */

function getTimeRangeStart(range: StatsTimeRange): number {
	const now = Date.now();
	const day = 24 * 60 * 60 * 1000;
	switch (range) {
		case 'day':
			return now - day;
		case 'week':
			return now - 7 * day;
		case 'month':
			return now - 30 * day;
		case 'quarter':
			return now - 90 * day;
		case 'year':
			return now - 365 * day;
		case 'all':
			return 0;
		default:
			return 0;
	}
}

function normalizePath(filePath: string | null | undefined): string | null {
	if (filePath == null) return null;
	return filePath.replace(/\\/g, '/');
}

/* ============ Schema SQL (mirrors src/main/stats/schema.ts) ============ */

const CREATE_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at INTEGER NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('success', 'failed')),
    error_message TEXT
  )
`;

const CREATE_META_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )
`;

const CREATE_QUERY_EVENTS_SQL = `
  CREATE TABLE IF NOT EXISTS query_events (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    source TEXT NOT NULL CHECK(source IN ('user', 'auto')),
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    project_path TEXT,
    tab_id TEXT
  )
`;

const CREATE_QUERY_EVENTS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_query_start_time ON query_events(start_time);
  CREATE INDEX IF NOT EXISTS idx_query_agent_type ON query_events(agent_type);
  CREATE INDEX IF NOT EXISTS idx_query_source ON query_events(source);
  CREATE INDEX IF NOT EXISTS idx_query_session ON query_events(session_id);
  CREATE INDEX IF NOT EXISTS idx_query_project_path ON query_events(project_path);
  CREATE INDEX IF NOT EXISTS idx_query_time_agent ON query_events(start_time, agent_type);
  CREATE INDEX IF NOT EXISTS idx_query_time_project ON query_events(start_time, project_path);
  CREATE INDEX IF NOT EXISTS idx_query_time_source ON query_events(start_time, source)
`;

const CREATE_AUTO_RUN_SESSIONS_SQL = `
  CREATE TABLE IF NOT EXISTS auto_run_sessions (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    document_path TEXT,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    tasks_total INTEGER,
    tasks_completed INTEGER,
    project_path TEXT
  )
`;

const CREATE_AUTO_RUN_SESSIONS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_auto_session_start ON auto_run_sessions(start_time)
`;

const CREATE_AUTO_RUN_TASKS_SQL = `
  CREATE TABLE IF NOT EXISTS auto_run_tasks (
    id TEXT PRIMARY KEY,
    auto_run_session_id TEXT NOT NULL REFERENCES auto_run_sessions(id),
    session_id TEXT NOT NULL,
    agent_type TEXT NOT NULL,
    task_index INTEGER NOT NULL,
    task_content TEXT,
    start_time INTEGER NOT NULL,
    duration INTEGER NOT NULL,
    success INTEGER NOT NULL CHECK(success IN (0, 1))
  )
`;

const CREATE_AUTO_RUN_TASKS_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_task_auto_session ON auto_run_tasks(auto_run_session_id);
  CREATE INDEX IF NOT EXISTS idx_task_start ON auto_run_tasks(start_time)
`;

const CREATE_SESSION_LIFECYCLE_SQL = `
  CREATE TABLE IF NOT EXISTS session_lifecycle (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL UNIQUE,
    agent_type TEXT NOT NULL,
    project_path TEXT,
    created_at INTEGER NOT NULL,
    closed_at INTEGER,
    duration INTEGER,
    is_remote INTEGER
  )
`;

const CREATE_SESSION_LIFECYCLE_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_session_created_at ON session_lifecycle(created_at);
  CREATE INDEX IF NOT EXISTS idx_session_agent_type ON session_lifecycle(agent_type)
`;

const CREATE_COMPOUND_INDEXES_SQL = `
  CREATE INDEX IF NOT EXISTS idx_query_time_agent ON query_events(start_time, agent_type);
  CREATE INDEX IF NOT EXISTS idx_query_time_project ON query_events(start_time, project_path);
  CREATE INDEX IF NOT EXISTS idx_query_time_source ON query_events(start_time, source)
`;

function runStatements(db: Database.Database, multiStatementSql: string): void {
	for (const sql of multiStatementSql.split(';').filter((s) => s.trim())) {
		db.prepare(sql).run();
	}
}

/* ============ Migration runner (mirrors src/main/stats/migrations.ts) ============ */

interface Migration {
	version: number;
	description: string;
	up: (db: Database.Database) => void;
}

function getMigrations(): Migration[] {
	return [
		{
			version: 1,
			description: 'Initial schema: query_events, auto_run_sessions, auto_run_tasks tables',
			up: (db) => {
				db.prepare(CREATE_QUERY_EVENTS_SQL).run();
				runStatements(db, CREATE_QUERY_EVENTS_INDEXES_SQL);
				db.prepare(CREATE_AUTO_RUN_SESSIONS_SQL).run();
				runStatements(db, CREATE_AUTO_RUN_SESSIONS_INDEXES_SQL);
				db.prepare(CREATE_AUTO_RUN_TASKS_SQL).run();
				runStatements(db, CREATE_AUTO_RUN_TASKS_INDEXES_SQL);
			},
		},
		{
			version: 2,
			description: 'Add is_remote column to query_events for tracking SSH sessions',
			up: (db) => {
				db.prepare('ALTER TABLE query_events ADD COLUMN is_remote INTEGER').run();
				db.prepare(
					'CREATE INDEX IF NOT EXISTS idx_query_is_remote ON query_events(is_remote)'
				).run();
			},
		},
		{
			version: 3,
			description: 'Add session_lifecycle table for tracking session creation and closure',
			up: (db) => {
				db.prepare(CREATE_SESSION_LIFECYCLE_SQL).run();
				runStatements(db, CREATE_SESSION_LIFECYCLE_INDEXES_SQL);
			},
		},
		{
			version: 4,
			description: 'Add compound indexes on query_events for dashboard query performance',
			up: (db) => {
				runStatements(db, CREATE_COMPOUND_INDEXES_SQL);
			},
		},
	];
}

function runMigrations(db: Database.Database): void {
	db.prepare(CREATE_MIGRATIONS_TABLE_SQL).run();

	const versionResult = db.pragma('user_version') as Array<{ user_version: number }>;
	const currentVersion = versionResult[0]?.user_version ?? 0;

	const migrations = getMigrations();
	const pendingMigrations = migrations.filter((m) => m.version > currentVersion);

	if (pendingMigrations.length === 0) {
		console.log(`${LOG_CONTEXT} Database is up to date (version ${currentVersion})`);
		return;
	}

	pendingMigrations.sort((a, b) => a.version - b.version);

	console.log(
		`${LOG_CONTEXT} Running ${pendingMigrations.length} pending migration(s) (current version: ${currentVersion})`
	);

	for (const migration of pendingMigrations) {
		applyMigration(db, migration);
	}
}

function applyMigration(db: Database.Database, migration: Migration): void {
	const startTime = Date.now();
	console.log(`${LOG_CONTEXT} Applying migration v${migration.version}: ${migration.description}`);

	try {
		const runMigrationTxn = db.transaction(() => {
			migration.up(db);

			db.prepare(
				`
        INSERT OR REPLACE INTO _migrations (version, description, applied_at, status, error_message)
        VALUES (?, ?, ?, 'success', NULL)
      `
			).run(migration.version, migration.description, Date.now());

			db.pragma(`user_version = ${migration.version}`);
		});

		runMigrationTxn();

		const duration = Date.now() - startTime;
		console.log(`${LOG_CONTEXT} Migration v${migration.version} completed in ${duration}ms`);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		db.prepare(
			`
      INSERT OR REPLACE INTO _migrations (version, description, applied_at, status, error_message)
      VALUES (?, ?, ?, 'failed', ?)
    `
		).run(migration.version, migration.description, Date.now(), errorMessage);
		console.error(`${LOG_CONTEXT} Migration v${migration.version} failed: ${errorMessage}`);
		throw error;
	}
}

/* ============ Row mappers (mirrors src/main/stats/row-mappers.ts) ============ */

interface QueryEventRow {
	id: string;
	session_id: string;
	agent_type: string;
	source: 'user' | 'auto';
	start_time: number;
	duration: number;
	project_path: string | null;
	tab_id: string | null;
	is_remote: number | null;
}

interface AutoRunSessionRow {
	id: string;
	session_id: string;
	agent_type: string;
	document_path: string | null;
	start_time: number;
	duration: number;
	tasks_total: number | null;
	tasks_completed: number | null;
	project_path: string | null;
}

interface SessionLifecycleRow {
	id: string;
	session_id: string;
	agent_type: string;
	project_path: string | null;
	created_at: number;
	closed_at: number | null;
	duration: number | null;
	is_remote: number | null;
}

function mapQueryEventRow(row: QueryEventRow): QueryEvent {
	return {
		id: row.id,
		sessionId: row.session_id,
		agentType: row.agent_type,
		source: row.source,
		startTime: row.start_time,
		duration: row.duration,
		projectPath: row.project_path ?? undefined,
		tabId: row.tab_id ?? undefined,
		isRemote: row.is_remote !== null ? row.is_remote === 1 : undefined,
	};
}

function mapAutoRunSessionRow(row: AutoRunSessionRow): AutoRunSession {
	return {
		id: row.id,
		sessionId: row.session_id,
		agentType: row.agent_type,
		documentPath: row.document_path ?? undefined,
		startTime: row.start_time,
		duration: row.duration,
		tasksTotal: row.tasks_total ?? undefined,
		tasksCompleted: row.tasks_completed ?? undefined,
		projectPath: row.project_path ?? undefined,
	};
}

function mapSessionLifecycleRow(row: SessionLifecycleRow): SessionLifecycleEvent {
	return {
		id: row.id,
		sessionId: row.session_id,
		agentType: row.agent_type,
		projectPath: row.project_path ?? undefined,
		createdAt: row.created_at,
		closedAt: row.closed_at ?? undefined,
		duration: row.duration ?? undefined,
		isRemote: row.is_remote !== null ? row.is_remote === 1 : undefined,
	};
}

/* ============ StatsManager (server-side) ============ */

/**
 * Result shape for `clearOldData()` — mirrors the renderer-side return value
 * exactly so REST consumers can read the same fields the IPC handlers exposed.
 */
export interface ClearOldDataResult {
	success: boolean;
	deletedQueryEvents: number;
	deletedAutoRunSessions: number;
	deletedAutoRunTasks: number;
	deletedSessionLifecycle: number;
	error?: string;
}

/**
 * Headless stats DB manager. Read-mostly, plus the explicit `clearOldData()`
 * write the REST route exposes. The renderer-side `StatsDB` owns
 * insertion/recording — server doesn't write events.
 */
export class StatsManager {
	private db: Database.Database | null = null;
	private dbPath: string;
	private initialized = false;

	constructor(dbPath?: string) {
		this.dbPath = dbPath ?? path.join(getDataDir(), 'stats.db');
	}

	/**
	 * Initialize the database — create file + tables + indexes if missing,
	 * run any pending migrations. Idempotent.
	 */
	initialize(): void {
		if (this.initialized) return;

		try {
			const dir = path.dirname(this.dbPath);
			if (!fs.existsSync(dir)) {
				fs.mkdirSync(dir, { recursive: true });
			}

			this.db = new Database(this.dbPath);

			// Enable WAL mode for better concurrent access — matches renderer.
			this.db.pragma('journal_mode = WAL');

			// Create the _meta table for internal key-value storage (last-vacuum
			// timestamp lives here; we don't write to it but the renderer does,
			// and creating it idempotently keeps the on-disk schema consistent
			// across modes).
			this.db.prepare(CREATE_META_TABLE_SQL).run();

			// Run migrations — fresh DB (e.g. MAESTRO_DATA_DIR points at an empty
			// dir) catches up to schema v4. Electron-created DB is already at v4
			// and `runMigrations` no-ops.
			runMigrations(this.db);

			this.initialized = true;
			console.log(`${LOG_CONTEXT} Stats database initialized at ${this.dbPath}`);
		} catch (error) {
			console.error(`${LOG_CONTEXT} Failed to initialize stats database: ${error}`);
			throw error;
		}
	}

	/** Close the database connection */
	close(): void {
		if (this.db) {
			this.db.close();
			this.db = null;
			this.initialized = false;
			console.log(`${LOG_CONTEXT} Stats database closed`);
		}
	}

	isReady(): boolean {
		return this.initialized && this.db !== null;
	}

	getDbPath(): string {
		return this.dbPath;
	}

	/**
	 * Get the database file size in bytes. Returns 0 if the file doesn't exist
	 * or `stat` throws — matches renderer-side `StatsDB.getDatabaseSize()`.
	 */
	getDbSize(): number {
		try {
			const stats = fs.statSync(this.dbPath);
			return stats.size;
		} catch {
			return 0;
		}
	}

	private get database(): Database.Database {
		if (!this.db) throw new Error('Database not initialized');
		return this.db;
	}

	/**
	 * Get the earliest timestamp across all stats tables. Returns null if no
	 * stats data exists. Mirrors `StatsDB.getEarliestTimestamp()`.
	 *
	 * Returns ISO-8601 string for the REST surface (the renderer-side IPC
	 * returns a raw number; the REST surface uses ISO for human-readability —
	 * the Settings General-tab panel shows it as a date, never as math input).
	 */
	getEarliestTimestamp(): string | null {
		const ms = this.getEarliestTimestampMs();
		if (ms === null) return null;
		return new Date(ms).toISOString();
	}

	/**
	 * Internal raw-ms variant — useful for callers that want to do math on the
	 * timestamp. The REST route uses `getEarliestTimestamp()` (ISO string)
	 * because the panel only needs to display it.
	 */
	getEarliestTimestampMs(): number | null {
		try {
			const queryResult = this.database
				.prepare('SELECT MIN(start_time) as earliest FROM query_events')
				.get() as { earliest: number | null } | undefined;

			const autoRunResult = this.database
				.prepare('SELECT MIN(start_time) as earliest FROM auto_run_sessions')
				.get() as { earliest: number | null } | undefined;

			const lifecycleResult = this.database
				.prepare('SELECT MIN(created_at) as earliest FROM session_lifecycle')
				.get() as { earliest: number | null } | undefined;

			const timestamps = [
				queryResult?.earliest,
				autoRunResult?.earliest,
				lifecycleResult?.earliest,
			].filter((t): t is number => t !== null && t !== undefined);

			if (timestamps.length === 0) return null;
			return Math.min(...timestamps);
		} catch (error) {
			console.error(`${LOG_CONTEXT} Failed to get earliest timestamp: ${error}`);
			return null;
		}
	}

	/**
	 * Get total counts for the summary endpoint. Cheap aggregate queries —
	 * COUNT(*) over indexed tables, executed on-demand per HTTP call.
	 */
	getSummary(): {
		dbSize: number;
		earliestTimestamp: string | null;
		sessionCount: number;
		queryCount: number;
		autoRunSessionCount: number;
	} {
		const dbSize = this.getDbSize();
		const earliestTimestamp = this.getEarliestTimestamp();

		let sessionCount = 0;
		let queryCount = 0;
		let autoRunSessionCount = 0;
		try {
			const queryRow = this.database.prepare('SELECT COUNT(*) as count FROM query_events').get() as
				| { count: number }
				| undefined;
			queryCount = queryRow?.count ?? 0;

			const sessionRow = this.database
				.prepare('SELECT COUNT(*) as count FROM session_lifecycle')
				.get() as { count: number } | undefined;
			sessionCount = sessionRow?.count ?? 0;

			const autoRunRow = this.database
				.prepare('SELECT COUNT(*) as count FROM auto_run_sessions')
				.get() as { count: number } | undefined;
			autoRunSessionCount = autoRunRow?.count ?? 0;
		} catch (error) {
			console.error(`${LOG_CONTEXT} Failed to compute summary counts: ${error}`);
		}

		return {
			dbSize,
			earliestTimestamp,
			sessionCount,
			queryCount,
			autoRunSessionCount,
		};
	}

	/**
	 * Clear data older than `olderThanDays` from query_events,
	 * auto_run_sessions, auto_run_tasks, and session_lifecycle. All deletes
	 * run in a single transaction. Mirrors `clearOldData()` in
	 * `src/main/stats/data-management.ts` exactly.
	 */
	clearOldData(olderThanDays: number): ClearOldDataResult {
		if (!this.db) {
			return {
				success: false,
				deletedQueryEvents: 0,
				deletedAutoRunSessions: 0,
				deletedAutoRunTasks: 0,
				deletedSessionLifecycle: 0,
				error: 'Database not initialized',
			};
		}

		if (olderThanDays <= 0) {
			return {
				success: false,
				deletedQueryEvents: 0,
				deletedAutoRunSessions: 0,
				deletedAutoRunTasks: 0,
				deletedSessionLifecycle: 0,
				error: 'olderThanDays must be greater than 0',
			};
		}

		try {
			const cutoffTime = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;

			console.log(
				`${LOG_CONTEXT} Clearing stats data older than ${olderThanDays} days (before ${new Date(cutoffTime).toISOString()})`
			);

			let deletedEvents = 0;
			let deletedSessions = 0;
			let deletedTasks = 0;
			let deletedLifecycle = 0;

			const runCleanup = this.db.transaction(() => {
				const tasksResult = this.database
					.prepare(
						'DELETE FROM auto_run_tasks WHERE auto_run_session_id IN (SELECT id FROM auto_run_sessions WHERE start_time < ?)'
					)
					.run(cutoffTime);
				deletedTasks = tasksResult.changes;

				const sessionsResult = this.database
					.prepare('DELETE FROM auto_run_sessions WHERE start_time < ?')
					.run(cutoffTime);
				deletedSessions = sessionsResult.changes;

				const eventsResult = this.database
					.prepare('DELETE FROM query_events WHERE start_time < ?')
					.run(cutoffTime);
				deletedEvents = eventsResult.changes;

				const lifecycleResult = this.database
					.prepare('DELETE FROM session_lifecycle WHERE created_at < ?')
					.run(cutoffTime);
				deletedLifecycle = lifecycleResult.changes;
			});

			runCleanup();

			const totalDeleted = deletedEvents + deletedSessions + deletedTasks + deletedLifecycle;
			console.log(
				`${LOG_CONTEXT} Cleared ${totalDeleted} old stats records (${deletedEvents} query events, ${deletedSessions} auto-run sessions, ${deletedTasks} auto-run tasks, ${deletedLifecycle} session lifecycle)`
			);

			return {
				success: true,
				deletedQueryEvents: deletedEvents,
				deletedAutoRunSessions: deletedSessions,
				deletedAutoRunTasks: deletedTasks,
				deletedSessionLifecycle: deletedLifecycle,
			};
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : String(error);
			console.error(`${LOG_CONTEXT} Failed to clear old stats data: ${errorMessage}`);
			return {
				success: false,
				deletedQueryEvents: 0,
				deletedAutoRunSessions: 0,
				deletedAutoRunTasks: 0,
				deletedSessionLifecycle: 0,
				error: errorMessage,
			};
		}
	}

	/**
	 * Get query events within a time range with optional filters.
	 * Mirrors `getQueryEvents()` in `src/main/stats/query-events.ts`.
	 */
	getQueryEvents(range: StatsTimeRange, filters?: StatsFilters): QueryEvent[] {
		const startTime = getTimeRangeStart(range);
		let sql = 'SELECT * FROM query_events WHERE start_time >= ?';
		const params: (string | number)[] = [startTime];

		if (filters?.agentType) {
			sql += ' AND agent_type = ?';
			params.push(filters.agentType);
		}
		if (filters?.source) {
			sql += ' AND source = ?';
			params.push(filters.source);
		}
		if (filters?.projectPath) {
			sql += ' AND project_path = ?';
			params.push(normalizePath(filters.projectPath) ?? '');
		}
		if (filters?.sessionId) {
			sql += ' AND session_id = ?';
			params.push(filters.sessionId);
		}

		sql += ' ORDER BY start_time DESC';

		const stmt = this.database.prepare(sql);
		const rows = stmt.all(...params) as QueryEventRow[];
		return rows.map(mapQueryEventRow);
	}

	/**
	 * Get Auto Run sessions within a time range.
	 * Mirrors `getAutoRunSessions()` in `src/main/stats/auto-run.ts`.
	 */
	getAutoRunSessions(range: StatsTimeRange): AutoRunSession[] {
		const startTime = getTimeRangeStart(range);
		const stmt = this.database.prepare(
			`SELECT * FROM auto_run_sessions WHERE start_time >= ? ORDER BY start_time DESC`
		);
		const rows = stmt.all(startTime) as AutoRunSessionRow[];
		return rows.map(mapAutoRunSessionRow);
	}

	/**
	 * Get session lifecycle events within a time range.
	 * Mirrors `getSessionLifecycleEvents()` in `src/main/stats/session-lifecycle.ts`.
	 */
	getSessionLifecycleEvents(range: StatsTimeRange): SessionLifecycleEvent[] {
		const startTime = getTimeRangeStart(range);
		const stmt = this.database.prepare(
			`SELECT * FROM session_lifecycle WHERE created_at >= ? ORDER BY created_at DESC`
		);
		const rows = stmt.all(startTime) as SessionLifecycleRow[];
		return rows.map(mapSessionLifecycleRow);
	}

	/**
	 * Compute aggregated stats for the dashboard. Mirrors
	 * `getAggregatedStats()` in `src/main/stats/aggregations.ts` — same SQL
	 * shapes, same output type. No `PerformanceMetrics` wrapping in the
	 * server-side variant; the REST consumer is fine without per-query
	 * timing.
	 *
	 * This is the heaviest read in the manager; on a populated DB it runs ~9
	 * sub-queries. Used by the `/api/stats/aggregation` REST route.
	 */
	getAggregatedStats(range: StatsTimeRange): StatsAggregation {
		const startTime = getTimeRangeStart(range);
		const db = this.database;

		// totals
		const totalsRow = db
			.prepare(
				`SELECT COUNT(*) as total_queries, COALESCE(SUM(duration), 0) as total_duration
				 FROM query_events WHERE start_time >= ?`
			)
			.get(startTime) as { total_queries: number; total_duration: number };
		const totalQueries = totalsRow.total_queries;
		const totalDuration = totalsRow.total_duration;
		const avgDuration = totalQueries > 0 ? totalDuration / totalQueries : 0;

		// byAgent
		const byAgentRows = db
			.prepare(
				`SELECT agent_type, COUNT(*) as count, COALESCE(SUM(duration), 0) as duration
				 FROM query_events WHERE start_time >= ?
				 GROUP BY agent_type`
			)
			.all(startTime) as Array<{ agent_type: string; count: number; duration: number }>;
		const byAgent: Record<string, { count: number; duration: number }> = {};
		for (const row of byAgentRows) {
			byAgent[row.agent_type] = { count: row.count, duration: row.duration };
		}

		// bySource
		const bySourceRows = db
			.prepare(
				`SELECT source, COUNT(*) as count FROM query_events
				 WHERE start_time >= ? GROUP BY source`
			)
			.all(startTime) as Array<{ source: 'user' | 'auto'; count: number }>;
		const bySource = { user: 0, auto: 0 };
		for (const row of bySourceRows) {
			bySource[row.source] = row.count;
		}

		// byLocation (local vs remote)
		const byLocationRows = db
			.prepare(
				`SELECT
					COUNT(CASE WHEN is_remote = 1 THEN 1 END) as remote,
					COUNT(CASE WHEN is_remote IS NULL OR is_remote = 0 THEN 1 END) as local
				 FROM query_events WHERE start_time >= ?`
			)
			.get(startTime) as { local: number; remote: number };
		const byLocation = { local: byLocationRows.local, remote: byLocationRows.remote };

		// byDay
		const byDayRows = db
			.prepare(
				`SELECT
					date(start_time / 1000, 'unixepoch') as date,
					COUNT(*) as count,
					COALESCE(SUM(duration), 0) as duration
				 FROM query_events WHERE start_time >= ?
				 GROUP BY date ORDER BY date ASC`
			)
			.all(startTime) as Array<{ date: string; count: number; duration: number }>;
		const byDay = byDayRows.map((r) => ({
			date: r.date,
			count: r.count,
			duration: r.duration,
		}));

		// byAgentByDay
		const byAgentByDayRows = db
			.prepare(
				`SELECT
					agent_type,
					date(start_time / 1000, 'unixepoch') as date,
					COUNT(*) as count,
					COALESCE(SUM(duration), 0) as duration
				 FROM query_events WHERE start_time >= ?
				 GROUP BY agent_type, date ORDER BY date ASC`
			)
			.all(startTime) as Array<{
			agent_type: string;
			date: string;
			count: number;
			duration: number;
		}>;
		const byAgentByDay: Record<
			string,
			Array<{ date: string; count: number; duration: number }>
		> = {};
		for (const row of byAgentByDayRows) {
			if (!byAgentByDay[row.agent_type]) byAgentByDay[row.agent_type] = [];
			byAgentByDay[row.agent_type].push({
				date: row.date,
				count: row.count,
				duration: row.duration,
			});
		}

		// byHour
		const byHourRows = db
			.prepare(
				`SELECT
					CAST(strftime('%H', start_time / 1000, 'unixepoch', 'localtime') AS INTEGER) as hour,
					COUNT(*) as count,
					COALESCE(SUM(duration), 0) as duration
				 FROM query_events WHERE start_time >= ?
				 GROUP BY hour ORDER BY hour ASC`
			)
			.all(startTime) as Array<{ hour: number; count: number; duration: number }>;
		// Fill missing hours with 0s so the chart always has 24 buckets
		const byHour: Array<{ hour: number; count: number; duration: number }> = [];
		const hourMap = new Map(byHourRows.map((r) => [r.hour, r]));
		for (let h = 0; h < 24; h++) {
			const existing = hourMap.get(h);
			byHour.push(existing ?? { hour: h, count: 0, duration: 0 });
		}

		// sessions (lifecycle)
		const sessionsRow = db
			.prepare(
				`SELECT
					COUNT(*) as total,
					COALESCE(AVG(CASE WHEN duration IS NOT NULL THEN duration END), 0) as avg_duration
				 FROM session_lifecycle WHERE created_at >= ?`
			)
			.get(startTime) as { total: number; avg_duration: number };
		const totalSessions = sessionsRow.total;
		const avgSessionDuration = sessionsRow.avg_duration;

		const sessionsByAgentRows = db
			.prepare(
				`SELECT agent_type, COUNT(*) as count FROM session_lifecycle
				 WHERE created_at >= ? GROUP BY agent_type`
			)
			.all(startTime) as Array<{ agent_type: string; count: number }>;
		const sessionsByAgent: Record<string, number> = {};
		for (const row of sessionsByAgentRows) {
			sessionsByAgent[row.agent_type] = row.count;
		}

		const sessionsByDayRows = db
			.prepare(
				`SELECT date(created_at / 1000, 'unixepoch') as date, COUNT(*) as count
				 FROM session_lifecycle WHERE created_at >= ?
				 GROUP BY date ORDER BY date ASC`
			)
			.all(startTime) as Array<{ date: string; count: number }>;
		const sessionsByDay = sessionsByDayRows.map((r) => ({ date: r.date, count: r.count }));

		// bySessionByDay (per Maestro-session-id breakdown)
		const bySessionByDayRows = db
			.prepare(
				`SELECT
					session_id,
					date(start_time / 1000, 'unixepoch') as date,
					COUNT(*) as count,
					COALESCE(SUM(duration), 0) as duration
				 FROM query_events WHERE start_time >= ?
				 GROUP BY session_id, date ORDER BY date ASC`
			)
			.all(startTime) as Array<{
			session_id: string;
			date: string;
			count: number;
			duration: number;
		}>;
		const bySessionByDay: Record<
			string,
			Array<{ date: string; count: number; duration: number }>
		> = {};
		for (const row of bySessionByDayRows) {
			if (!bySessionByDay[row.session_id]) bySessionByDay[row.session_id] = [];
			bySessionByDay[row.session_id].push({
				date: row.date,
				count: row.count,
				duration: row.duration,
			});
		}

		return {
			totalQueries,
			totalDuration,
			avgDuration,
			byAgent,
			bySource,
			byDay,
			byLocation,
			byHour,
			totalSessions,
			sessionsByAgent,
			sessionsByDay,
			avgSessionDuration,
			byAgentByDay,
			bySessionByDay,
		};
	}
}

/* ============ Singleton accessor for the headless server ============ */

let statsManagerInstance: StatsManager | null = null;

/**
 * Get-or-create the singleton StatsManager for the headless server.
 * First call may pass an explicit dbPath; subsequent calls return the cached
 * instance regardless of arguments (matches the `getWakaTimeManager()`
 * pattern in `src/server/wakatime-manager.ts`).
 */
export function getStatsManager(dbPath?: string): StatsManager {
	if (!statsManagerInstance) {
		statsManagerInstance = new StatsManager(dbPath);
	}
	return statsManagerInstance;
}

/** Test helper — clear the singleton so a fresh manager can be constructed. */
export function _resetStatsManager(): void {
	if (statsManagerInstance) {
		try {
			statsManagerInstance.close();
		} catch {
			/* ignore */
		}
	}
	statsManagerInstance = null;
}
