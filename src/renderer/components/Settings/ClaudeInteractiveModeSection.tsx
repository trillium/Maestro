/**
 * ClaudeInteractiveModeSection - Settings section for Claude Code headless mode
 *
 * Surfaces the two settings registered in phase 2 (`SETTINGS_METADATA` in
 * `src/shared/settingsMetadata.ts`):
 *   - `claudeCode.headlessMode`            (Interactive / API / Auto)
 *   - `claudeCode.autoFallbackToApiOnLimit` (boolean)
 *
 * Plus a read-only listing of the current `maestro-p --status` snapshots from
 * the renderer's `claudeUsageStore`, grouped by `configDirKey`. The "Refresh
 * now" button forwards to the `claude:usage:refresh-all` IPC handler added in
 * phase 3 task 4, then re-pulls the snapshot map.
 *
 * `data-setting-id` attributes on every control match the canonical dotted
 * keys registered in `SETTINGS_METADATA` so future settings-search infra can
 * locate them by key.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Brain, RefreshCw, Terminal } from 'lucide-react';
import type { Theme } from '../../types';
import { ToggleButtonGroup } from '../ToggleButtonGroup';
import { SettingCheckbox } from '../SettingCheckbox';
import { useClaudeUsageStore, type ClaudeUsageSnapshot } from '../../stores/claudeUsageStore';
import type { ClaudeHeadlessMode } from '../../stores/settingsStore';
import { formatRelativeTime } from '../../../shared/formatters';

export interface ClaudeInteractiveModeSectionProps {
	theme: Theme;
	headlessMode: ClaudeHeadlessMode;
	onHeadlessModeChange: (value: ClaudeHeadlessMode) => void;
	autoFallbackToApiOnLimit: boolean;
	onAutoFallbackToApiOnLimitChange: (value: boolean) => void;
}

/**
 * Short label for a `configDirKey`. Mirrors `accountShortName` in
 * `ClaudePlanUsage.tsx` / `ClaudeModeBadge.tsx` so dashboard, badge tooltip,
 * and settings rows show identical names for the same account.
 */
function accountShortName(configDirKey: string): string {
	const base = configDirKey.split('/').filter(Boolean).pop() ?? '';
	if (!base || base === '.claude') return 'default';
	if (base.startsWith('.claude-')) return base.slice('.claude-'.length) || 'default';
	if (base.startsWith('.claude')) return base.slice('.claude'.length) || 'default';
	return base;
}

const HEADLESS_MODE_HELP: Record<ClaudeHeadlessMode, string> = {
	interactive:
		'Always run via maestro-p (drives the Claude TUI). Burns your Max plan quota, no API cost.',
	api: 'Always run via `claude --print`. Billed per token; tool-call cards render fully.',
	auto: 'Try interactive first, fall back to API when the Max plan quota is exhausted.',
};

function UsageSnapshotRow({
	configDirKey,
	snapshot,
	theme,
}: {
	configDirKey: string;
	snapshot: ClaudeUsageSnapshot;
	theme: Theme;
}) {
	const short = accountShortName(configDirKey);
	return (
		<div
			className="p-3 rounded border"
			style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			data-testid={`claude-mode-usage-row-${configDirKey}`}
		>
			<div className="flex items-baseline justify-between gap-3 mb-2">
				<div
					className="text-sm font-medium truncate"
					style={{ color: theme.colors.textMain }}
					title={configDirKey}
				>
					{short}
				</div>
				<div
					className="text-[10px] uppercase tracking-wider flex-shrink-0"
					style={{ color: theme.colors.textDim }}
				>
					sampled {formatRelativeTime(snapshot.sampledAt)}
				</div>
			</div>
			<div className="grid grid-cols-3 gap-2 text-xs" style={{ color: theme.colors.textDim }}>
				<div>
					<div className="opacity-60">Session</div>
					<div style={{ color: theme.colors.textMain }}>{snapshot.session.percent.toFixed(0)}%</div>
					<div className="opacity-60">resets {formatRelativeTime(snapshot.session.resetsAt)}</div>
				</div>
				<div>
					<div className="opacity-60">Week (all)</div>
					<div style={{ color: theme.colors.textMain }}>
						{snapshot.weekAllModels.percent.toFixed(0)}%
					</div>
					<div className="opacity-60">
						resets {formatRelativeTime(snapshot.weekAllModels.resetsAt)}
					</div>
				</div>
				<div>
					<div className="opacity-60">Week (Sonnet)</div>
					<div style={{ color: theme.colors.textMain }}>
						{snapshot.weekSonnetOnly.percent.toFixed(0)}%
					</div>
					<div className="opacity-60">
						resets {formatRelativeTime(snapshot.weekSonnetOnly.resetsAt)}
					</div>
				</div>
			</div>
		</div>
	);
}

export function ClaudeInteractiveModeSection({
	theme,
	headlessMode,
	onHeadlessModeChange,
	autoFallbackToApiOnLimit,
	onAutoFallbackToApiOnLimitChange,
}: ClaudeInteractiveModeSectionProps) {
	const snapshots = useClaudeUsageStore((s) => s.snapshots);
	const ensureLoaded = useClaudeUsageStore((s) => s.ensureLoaded);
	const refresh = useClaudeUsageStore((s) => s.refresh);
	const [isRefreshing, setIsRefreshing] = useState(false);

	useEffect(() => {
		void ensureLoaded();
	}, [ensureLoaded]);

	const handleRefresh = useCallback(async () => {
		if (isRefreshing) return;
		setIsRefreshing(true);
		try {
			await window.maestro.agents.refreshClaudeUsageSnapshots();
			await refresh();
		} finally {
			setIsRefreshing(false);
		}
	}, [isRefreshing, refresh]);

	const sortedRows = useMemo(
		() => Object.entries(snapshots).sort(([a], [b]) => a.localeCompare(b)),
		[snapshots]
	);

	return (
		<div className="space-y-5">
			{/* Headless mode dropdown (three-state toggle group) */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Terminal className="w-3 h-3" />
					Claude Interactive Mode
				</div>
				<div
					className="p-3 rounded border"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<div className="font-medium mb-1" style={{ color: theme.colors.textMain }}>
						Default spawn mode for new Claude Code tabs
					</div>
					<div
						className="text-sm opacity-60 mb-3"
						style={{ color: theme.colors.textDim }}
						data-testid="claude-mode-help"
					>
						{HEADLESS_MODE_HELP[headlessMode]}
					</div>
					<div data-setting-id="claudeCode.headlessMode">
						<ToggleButtonGroup
							options={[
								{ value: 'interactive' as const, label: 'Interactive' },
								{ value: 'api' as const, label: 'API' },
								{ value: 'auto' as const, label: 'Auto' },
							]}
							value={headlessMode}
							onChange={onHeadlessModeChange}
							theme={theme}
						/>
					</div>
				</div>
			</div>

			{/* Auto-fallback-on-limit toggle */}
			<div data-setting-id="claudeCode.autoFallbackToApiOnLimit">
				<SettingCheckbox
					icon={Brain}
					sectionLabel="Auto-fallback on limit"
					title="Fall back to API mode when the Max plan quota is exhausted"
					description="When Interactive Mode is set to Auto and the Claude Max plan limit is hit, transparently switch the next turn to API. Disable to surface the TUI limit message instead."
					checked={autoFallbackToApiOnLimit}
					onChange={onAutoFallbackToApiOnLimitChange}
					theme={theme}
				/>
			</div>

			{/* Live usage snapshots */}
			<div>
				<div className="flex items-center justify-between mb-2">
					<div className="block text-xs font-bold opacity-70 uppercase flex items-center gap-2">
						<RefreshCw className="w-3 h-3" />
						Claude Plan Usage
					</div>
					<button
						type="button"
						onClick={handleRefresh}
						disabled={isRefreshing}
						className="flex items-center gap-1.5 px-2.5 py-1 rounded text-xs transition-colors"
						style={{
							color: theme.colors.textMain,
							backgroundColor: `${theme.colors.accent}15`,
							opacity: isRefreshing ? 0.6 : 1,
							cursor: isRefreshing ? 'wait' : 'pointer',
						}}
						data-testid="claude-mode-usage-refresh"
						aria-label="Refresh Claude usage snapshots"
					>
						<RefreshCw className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`} />
						{isRefreshing ? 'Refreshing…' : 'Refresh now'}
					</button>
				</div>
				<p className="text-xs opacity-50 mb-2" style={{ color: theme.colors.textDim }}>
					Live `maestro-p --status` snapshots, grouped by `CLAUDE_CONFIG_DIR`. Read-only — these
					drive the Auto-mode quota threshold check.
				</p>
				{sortedRows.length === 0 ? (
					<div
						className="p-3 rounded border text-sm opacity-60"
						style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
						data-testid="claude-mode-usage-empty"
					>
						No Claude usage snapshots yet. Click "Refresh now" to sample your accounts.
					</div>
				) : (
					<div className="space-y-2">
						{sortedRows.map(([key, snap]) => (
							<UsageSnapshotRow key={key} configDirKey={key} snapshot={snap} theme={theme} />
						))}
					</div>
				)}
			</div>
		</div>
	);
}

export default ClaudeInteractiveModeSection;
