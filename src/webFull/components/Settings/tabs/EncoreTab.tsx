/**
 * EncoreTab — webFull rewrite of renderer EncoreTab
 *
 * Layer 3.3 — Settings Encore-tab port. Per the feat/settings-subtabs-lift
 * brief, the renderer's `src/renderer/components/Settings/tabs/EncoreTab.tsx`
 * is 368 LOC with ZERO `window.maestro.*` IPC calls at the JSX-handler
 * layer — every persisted write goes through the renderer's
 * `useSettings()` hook (Zustand-backed, which itself calls
 * `window.maestro.settings.set` under the hood). It DOES depend on three
 * pieces of infrastructure that have NOT been lifted to webFull yet:
 *
 *   1. `useAgentConfiguration` hook
 *      (`src/renderer/hooks/agent/useAgentConfiguration.ts`) — a 200+
 *      LOC orchestrator that polls `window.maestro.agents.detect`,
 *      `window.maestro.agents.getConfig`, `window.maestro.agents.getModels`,
 *      and exposes a stateful customization surface for the Director's
 *      Notes synopsis provider. Lifting this hook is a multi-IPC port
 *      that belongs to a later Settings layer.
 *
 *   2. `AGENT_TILES` from `src/renderer/components/Wizard/screens/AgentSelectionScreen`
 *      — the canonical list of supported agents the picker filters
 *      against. Belongs to the Wizard lift series, not the Settings
 *      sub-tabs lift.
 *
 *   3. `isBetaAgent` from `src/shared/agentMetadata` — small pure helper,
 *      but only meaningful when the picker is wired.
 *
 * Coverage today (the persisted settings keys the renderer's Encore tab
 * writes, ALL routed through `useSettings().setSetting`):
 *   - encoreFeatures.directorNotes          — boolean toggle for the
 *                                              Director's Notes Encore
 *                                              feature itself
 *   - directorNotesSettings.defaultLookbackDays — number (1-90), default
 *                                              lookback window for the
 *                                              synopsis report
 *
 * Deferred (surfaced inline so the user knows what's missing — explicit
 * per the "do not silently drop features" rule from the brief):
 *   - Synopsis Provider picker — requires `useAgentConfiguration` +
 *     `AGENT_TILES` + `isBetaAgent` lifts. The persisted shape
 *     (`directorNotesSettings.provider` + `customPath` + `customArgs` +
 *     `customEnvVars`) is preserved on the server (we do not wipe it on
 *     read), only the editor surface is hidden. Surfaced as deferred so
 *     the user is not surprised.
 *   - AgentConfigPanel (customize the provider's binary / args / env)
 *     — already lifted to `src/webFull/components/shared/AgentConfigPanel.tsx`,
 *     but useless without the `useAgentConfiguration` state shape it
 *     consumes. Comes online together with the picker.
 *
 * Architecturally: the toggle + lookback slider are the "always-on"
 * surface — they work the moment a user opens this tab, before any
 * provider-detection IPC fires. The picker is the "expand to configure"
 * surface, which is exactly the layer that needs the deferred hook lifts.
 * Shipping the toggle + slider now means a user CAN turn the feature on
 * and pick a lookback window today; they just cannot reconfigure which
 * agent runs the synopsis until the next sub-tabs-lift round.
 */

import { Clapperboard, FlaskConical } from 'lucide-react';
import type { Theme } from '../../../../shared/theme-types';
import { useSettings } from '../../../hooks/useSettings';

export interface EncoreTabProps {
	theme: Theme;
	/** Mirrors the renderer's `isOpen` flag — passed through for parity. */
	isOpen: boolean;
}

/**
 * Persisted shape mirrors `src/renderer/types/index.ts`
 * `EncoreFeatureFlags` and `DirectorNotesSettings`. Re-declared here as
 * narrowing helpers so this tab is not transitively dependent on the
 * renderer types tree (per the cross-fork-line audit hygiene rule).
 */
interface EncoreFeatureFlags {
	directorNotes: boolean;
}

interface DirectorNotesSettings {
	provider: string; // ToolType — string-typed here to avoid cross-tree dep
	defaultLookbackDays: number;
	customPath?: string;
	customArgs?: string;
	customEnvVars?: Record<string, string>;
}

const DEFAULT_ENCORE_FEATURES: EncoreFeatureFlags = {
	directorNotes: false,
};

const DEFAULT_DIRECTOR_NOTES_SETTINGS: DirectorNotesSettings = {
	provider: 'claude-code',
	defaultLookbackDays: 7,
};

/**
 * Strongly-typed accessor over the generic Settings map. Keep narrowing
 * isolated so the JSX stays clean.
 */
function readEncoreFeatures(s: Record<string, unknown>): EncoreFeatureFlags {
	const raw = s['encoreFeatures'];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_ENCORE_FEATURES;
	const obj = raw as Record<string, unknown>;
	return {
		...DEFAULT_ENCORE_FEATURES,
		directorNotes:
			typeof obj['directorNotes'] === 'boolean'
				? (obj['directorNotes'] as boolean)
				: DEFAULT_ENCORE_FEATURES.directorNotes,
	};
}

function readDirectorNotesSettings(s: Record<string, unknown>): DirectorNotesSettings {
	const raw = s['directorNotesSettings'];
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return DEFAULT_DIRECTOR_NOTES_SETTINGS;
	const obj = raw as Record<string, unknown>;
	const out: DirectorNotesSettings = { ...DEFAULT_DIRECTOR_NOTES_SETTINGS };
	if (typeof obj['provider'] === 'string') {
		out.provider = obj['provider'] as string;
	}
	if (
		typeof obj['defaultLookbackDays'] === 'number' &&
		Number.isFinite(obj['defaultLookbackDays'])
	) {
		// Clamp to the renderer's documented 1-90 day range so we round-trip
		// safely even if the on-disk store has drift.
		const v = obj['defaultLookbackDays'] as number;
		out.defaultLookbackDays = Math.min(90, Math.max(1, Math.floor(v)));
	}
	if (typeof obj['customPath'] === 'string') {
		out.customPath = obj['customPath'] as string;
	}
	if (typeof obj['customArgs'] === 'string') {
		out.customArgs = obj['customArgs'] as string;
	}
	if (
		obj['customEnvVars'] &&
		typeof obj['customEnvVars'] === 'object' &&
		!Array.isArray(obj['customEnvVars'])
	) {
		const envObj = obj['customEnvVars'] as Record<string, unknown>;
		const env: Record<string, string> = {};
		for (const k of Object.keys(envObj)) {
			const val = envObj[k];
			if (typeof val === 'string') env[k] = val;
		}
		out.customEnvVars = env;
	}
	return out;
}

export function EncoreTab({ theme, isOpen: _isOpen }: EncoreTabProps) {
	const { settings, loading, error, setSetting } = useSettings();

	const encoreFeatures = readEncoreFeatures(settings);
	const directorNotesSettings = readDirectorNotesSettings(settings);

	const setEncoreFeatures = (value: EncoreFeatureFlags) => {
		void setSetting('encoreFeatures', value);
	};
	const setDirectorNotesSettings = (value: DirectorNotesSettings) => {
		void setSetting('directorNotesSettings', value);
	};

	if (loading) {
		return (
			<div
				className="text-sm opacity-60 p-4"
				style={{ color: theme.colors.textDim }}
				data-testid="webfull-encore-loading"
			>
				Loading settings…
			</div>
		);
	}

	return (
		<div className="space-y-6" data-testid="webfull-encore-tab">
			{error && (
				<div
					className="p-3 rounded border text-sm"
					style={{
						borderColor: theme.colors.error,
						color: theme.colors.error,
						backgroundColor: theme.colors.error + '20',
					}}
					data-testid="webfull-encore-error"
				>
					{error}
				</div>
			)}

			{/* Encore Features Header */}
			<div>
				<h3 className="text-sm font-bold mb-2" style={{ color: theme.colors.textMain }}>
					Encore Features
				</h3>
				<p className="text-xs" style={{ color: theme.colors.textDim }}>
					Optional features that extend Maestro&apos;s capabilities. Enable the ones you want.
					Disabled features are completely hidden from shortcuts, menus, and the command palette.
					Contributors building new features should consider gating them here to keep the core
					experience focused.
				</p>
			</div>

			{/* Director's Notes Feature Section */}
			<div
				className="rounded-lg border"
				style={{
					borderColor: encoreFeatures.directorNotes ? theme.colors.accent : theme.colors.border,
					backgroundColor: encoreFeatures.directorNotes
						? `${theme.colors.accent}08`
						: 'transparent',
				}}
				data-testid="webfull-encore-director-notes-section"
			>
				{/* Feature Toggle Header */}
				<button
					className="w-full flex items-center justify-between p-4 text-left"
					onClick={() =>
						setEncoreFeatures({
							...encoreFeatures,
							directorNotes: !encoreFeatures.directorNotes,
						})
					}
					data-testid="webfull-encore-director-notes-toggle"
					aria-pressed={encoreFeatures.directorNotes}
				>
					<div className="flex items-center gap-3">
						<Clapperboard
							className="w-5 h-5"
							style={{
								color: encoreFeatures.directorNotes ? theme.colors.accent : theme.colors.textDim,
							}}
						/>
						<div>
							<div
								className="text-sm font-bold flex items-center gap-2"
								style={{ color: theme.colors.textMain }}
							>
								Director&apos;s Notes
								<span
									className="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase"
									style={{
										backgroundColor: theme.colors.warning + '30',
										color: theme.colors.warning,
									}}
								>
									Beta
								</span>
							</div>
							<div className="text-xs mt-0.5" style={{ color: theme.colors.textDim }}>
								Unified history view and AI-generated synopsis across all sessions
							</div>
						</div>
					</div>
					<div
						className={`relative w-10 h-5 rounded-full transition-colors ${
							encoreFeatures.directorNotes ? '' : 'opacity-50'
						}`}
						style={{
							backgroundColor: encoreFeatures.directorNotes
								? theme.colors.accent
								: theme.colors.border,
						}}
						role="switch"
						aria-checked={encoreFeatures.directorNotes}
					>
						<div
							className="absolute top-0.5 w-4 h-4 rounded-full bg-white transition-transform"
							style={{
								transform: encoreFeatures.directorNotes ? 'translateX(22px)' : 'translateX(2px)',
							}}
						/>
					</div>
				</button>

				{/* Director's Notes Settings (shown when enabled) */}
				{encoreFeatures.directorNotes && (
					<div
						className="px-4 pb-4 space-y-6 border-t"
						style={{ borderColor: theme.colors.border }}
						data-testid="webfull-encore-director-notes-settings"
					>
						{/* Provider Selection — deferred: needs useAgentConfiguration
						    + AGENT_TILES + isBetaAgent lifts. The persisted
						    `directorNotesSettings.provider` field round-trips through
						    the settings store untouched; the editor for it is what's
						    missing. */}
						<div className="pt-4">
							<div
								className="block text-xs font-bold opacity-70 uppercase mb-2"
								style={{ color: theme.colors.textMain }}
							>
								Synopsis Provider
							</div>
							<div
								className="p-3 rounded border text-xs"
								style={{
									borderColor: theme.colors.border,
									color: theme.colors.textDim,
									backgroundColor: theme.colors.bgActivity,
								}}
								data-testid="webfull-encore-director-notes-provider-deferred"
							>
								<div className="font-bold opacity-70 uppercase flex items-center gap-2 mb-1">
									<FlaskConical className="w-3 h-3" />
									Coming in subsequent layers
								</div>
								<div>
									Synopsis Provider picker — requires the agent-detection / config-customization
									infrastructure to land in webFull first. Your current selection (
									<code style={{ color: theme.colors.textMain }}>
										{directorNotesSettings.provider}
									</code>
									) is preserved on the server and will continue to drive synopsis runs.
								</div>
							</div>
							<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
								The AI agent used to generate synopsis summaries
							</p>
						</div>

						{/* Default Lookback Period — fully wired through `setSetting`. */}
						<div>
							<div
								className="block text-xs font-bold mb-2"
								style={{ color: theme.colors.textMain }}
							>
								Default Lookback Period: {directorNotesSettings.defaultLookbackDays} days
							</div>
							<input
								type="range"
								min={1}
								max={90}
								value={directorNotesSettings.defaultLookbackDays}
								onChange={(e) =>
									setDirectorNotesSettings({
										...directorNotesSettings,
										defaultLookbackDays: parseInt(e.target.value, 10),
									})
								}
								className="w-full"
								aria-label="Default lookback period in days"
								data-testid="webfull-encore-director-notes-lookback"
							/>
							<div
								className="flex justify-between text-[10px] mt-1"
								style={{ color: theme.colors.textDim }}
							>
								<span>1 day</span>
								<span>7</span>
								<span>14</span>
								<span>30</span>
								<span>60</span>
								<span>90 days</span>
							</div>
							<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
								How far back to look when generating notes (can be adjusted per-report)
							</p>
						</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default EncoreTab;
