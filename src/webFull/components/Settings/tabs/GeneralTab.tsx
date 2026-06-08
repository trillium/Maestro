/**
 * GeneralTab — webFull rewrite of renderer GeneralTab using lifted primitives
 *
 * Layer 3.1 — Settings General-tab port. Per the brief, the renderer's
 * `src/renderer/components/Settings/tabs/GeneralTab.tsx` is 1522 LOC across
 * 5 IPC namespaces (`settings`, `wakatime`, `sync`, `stats`, `shells`/`shell`)
 * — far above the "lift if ≤ 3 IPC" threshold from /tmp/web-ui-lift-scope.md.
 * This is a webfull-native REWRITE that preserves the OBSERVABLE FUNCTION
 * (open settings → see general options → change them → save) without
 * verbatim-copying renderer markup.
 *
 * Coverage today (the `settings.get/set` namespace fields shown in the
 * renderer's General tab):
 *   - conductorProfile          — About-Me free-form text (max 1000 chars)
 *   - logLevel                  — debug / info / warn / error
 *   - enterToSendAI             — boolean
 *   - enterToSendTerminal       — boolean
 *   - defaultSaveToHistory      — boolean
 *   - defaultShowThinking       — 'off' | 'on' | 'sticky'
 *   - autoScrollAiMode          — boolean
 *   - spellCheck                — boolean
 *   - automaticTabNamingEnabled — boolean
 *   - checkForUpdatesOnStartup  — boolean
 *   - enableBetaUpdates         — boolean
 *   - crashReportingEnabled     — boolean
 *
 * Deferred (documented in ISA Decisions as known partial-parity gaps):
 *   - WakaTime status / API-key validation (`wakatime:*` namespace)
 *   - Sync / storage location (`sync:*` namespace)
 *   - Stats DB size, clear, earliest-timestamp (`stats:*` namespace)
 *   - Shell detection (`shells:detect` — local-machine concept)
 *   - Custom shell path / args / env vars editor
 *   - Sleep prevention (`power:*` — desktop-only)
 *   - GPU acceleration toggle (Electron-only renderer setting)
 *   - "Open in Finder" affordances (`shell.openPath`)
 *
 * These render either as "deferred" sections (gray placeholder) or are
 * omitted entirely so the tab stays honest about what works.
 */

import { useCallback } from 'react';
import {
	User,
	Bug,
	Keyboard,
	History,
	Brain,
	Tag,
	ArrowDownToLine,
	SpellCheck,
	Download,
	PartyPopper,
	Cloud,
	FlaskConical,
} from 'lucide-react';
import type { Theme } from '../../../../shared/theme-types';
import { useSettings } from '../../../hooks/useSettings';

export interface GeneralTabProps {
	theme: Theme;
	/** Mirrors the renderer's `isOpen` flag — passed through for future use. */
	isOpen: boolean;
}

type ThinkingMode = 'off' | 'on' | 'sticky';
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Strongly-typed accessors over the generic Settings map. Keep narrowing
 * isolated here so the JSX stays clean.
 */
function readString(s: Record<string, unknown>, key: string, fallback: string): string {
	const v = s[key];
	return typeof v === 'string' ? v : fallback;
}
function readBool(s: Record<string, unknown>, key: string, fallback: boolean): boolean {
	const v = s[key];
	return typeof v === 'boolean' ? v : fallback;
}
function readThinking(s: Record<string, unknown>): ThinkingMode {
	const v = s['defaultShowThinking'];
	return v === 'on' || v === 'sticky' || v === 'off' ? v : 'off';
}
function readLogLevel(s: Record<string, unknown>): LogLevel {
	const v = s['logLevel'];
	return v === 'debug' || v === 'info' || v === 'warn' || v === 'error' ? v : 'info';
}

export function GeneralTab({ theme, isOpen: _isOpen }: GeneralTabProps) {
	const { settings, loading, error, setSetting } = useSettings();

	// Field accessors
	const conductorProfile = readString(settings, 'conductorProfile', '');
	const logLevel = readLogLevel(settings);
	const enterToSendAI = readBool(settings, 'enterToSendAI', false);
	const enterToSendTerminal = readBool(settings, 'enterToSendTerminal', false);
	const defaultSaveToHistory = readBool(settings, 'defaultSaveToHistory', true);
	const defaultShowThinking = readThinking(settings);
	const autoScrollAiMode = readBool(settings, 'autoScrollAiMode', true);
	const spellCheck = readBool(settings, 'spellCheck', false);
	const automaticTabNamingEnabled = readBool(settings, 'automaticTabNamingEnabled', true);
	const checkForUpdatesOnStartup = readBool(settings, 'checkForUpdatesOnStartup', true);
	const enableBetaUpdates = readBool(settings, 'enableBetaUpdates', false);
	const crashReportingEnabled = readBool(settings, 'crashReportingEnabled', true);

	const handleConductorProfileChange = useCallback(
		(v: string) => {
			void setSetting('conductorProfile', v);
		},
		[setSetting]
	);

	if (loading) {
		return (
			<div
				className="text-sm opacity-60 p-4"
				style={{ color: theme.colors.textDim }}
				data-testid="webfull-general-loading"
			>
				Loading settings…
			</div>
		);
	}

	return (
		<div className="space-y-5" data-testid="webfull-general-tab">
			{error && (
				<div
					className="p-3 rounded border text-sm"
					style={{
						borderColor: theme.colors.error,
						color: theme.colors.error,
						backgroundColor: theme.colors.error + '20',
					}}
					data-testid="webfull-general-error"
				>
					{error}
				</div>
			)}

			{/* Conductor Profile (About Me) */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-1 flex items-center gap-2">
					<User className="w-3 h-3" />
					Conductor Profile (aka, About Me)
				</div>
				<p className="text-xs opacity-50 mb-2">
					Tell us a little about yourself so that agents created under Maestro know how to work and
					communicate with you. (Optional, max 1000 characters)
				</p>
				<div className="relative">
					<textarea
						value={conductorProfile}
						onChange={(e) => handleConductorProfileChange(e.target.value)}
						placeholder="e.g., I'm a senior developer working on a React/TypeScript project…"
						className="w-full p-3 rounded border bg-transparent outline-none text-sm resize-none"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							minHeight: '100px',
						}}
						maxLength={1000}
						data-testid="webfull-general-conductor-profile"
					/>
					<div
						className="absolute bottom-2 right-2 text-xs"
						style={{
							color:
								conductorProfile.length > 900 ? theme.colors.warning : theme.colors.textDim,
						}}
					>
						{conductorProfile.length}/1000
					</div>
				</div>
			</div>

			{/* Log Level */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Bug className="w-3 h-3" />
					Log Level
				</div>
				<select
					value={logLevel}
					onChange={(e) => void setSetting('logLevel', e.target.value)}
					className="w-full p-2 rounded border bg-transparent outline-none text-sm"
					style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
					data-testid="webfull-general-log-level"
				>
					<option value="debug">Debug</option>
					<option value="info">Info</option>
					<option value="warn">Warn</option>
					<option value="error">Error</option>
				</select>
				<p className="text-xs opacity-50 mt-1">
					Controls verbosity of server-side logs.
				</p>
			</div>

			{/* Input Behavior — Enter to Send */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Keyboard className="w-3 h-3" />
					Input Behavior
				</div>
				<ToggleRow
					theme={theme}
					testId="webfull-general-enter-to-send-ai"
					label="Enter sends message in AI input"
					description="When enabled, Enter sends the prompt; Shift+Enter inserts a newline. When disabled, the reverse."
					checked={enterToSendAI}
					onChange={(v) => void setSetting('enterToSendAI', v)}
				/>
				<ToggleRow
					theme={theme}
					testId="webfull-general-enter-to-send-terminal"
					label="Enter sends command in terminal input"
					description="Mirrors the AI input behavior for the terminal mode input box."
					checked={enterToSendTerminal}
					onChange={(v) => void setSetting('enterToSendTerminal', v)}
				/>
			</div>

			{/* History default */}
			<ToggleSection
				theme={theme}
				icon={History}
				sectionLabel="Default History Toggle"
				title='Enable "History" by default for new tabs'
				description="When enabled, new AI tabs will have the History toggle on by default."
				checked={defaultSaveToHistory}
				onChange={(v) => void setSetting('defaultSaveToHistory', v)}
				testId="webfull-general-default-history"
			/>

			{/* Default Thinking Mode — three-state */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Brain className="w-3 h-3" />
					Default Thinking Mode
				</div>
				<div
					className="p-3 rounded border"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<div className="font-medium mb-1" style={{ color: theme.colors.textMain }}>
						Show AI thinking / reasoning content for new tabs
					</div>
					<div className="text-sm opacity-60 mb-3" style={{ color: theme.colors.textDim }}>
						{defaultShowThinking === 'off' && 'Thinking hidden, only final responses shown.'}
						{defaultShowThinking === 'on' && 'Thinking streams live, clears on completion.'}
						{defaultShowThinking === 'sticky' && 'Thinking streams live and stays visible.'}
					</div>
					<div className="flex gap-2" data-testid="webfull-general-thinking-mode">
						{(['off', 'on', 'sticky'] as const).map((mode) => (
							<button
								key={mode}
								onClick={() => void setSetting('defaultShowThinking', mode)}
								className="px-3 py-1.5 rounded text-sm capitalize transition-colors"
								style={{
									backgroundColor:
										defaultShowThinking === mode
											? theme.colors.accent
											: 'transparent',
									color:
										defaultShowThinking === mode
											? theme.colors.accentForeground
											: theme.colors.textMain,
									border: `1px solid ${theme.colors.border}`,
								}}
								data-testid={`webfull-general-thinking-${mode}`}
							>
								{mode}
							</button>
						))}
					</div>
				</div>
			</div>

			{/* Auto Tab Naming */}
			<ToggleSection
				theme={theme}
				icon={Tag}
				sectionLabel="Automatic Tab Naming"
				title="Automatically name tabs based on first message"
				description="When you send your first message, an AI generates a descriptive tab name."
				checked={automaticTabNamingEnabled}
				onChange={(v) => void setSetting('automaticTabNamingEnabled', v)}
				testId="webfull-general-auto-tab-naming"
			/>

			{/* Auto-scroll */}
			<ToggleSection
				theme={theme}
				icon={ArrowDownToLine}
				sectionLabel="Auto-scroll AI Output"
				title="Auto-scroll AI output"
				description="Automatically scroll to the bottom when new AI output arrives."
				checked={autoScrollAiMode}
				onChange={(v) => void setSetting('autoScrollAiMode', v)}
				testId="webfull-general-auto-scroll"
			/>

			{/* Spell Check */}
			<ToggleSection
				theme={theme}
				icon={SpellCheck}
				sectionLabel="Spell Check"
				title="Enable spell checking"
				description="Show spell check suggestions in input areas."
				checked={spellCheck}
				onChange={(v) => void setSetting('spellCheck', v)}
				testId="webfull-general-spell-check"
			/>

			{/* Updates */}
			<ToggleSection
				theme={theme}
				icon={Download}
				sectionLabel="Updates"
				title="Check for updates on startup"
				description="Look for new Maestro releases when the app starts."
				checked={checkForUpdatesOnStartup}
				onChange={(v) => void setSetting('checkForUpdatesOnStartup', v)}
				testId="webfull-general-check-updates"
			/>

			{/* Beta channel */}
			<ToggleSection
				theme={theme}
				icon={PartyPopper}
				sectionLabel="Pre-release Updates"
				title="Enable beta updates"
				description="Receive pre-release builds — newer features, less polish."
				checked={enableBetaUpdates}
				onChange={(v) => void setSetting('enableBetaUpdates', v)}
				testId="webfull-general-beta-updates"
			/>

			{/* Crash reporting */}
			<ToggleSection
				theme={theme}
				icon={Bug}
				sectionLabel="Privacy"
				title="Send anonymous crash reports"
				description="Help improve Maestro by sending anonymous crash diagnostics."
				checked={crashReportingEnabled}
				onChange={(v) => void setSetting('crashReportingEnabled', v)}
				testId="webfull-general-crash-reporting"
			/>

			{/* Partial-parity gaps surfaced inline so the user knows what's missing.
			    This is the explicit "do not silently drop features" rule from the brief. */}
			<div
				className="p-3 rounded border text-xs space-y-1"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textDim,
					backgroundColor: theme.colors.bgActivity,
				}}
				data-testid="webfull-general-deferred"
			>
				<div className="font-bold opacity-70 uppercase flex items-center gap-2 mb-1">
					<FlaskConical className="w-3 h-3" />
					Coming in subsequent layers
				</div>
				<div>
					<Cloud className="w-3 h-3 inline mr-1" /> WakaTime status & API-key validation
				</div>
				<div>Sync / storage location picker</div>
				<div>Stats database size, clear, earliest timestamp</div>
				<div>Shell detection &amp; custom shell path / args / env</div>
				<div>Sleep prevention (desktop-only)</div>
				<div>GPU acceleration toggle (Electron-only)</div>
				<div>&quot;Open in Finder&quot; affordances (no browser equivalent)</div>
			</div>
		</div>
	);
}

/* ============ Helper components ============ */

interface ToggleRowProps {
	theme: Theme;
	label: string;
	description?: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	testId?: string;
}

function ToggleRow({ theme, label, description, checked, onChange, testId }: ToggleRowProps) {
	return (
		<div
			className="p-3 rounded border mb-2 cursor-pointer flex items-start justify-between"
			style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			onClick={() => onChange(!checked)}
			role="button"
			tabIndex={0}
			onKeyDown={(e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					onChange(!checked);
				}
			}}
			data-testid={testId}
		>
			<div className="flex-1 pr-3">
				<div className="font-medium text-sm" style={{ color: theme.colors.textMain }}>
					{label}
				</div>
				{description && (
					<div className="text-xs opacity-60 mt-0.5" style={{ color: theme.colors.textDim }}>
						{description}
					</div>
				)}
			</div>
			<input
				type="checkbox"
				checked={checked}
				onChange={(e) => onChange(e.target.checked)}
				onClick={(e) => e.stopPropagation()}
				className="mt-1 cursor-pointer"
				data-testid={testId ? `${testId}-input` : undefined}
				aria-label={label}
			/>
		</div>
	);
}

interface ToggleSectionProps {
	theme: Theme;
	icon: React.ComponentType<{ className?: string }>;
	sectionLabel: string;
	title: string;
	description?: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	testId?: string;
}

function ToggleSection({
	theme,
	icon: Icon,
	sectionLabel,
	title,
	description,
	checked,
	onChange,
	testId,
}: ToggleSectionProps) {
	return (
		<div>
			<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
				<Icon className="w-3 h-3" />
				{sectionLabel}
			</div>
			<ToggleRow
				theme={theme}
				label={title}
				description={description}
				checked={checked}
				onChange={onChange}
				testId={testId}
			/>
		</div>
	);
}

export default GeneralTab;
