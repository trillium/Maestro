/**
 * UsageDashboard types — webFull lift
 *
 * Phase-1 leaf lift. The renderer expresses these types inline inside
 * `src/renderer/hooks/stats/useStats.ts` (the orchestrator hook). The hook
 * itself is IPC-bound (`window.maestro.stats.getAggregation` /
 * `window.maestro.stats.onStatsUpdate`) and lives in Phase 3 of the lift plan.
 * The chart leaves only consume the data shapes, so we extract them here so
 * Tier B charts can land in webFull ahead of the hook.
 *
 * When the Phase-3 engine (useStats) is ported into webFull, it should import
 * `StatsTimeRange` / `StatsAggregation` from this file instead of redefining
 * them, keeping the chart leaves stable as the data path is rewired to
 * `fetch('/api/stats/aggregation?range=…')` + an SSE/WS pub/sub frame.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

// Stats time range type matching the backend API
export type StatsTimeRange = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'all';

// Aggregation data shape from the stats API
export interface StatsAggregation {
	totalQueries: number;
	totalDuration: number;
	avgDuration: number;
	byAgent: Record<string, { count: number; duration: number }>;
	bySource: { user: number; auto: number };
	byLocation: { local: number; remote: number };
	byDay: Array<{ date: string; count: number; duration: number }>;
	byHour: Array<{ hour: number; count: number; duration: number }>;
	// Session lifecycle stats
	totalSessions: number;
	sessionsByAgent: Record<string, number>;
	sessionsByDay: Array<{ date: string; count: number }>;
	avgSessionDuration: number;
	// Per-provider per-day breakdown for provider comparison
	byAgentByDay: Record<string, Array<{ date: string; count: number; duration: number }>>;
	// Per-session per-day breakdown for agent usage chart
	bySessionByDay: Record<string, Array<{ date: string; count: number; duration: number }>>;
}
