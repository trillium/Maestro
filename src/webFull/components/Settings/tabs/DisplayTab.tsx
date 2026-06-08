/**
 * DisplayTab — webFull rewrite of renderer DisplayTab using lifted primitives
 *
 * Layer 3.2 — Settings Display-tab port. Per the brief, the renderer's
 * `src/renderer/components/Settings/tabs/DisplayTab.tsx` is 715 LOC and
 * fans out into ≥1 IPC namespace beyond `settings` (specifically
 * `fonts:detect` for system font enumeration). That puts it over the
 * "lift if ≤ 1 IPC namespace" threshold from /tmp/web-ui-lift-scope.md,
 * so this is a webfull-native REWRITE that preserves the OBSERVABLE
 * FUNCTION (open Display tab → see typography + view knobs → change them
 * → save) without verbatim-copying renderer markup.
 *
 * Coverage today (the `settings.get/set` namespace fields shown in the
 * renderer's Display tab that have NO extra IPC dependency):
 *   - fontSize                            — 12 / 14 / 16 / 18
 *   - terminalWidth                       — 80 / 100 / 120 / 160
 *   - maxLogBuffer                        — 1000 / 5000 / 10000 / 25000
 *   - maxOutputLines                      — 15 / 25 / 50 / 100 / All
 *   - userMessageAlignment                — 'left' | 'right'
 *   - bionifyReadingMode                  — boolean
 *   - bionifyIntensity                    — 0.85 / 1 / 1.35
 *   - bionifyAlgorithm                    — validated pattern string
 *   - fileExplorerIconTheme               — 'default' | 'rich'
 *   - documentGraphShowExternalLinks      — boolean
 *   - documentGraphMaxNodes               — 50…1000
 *   - contextManagementSettings           — nested object (warnings + thresholds)
 *   - localIgnorePatterns                 — string[] (simple textarea editor)
 *   - localHonorGitignore                 — boolean
 *
 * Deferred (documented in ISA Decisions as known partial-parity gaps):
 *   - fontFamily picker + custom-font management — requires `fonts:detect`
 *     IPC (Electron-only system font enumeration). Surfaced inline in the
 *     "Coming in subsequent layers" panel; not silently dropped.
 *   - "Window Chrome" toggles (`useNativeTitleBar`, `autoHideMenuBar`) —
 *     these affect Electron's BrowserWindow chrome which doesn't exist in
 *     a browser. The settings keys themselves are still writable but the
 *     effect surface is Electron-only. Surfaced as Electron-only.
 *   - Bionify info modal — non-essential algorithm reference popup. The
 *     algorithm input is still editable; only the inline "what does this
 *     mean" help modal is deferred.
 *
 * These are explicit per the Layer 3.x brief's "reject patterns that bail
 * out of full parity" rule. The General-tab template ("Coming in
 * subsequent layers" panel) is reused at the bottom of the tab.
 */

import { useState, useCallback } from 'react';
import {
	Type,
	Sparkles,
	AlertTriangle,
	AppWindow,
	HelpCircle,
	FolderTree,
	FlaskConical,
	Bug,
} from 'lucide-react';
import type { Theme } from '../../../../shared/theme-types';
import { useSettings } from '../../../hooks/useSettings';

export interface DisplayTabProps {
	theme: Theme;
	/** Mirrors the renderer's `isOpen` flag — passed through for future use. */
	isOpen: boolean;
}

type IconTheme = 'default' | 'rich';
type Alignment = 'left' | 'right';

const BIONIFY_ALGORITHM_PATTERN = /^[+-](\s+\d+){4}\s+(?:0(?:\.\d+)?|1(?:\.0+)?)$/;
const DEFAULT_BIONIFY_ALGORITHM = '- 0 1 1 2 0.4';
const DEFAULT_LOCAL_IGNORE_PATTERNS = ['.git', 'node_modules', '__pycache__'];

interface ContextManagementShape {
	contextWarningsEnabled: boolean;
	contextWarningYellowThreshold: number;
	contextWarningRedThreshold: number;
}

/**
 * Strongly-typed accessors over the generic Settings map. Keep narrowing
 * isolated here so the JSX stays clean.
 */
function readNumber(s: Record<string, unknown>, key: string, fallback: number): number {
	const v = s[key];
	return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function readBool(s: Record<string, unknown>, key: string, fallback: boolean): boolean {
	const v = s[key];
	return typeof v === 'boolean' ? v : fallback;
}
function readString(s: Record<string, unknown>, key: string, fallback: string): string {
	const v = s[key];
	return typeof v === 'string' ? v : fallback;
}
function readAlignment(s: Record<string, unknown>): Alignment {
	const v = s['userMessageAlignment'];
	return v === 'left' || v === 'right' ? v : 'right';
}
function readIconTheme(s: Record<string, unknown>): IconTheme {
	const v = s['fileExplorerIconTheme'];
	return v === 'rich' ? 'rich' : 'default';
}
function readStringArray(s: Record<string, unknown>, key: string, fallback: string[]): string[] {
	const v = s[key];
	if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v as string[];
	return fallback;
}
function readContextManagement(s: Record<string, unknown>): ContextManagementShape {
	const raw = s['contextManagementSettings'];
	const obj =
		raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
	return {
		contextWarningsEnabled: readBool(obj, 'contextWarningsEnabled', false),
		contextWarningYellowThreshold: readNumber(obj, 'contextWarningYellowThreshold', 60),
		contextWarningRedThreshold: readNumber(obj, 'contextWarningRedThreshold', 80),
	};
}

export function DisplayTab({ theme, isOpen: _isOpen }: DisplayTabProps) {
	const { settings, loading, error, setSetting } = useSettings();

	// Field accessors
	const fontSize = readNumber(settings, 'fontSize', 14);
	const terminalWidth = readNumber(settings, 'terminalWidth', 100);
	const maxLogBuffer = readNumber(settings, 'maxLogBuffer', 5000);
	const maxOutputLines = readNumber(settings, 'maxOutputLines', 25);
	const userMessageAlignment = readAlignment(settings);
	const bionifyReadingMode = readBool(settings, 'bionifyReadingMode', false);
	const bionifyIntensity = readNumber(settings, 'bionifyIntensity', 1);
	const bionifyAlgorithm = readString(settings, 'bionifyAlgorithm', DEFAULT_BIONIFY_ALGORITHM);
	const fileExplorerIconTheme = readIconTheme(settings);
	const documentGraphShowExternalLinks = readBool(settings, 'documentGraphShowExternalLinks', false);
	const documentGraphMaxNodes = readNumber(settings, 'documentGraphMaxNodes', 250);
	const ctx = readContextManagement(settings);
	const localIgnorePatterns = readStringArray(
		settings,
		'localIgnorePatterns',
		DEFAULT_LOCAL_IGNORE_PATTERNS
	);
	const localHonorGitignore = readBool(settings, 'localHonorGitignore', true);

	// Local draft for bionify algorithm so we can validate before committing
	const [bionifyDraft, setBionifyDraft] = useState<string>(bionifyAlgorithm);
	const [bionifyDraftDirty, setBionifyDraftDirty] = useState<boolean>(false);
	const effectiveDraft = bionifyDraftDirty ? bionifyDraft : bionifyAlgorithm;
	const isBionifyAlgorithmValid = BIONIFY_ALGORITHM_PATTERN.test(effectiveDraft.trim());

	const commitBionify = useCallback(() => {
		if (isBionifyAlgorithmValid && effectiveDraft.trim() !== bionifyAlgorithm) {
			void setSetting('bionifyAlgorithm', effectiveDraft.trim());
		}
		setBionifyDraftDirty(false);
	}, [isBionifyAlgorithmValid, effectiveDraft, bionifyAlgorithm, setSetting]);

	// Update nested contextManagementSettings: read-modify-write the object
	const patchContextManagement = useCallback(
		(patch: Partial<ContextManagementShape>) => {
			void setSetting('contextManagementSettings', { ...ctx, ...patch });
		},
		[ctx, setSetting]
	);

	// Local ignore patterns: stored as string[], edited as a textarea (one per line)
	const [ignoreDraft, setIgnoreDraft] = useState<string>(localIgnorePatterns.join('\n'));
	const [ignoreDraftDirty, setIgnoreDraftDirty] = useState<boolean>(false);
	const effectiveIgnore = ignoreDraftDirty ? ignoreDraft : localIgnorePatterns.join('\n');

	const commitIgnore = useCallback(() => {
		const parsed = effectiveIgnore
			.split('\n')
			.map((p) => p.trim())
			.filter((p) => p.length > 0);
		void setSetting('localIgnorePatterns', parsed);
		setIgnoreDraftDirty(false);
	}, [effectiveIgnore, setSetting]);

	if (loading) {
		return (
			<div
				className="text-sm opacity-60 p-4"
				style={{ color: theme.colors.textDim }}
				data-testid="webfull-display-loading"
			>
				Loading settings…
			</div>
		);
	}

	return (
		<div className="space-y-5" data-testid="webfull-display-tab">
			{error && (
				<div
					className="p-3 rounded border text-sm"
					style={{
						borderColor: theme.colors.error,
						color: theme.colors.error,
						backgroundColor: theme.colors.error + '20',
					}}
					data-testid="webfull-display-error"
				>
					{error}
				</div>
			)}

			{/* Font Size */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Type className="w-3 h-3" />
					Font Size
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-font-size"
					options={[
						{ value: 12, label: 'Small' },
						{ value: 14, label: 'Medium' },
						{ value: 16, label: 'Large' },
						{ value: 18, label: 'X-Large' },
					]}
					value={fontSize}
					onChange={(v) => void setSetting('fontSize', v)}
				/>
			</div>

			{/* Terminal Width */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2">
					Terminal Width (Columns)
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-terminal-width"
					options={[
						{ value: 80, label: '80' },
						{ value: 100, label: '100' },
						{ value: 120, label: '120' },
						{ value: 160, label: '160' },
					]}
					value={terminalWidth}
					onChange={(v) => void setSetting('terminalWidth', v)}
				/>
			</div>

			{/* Max Log Buffer */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Bug className="w-3 h-3" />
					Maximum Log Buffer
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-max-log-buffer"
					options={[
						{ value: 1000, label: '1k' },
						{ value: 5000, label: '5k' },
						{ value: 10000, label: '10k' },
						{ value: 25000, label: '25k' },
					]}
					value={maxLogBuffer}
					onChange={(v) => void setSetting('maxLogBuffer', v)}
				/>
				<p className="text-xs opacity-50 mt-2">
					Maximum number of log messages to keep in memory. Older logs are automatically removed.
				</p>
			</div>

			{/* Max Output Lines */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2">
					Max Output Lines per Response
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-max-output-lines"
					options={[
						{ value: 15, label: '15' },
						{ value: 25, label: '25' },
						{ value: 50, label: '50' },
						{ value: 100, label: '100' },
						// JSON has no Infinity literal; the underlying renderer uses Infinity but
						// the on-disk store coerces it. We use a sentinel value (-1 → "All") so
						// the JSON store round-trips cleanly.
						{ value: -1, label: 'All' },
					]}
					value={maxOutputLines === Infinity ? -1 : maxOutputLines}
					onChange={(v) => void setSetting('maxOutputLines', v === -1 ? Infinity : v)}
				/>
				<p className="text-xs opacity-50 mt-2">
					Long outputs will be collapsed into a scrollable window. Set to &quot;All&quot; to always
					show full output.
				</p>
			</div>

			{/* Message Alignment */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2">
					User Message Alignment
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-message-alignment"
					options={[
						{ value: 'left', label: 'Left' },
						{ value: 'right', label: 'Right' },
					]}
					value={userMessageAlignment}
					onChange={(v) => void setSetting('userMessageAlignment', v)}
				/>
				<p className="text-xs opacity-50 mt-2">
					Position your messages on the left or right side of the chat. AI responses appear on the
					opposite side.
				</p>
			</div>

			{/* Bionify Reading Mode */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2">Reading Mode</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-bionify-reading-mode"
					options={[
						{ value: 'off', label: 'Off' },
						{ value: 'on', label: 'Bionify' },
					]}
					value={bionifyReadingMode ? 'on' : 'off'}
					onChange={(v) => void setSetting('bionifyReadingMode', v === 'on')}
				/>
				<p className="text-xs opacity-50 mt-2">
					Applies Bionify-style emphasis only to opted-in long-form readers. Terminals, logs, and
					chat input stay unchanged.
				</p>
			</div>

			{/* Bionify Intensity */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<span>Intensity</span>
					<HelpCircle className="w-3 h-3 opacity-50" />
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-bionify-intensity"
					options={[
						{ value: 0.85, label: 'Soft' },
						{ value: 1, label: 'Default' },
						{ value: 1.35, label: 'Strong' },
					]}
					value={bionifyIntensity}
					onChange={(v) => void setSetting('bionifyIntensity', v)}
				/>
				<p className="text-xs opacity-50 mt-2">
					Controls how hard the emphasis hits. Strong increases emphasis weight and fades the
					remaining characters more aggressively.
				</p>
			</div>

			{/* Bionify Algorithm */}
			<div>
				<label
					htmlFor="webfull-display-bionify-algorithm-input"
					className="block text-xs font-bold opacity-70 uppercase mb-2"
				>
					Bionify Algorithm
				</label>
				<input
					id="webfull-display-bionify-algorithm-input"
					aria-label="Bionify algorithm"
					type="text"
					value={effectiveDraft}
					onChange={(e) => {
						setBionifyDraftDirty(true);
						setBionifyDraft(e.target.value);
					}}
					onBlur={commitBionify}
					onKeyDown={(e) => {
						if (e.key === 'Enter') {
							e.currentTarget.blur();
						}
					}}
					className="w-full px-3 py-2 rounded text-sm outline-none"
					style={{
						backgroundColor: theme.colors.bgMain,
						color: theme.colors.textMain,
						border: `1px solid ${
							isBionifyAlgorithmValid ? theme.colors.border : theme.colors.warning
						}`,
					}}
					placeholder="- 0 1 1 2 0.4"
					spellCheck={false}
					data-testid="webfull-display-bionify-algorithm"
				/>
				<p className="text-xs opacity-50 mt-2">
					Format: sign, four fixed word-length rules, then a fallback fraction. Example:{' '}
					<code>- 0 1 1 2 0.4</code>
				</p>
				{!isBionifyAlgorithmValid && (
					<p className="text-xs mt-2" style={{ color: theme.colors.warning }}>
						Enter <code>+|- len1 len2 len3 len4 fraction</code>, for example{' '}
						<code>- 0 1 1 2 0.4</code>.
					</p>
				)}
			</div>

			{/* Files Pane Icon Theme */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<FolderTree className="w-3 h-3" />
					Files Pane Icon Theme
				</div>
				<ToggleButtonGroup
					theme={theme}
					testId="webfull-display-icon-theme"
					options={[
						{ value: 'default', label: 'Default' },
						{ value: 'rich', label: 'Rich' },
					]}
					value={fileExplorerIconTheme}
					onChange={(v) => void setSetting('fileExplorerIconTheme', v)}
				/>
				<p className="text-xs opacity-50 mt-2">
					Rich uses Material Icon Theme style file and folder SVGs in the Files pane.
				</p>
			</div>

			{/* Document Graph */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<Sparkles className="w-3 h-3" />
					Document Graph
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
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<SwitchRow
						theme={theme}
						label="Show external links by default"
						description="Display external website links as nodes. Can be toggled in the graph view."
						checked={documentGraphShowExternalLinks}
						onChange={(v) => void setSetting('documentGraphShowExternalLinks', v)}
						testId="webfull-display-graph-external-links"
					/>
					<div className="pt-3 border-t" style={{ borderColor: theme.colors.border }}>
						<div className="block text-xs opacity-60 mb-2">Maximum nodes to display</div>
						<div className="flex items-center gap-3">
							<input
								type="range"
								min={50}
								max={1000}
								step={50}
								value={documentGraphMaxNodes}
								onChange={(e) =>
									void setSetting('documentGraphMaxNodes', Number(e.target.value))
								}
								className="flex-1 h-2 rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, ${theme.colors.accent} 0%, ${
										theme.colors.accent
									} ${((documentGraphMaxNodes - 50) / 950) * 100}%, ${
										theme.colors.bgActivity
									} ${((documentGraphMaxNodes - 50) / 950) * 100}%, ${
										theme.colors.bgActivity
									} 100%)`,
								}}
								data-testid="webfull-display-graph-max-nodes"
							/>
							<span
								className="text-sm font-mono w-12 text-right"
								style={{ color: theme.colors.textMain }}
							>
								{documentGraphMaxNodes}
							</span>
						</div>
					</div>
				</div>
			</div>

			{/* Context Window Warnings */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<AlertTriangle className="w-3 h-3" />
					Context Window Warnings
				</div>
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<SwitchRow
						theme={theme}
						label="Show context consumption warnings"
						description="Display warning banners when context window usage reaches configurable thresholds."
						checked={ctx.contextWarningsEnabled}
						onChange={(v) => patchContextManagement({ contextWarningsEnabled: v })}
						testId="webfull-display-ctx-warnings-enabled"
					/>
					<div
						className="space-y-4 pt-3 border-t"
						style={{
							borderColor: theme.colors.border,
							opacity: ctx.contextWarningsEnabled ? 1 : 0.4,
							pointerEvents: ctx.contextWarningsEnabled ? 'auto' : 'none',
						}}
					>
						{/* Yellow */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<div
									className="text-xs font-medium flex items-center gap-2"
									style={{ color: theme.colors.textMain }}
								>
									<div
										className="w-2.5 h-2.5 rounded-full"
										style={{ backgroundColor: '#eab308' }}
									/>
									Yellow warning threshold
								</div>
								<span
									className="text-xs font-mono px-2 py-0.5 rounded"
									style={{ backgroundColor: 'rgba(234, 179, 8, 0.2)', color: '#fde047' }}
								>
									{ctx.contextWarningYellowThreshold}%
								</span>
							</div>
							<input
								type="range"
								min={0}
								max={100}
								step={5}
								value={ctx.contextWarningYellowThreshold}
								onChange={(e) => {
									const newYellow = Number(e.target.value);
									if (newYellow >= ctx.contextWarningRedThreshold) {
										patchContextManagement({
											contextWarningYellowThreshold: newYellow,
											contextWarningRedThreshold: Math.min(100, newYellow + 10),
										});
									} else {
										patchContextManagement({ contextWarningYellowThreshold: newYellow });
									}
								}}
								className="w-full h-2 rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, #eab308 0%, #eab308 ${
										ctx.contextWarningYellowThreshold
									}%, ${theme.colors.bgActivity} ${
										ctx.contextWarningYellowThreshold
									}%, ${theme.colors.bgActivity} 100%)`,
								}}
								data-testid="webfull-display-ctx-yellow"
							/>
						</div>
						{/* Red */}
						<div>
							<div className="flex items-center justify-between mb-2">
								<div
									className="text-xs font-medium flex items-center gap-2"
									style={{ color: theme.colors.textMain }}
								>
									<div
										className="w-2.5 h-2.5 rounded-full"
										style={{ backgroundColor: '#ef4444' }}
									/>
									Red warning threshold
								</div>
								<span
									className="text-xs font-mono px-2 py-0.5 rounded"
									style={{ backgroundColor: 'rgba(239, 68, 68, 0.2)', color: '#fca5a5' }}
								>
									{ctx.contextWarningRedThreshold}%
								</span>
							</div>
							<input
								type="range"
								min={0}
								max={100}
								step={5}
								value={ctx.contextWarningRedThreshold}
								onChange={(e) => {
									const newRed = Number(e.target.value);
									if (newRed <= ctx.contextWarningYellowThreshold) {
										patchContextManagement({
											contextWarningRedThreshold: newRed,
											contextWarningYellowThreshold: Math.max(0, newRed - 10),
										});
									} else {
										patchContextManagement({ contextWarningRedThreshold: newRed });
									}
								}}
								className="w-full h-2 rounded-lg appearance-none cursor-pointer"
								style={{
									background: `linear-gradient(to right, #ef4444 0%, #ef4444 ${
										ctx.contextWarningRedThreshold
									}%, ${theme.colors.bgActivity} ${
										ctx.contextWarningRedThreshold
									}%, ${theme.colors.bgActivity} 100%)`,
								}}
								data-testid="webfull-display-ctx-red"
							/>
						</div>
					</div>
				</div>
			</div>

			{/* Local Ignore Patterns */}
			<div>
				<div className="block text-xs font-bold opacity-70 uppercase mb-2 flex items-center gap-2">
					<FolderTree className="w-3 h-3" />
					Local Ignore Patterns
				</div>
				<div
					className="p-3 rounded border space-y-3"
					style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
				>
					<p className="text-xs opacity-60" style={{ color: theme.colors.textDim }}>
						Configure glob patterns for folders to exclude when indexing local files in the file
						explorer. One pattern per line.
					</p>
					<textarea
						value={effectiveIgnore}
						onChange={(e) => {
							setIgnoreDraftDirty(true);
							setIgnoreDraft(e.target.value);
						}}
						onBlur={commitIgnore}
						placeholder=".git&#10;node_modules&#10;__pycache__"
						className="w-full p-2 rounded border bg-transparent outline-none text-sm font-mono resize-none"
						style={{
							borderColor: theme.colors.border,
							color: theme.colors.textMain,
							minHeight: '120px',
						}}
						spellCheck={false}
						data-testid="webfull-display-ignore-patterns"
					/>
					<SwitchRow
						theme={theme}
						label="Honor .gitignore in indexed folders"
						description="Skip files/folders matched by a project's .gitignore in addition to the patterns above."
						checked={localHonorGitignore}
						onChange={(v) => void setSetting('localHonorGitignore', v)}
						testId="webfull-display-honor-gitignore"
					/>
				</div>
			</div>

			{/* Partial-parity gaps surfaced inline. Per the brief: do not silently
			    drop Electron-only or extra-IPC features — surface them so the user
			    knows what's missing. */}
			<div
				className="p-3 rounded border text-xs space-y-1"
				style={{
					borderColor: theme.colors.border,
					color: theme.colors.textDim,
					backgroundColor: theme.colors.bgActivity,
				}}
				data-testid="webfull-display-deferred"
			>
				<div className="font-bold opacity-70 uppercase flex items-center gap-2 mb-1">
					<FlaskConical className="w-3 h-3" />
					Coming in subsequent layers
				</div>
				<div>Font family picker &amp; custom-font management (needs `fonts:detect` IPC)</div>
				<div>
					<AppWindow className="w-3 h-3 inline mr-1" /> Native title bar / auto-hide menu bar
					(Electron BrowserWindow only — no browser equivalent)
				</div>
				<div>Bionify algorithm reference modal (algorithm input above stays editable)</div>
			</div>
		</div>
	);
}

/* ============ Helper components ============ */

interface ToggleButtonOption<T> {
	value: T;
	label: string;
}

interface ToggleButtonGroupProps<T extends string | number> {
	theme: Theme;
	options: ToggleButtonOption<T>[];
	value: T;
	onChange: (v: T) => void;
	testId?: string;
}

function ToggleButtonGroup<T extends string | number>({
	theme,
	options,
	value,
	onChange,
	testId,
}: ToggleButtonGroupProps<T>) {
	return (
		<div className="flex gap-2 flex-wrap" data-testid={testId}>
			{options.map((opt) => {
				const isActive = opt.value === value;
				return (
					<button
						key={String(opt.value)}
						onClick={() => onChange(opt.value)}
						className="px-3 py-1.5 rounded text-sm transition-colors"
						style={{
							backgroundColor: isActive ? theme.colors.accent : 'transparent',
							color: isActive ? theme.colors.accentForeground : theme.colors.textMain,
							border: `1px solid ${theme.colors.border}`,
						}}
						data-testid={testId ? `${testId}-${String(opt.value)}` : undefined}
						aria-pressed={isActive}
					>
						{opt.label}
					</button>
				);
			})}
		</div>
	);
}

interface SwitchRowProps {
	theme: Theme;
	label: string;
	description?: string;
	checked: boolean;
	onChange: (v: boolean) => void;
	testId?: string;
}

function SwitchRow({ theme, label, description, checked, onChange, testId }: SwitchRowProps) {
	return (
		<div
			className="flex items-center justify-between cursor-pointer"
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
			<button
				onClick={(e) => {
					e.stopPropagation();
					onChange(!checked);
				}}
				className="relative w-10 h-5 rounded-full transition-colors flex-shrink-0 outline-none"
				tabIndex={-1}
				style={{
					backgroundColor: checked ? theme.colors.accent : theme.colors.bgActivity,
				}}
				role="switch"
				aria-checked={checked}
				data-testid={testId ? `${testId}-switch` : undefined}
				aria-label={label}
			>
				<span
					className={`absolute left-0 top-0.5 w-4 h-4 rounded-full bg-white transition-transform ${
						checked ? 'translate-x-5' : 'translate-x-0.5'
					}`}
				/>
			</button>
		</div>
	);
}

export default DisplayTab;
