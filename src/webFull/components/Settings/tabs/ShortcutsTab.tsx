/**
 * ShortcutsTab — webFull rewrite of renderer ShortcutsTab
 *
 * Layer 3.2 — Settings Shortcuts-tab port. Per the brief, the renderer's
 * `src/renderer/components/Settings/tabs/ShortcutsTab.tsx` is 212 LOC and
 * uses ZERO `window.maestro.*` IPC calls — it reads `shortcuts` /
 * `tabShortcuts` from the settings store and writes back through the same
 * store. The only external surface it touches is the renderer's
 * `formatShortcutKeys` utility (`src/renderer/utils/shortcutFormatter.ts`,
 * a pure function — no IPC).
 *
 * By the lift-vs-rewrite rule (≤1 IPC → safe to lift) this is technically
 * liftable. We REWRITE-WITH-PRIMITIVES anyway for two reasons:
 *   1. Consistency with the Layer 3.x catalog approach (Layer 3.1 General +
 *      this layer's Display already chose the rewrite pattern).
 *   2. `shortcutFormatter.ts` lives in `src/renderer/utils/` and is not
 *      part of the lifted Layer 2.x primitives. Importing it directly
 *      would create a cross-tree dependency the audit specifically warned
 *      against. We inline a minimal formatter here instead — pure
 *      function, no IPC, ~20 lines.
 *
 * Coverage:
 *   - shortcuts                  — Record<id, Shortcut> for general actions
 *   - tabShortcuts               — Record<id, Shortcut> for AI Tab actions
 *   - Live keyboard capture      — browser KeyboardEvent (NOT IPC)
 *   - Filter input               — pure client-side string match
 *   - Recording state            — local useState, escape cancels
 *
 * No deferred features. Renderer's `ShortcutsTab` has a single optional
 * `hasNoAgents` banner prop — we surface the same banner when the same
 * condition is true, but since we read settings only (not session state)
 * we expose `hasNoAgents` as a prop so the parent can pass through.
 *
 * Out of scope (intentional): the renderer's `onRecordingChange` callback
 * threaded up to the SettingsModal so the modal's Escape handler can
 * defer to the recording flow. WebFull's SettingsModal closes on Escape
 * via the `LayerStackProvider`-managed layer stack; the recording escape
 * handler here stops propagation, which prevents the layer stack's
 * onEscape from firing. No extra prop needed.
 */

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Keyboard, Search } from 'lucide-react';
import type { Theme } from '../../../../shared/theme-types';
import { useSettings } from '../../../hooks/useSettings';

export interface ShortcutsTabProps {
	theme: Theme;
	/** Whether the modal is open. Reserved for parity with the General tab. */
	isOpen: boolean;
	/**
	 * When true, render a "Most functionality is unavailable until you've created
	 * your first agent" banner above the filter. Renderer convention.
	 */
	hasNoAgents?: boolean;
}

interface Shortcut {
	id: string;
	label: string;
	keys: string[];
}
interface ShortcutWithCategory extends Shortcut {
	isTabShortcut: boolean;
}

type ShortcutMap = Record<string, Shortcut>;

function readShortcutMap(s: Record<string, unknown>, key: string): ShortcutMap {
	const raw = s[key];
	if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
		const out: ShortcutMap = {};
		for (const [id, val] of Object.entries(raw as Record<string, unknown>)) {
			if (val && typeof val === 'object') {
				const sc = val as { id?: unknown; label?: unknown; keys?: unknown };
				if (
					typeof sc.id === 'string' &&
					typeof sc.label === 'string' &&
					Array.isArray(sc.keys) &&
					sc.keys.every((k) => typeof k === 'string')
				) {
					out[id] = { id: sc.id, label: sc.label, keys: sc.keys as string[] };
				}
			}
		}
		return out;
	}
	return {};
}

/**
 * Minimal platform-aware key formatter. Mirrors the renderer's
 * `formatShortcutKeys` behavior (macOS uses symbols, others use "+").
 * Inlined to avoid a cross-tree import; pure function, no IPC.
 */
function isMac(): boolean {
	return typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);
}

const MAC_SYMBOLS: Record<string, string> = {
	Meta: '⌘',
	Cmd: '⌘',
	Command: '⌘',
	Ctrl: '⌃',
	Control: '⌃',
	Alt: '⌥',
	Option: '⌥',
	Shift: '⇧',
	Enter: '↵',
	Return: '↵',
	Backspace: '⌫',
	Delete: '⌦',
	Tab: '⇥',
	Escape: '⎋',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Space: '␣',
};

function formatKey(key: string): string {
	if (isMac() && MAC_SYMBOLS[key]) return MAC_SYMBOLS[key];
	if (!isMac() && key === 'Meta') return 'Ctrl';
	return key.length === 1 ? key.toUpperCase() : key;
}

function formatShortcutKeys(keys: string[]): string {
	const sep = isMac() ? ' ' : '+';
	return keys.map(formatKey).join(sep);
}

export function ShortcutsTab({ theme, isOpen: _isOpen, hasNoAgents }: ShortcutsTabProps) {
	const { settings, loading, error, setSetting } = useSettings();

	const shortcuts = readShortcutMap(settings, 'shortcuts');
	const tabShortcuts = readShortcutMap(settings, 'tabShortcuts');

	const [recordingId, setRecordingId] = useState<string | null>(null);
	const [shortcutsFilter, setShortcutsFilter] = useState<string>('');
	const filterRef = useRef<HTMLInputElement>(null);

	// Auto-focus filter input on mount
	useEffect(() => {
		const timer = setTimeout(() => filterRef.current?.focus(), 50);
		return () => clearTimeout(timer);
	}, []);

	const handleRecord = (e: ReactKeyboardEvent, actionId: string, isTabShortcut: boolean) => {
		e.preventDefault();
		e.stopPropagation();

		// Escape cancels recording without saving
		if (e.key === 'Escape') {
			setRecordingId(null);
			return;
		}

		const keys: string[] = [];
		if (e.metaKey) keys.push('Meta');
		if (e.ctrlKey) keys.push('Ctrl');
		if (e.altKey) keys.push('Alt');
		if (e.shiftKey) keys.push('Shift');

		// Modifier-only keypress → wait for a real key
		if (['Meta', 'Control', 'Alt', 'Shift'].includes(e.key)) return;

		// On macOS, Alt+letter produces special characters (e.g., Alt+L = ¬).
		// Use e.code to get the physical key name when Alt is pressed.
		let mainKey: string = e.key;
		if (e.altKey && e.code) {
			if (e.code.startsWith('Key')) {
				mainKey = e.code.replace('Key', '').toLowerCase();
			} else if (e.code.startsWith('Digit')) {
				mainKey = e.code.replace('Digit', '');
			}
		}
		keys.push(mainKey);

		const targetKey = isTabShortcut ? 'tabShortcuts' : 'shortcuts';
		const targetMap = isTabShortcut ? tabShortcuts : shortcuts;
		const existing = targetMap[actionId];
		if (!existing) {
			setRecordingId(null);
			return;
		}
		void setSetting(targetKey, {
			...targetMap,
			[actionId]: { ...existing, keys },
		});
		setRecordingId(null);
	};

	const allShortcuts: ShortcutWithCategory[] = [
		...Object.values(shortcuts).map((sc) => ({ ...sc, isTabShortcut: false })),
		...Object.values(tabShortcuts).map((sc) => ({ ...sc, isTabShortcut: true })),
	];
	const totalShortcuts = allShortcuts.length;
	const filtered = allShortcuts.filter((sc) =>
		sc.label.toLowerCase().includes(shortcutsFilter.toLowerCase())
	);
	const filteredCount = filtered.length;
	const generalShortcuts = filtered.filter((sc) => !sc.isTabShortcut);
	const tabShortcutsFiltered = filtered.filter((sc) => sc.isTabShortcut);

	if (loading) {
		return (
			<div
				className="text-sm opacity-60 p-4"
				style={{ color: theme.colors.textDim }}
				data-testid="webfull-shortcuts-loading"
			>
				Loading settings…
			</div>
		);
	}

	const renderShortcutItem = (sc: ShortcutWithCategory) => (
		<div
			key={`${sc.isTabShortcut ? 'tab' : 'gen'}-${sc.id}`}
			className="flex items-center justify-between p-3 rounded border"
			style={{ borderColor: theme.colors.border, backgroundColor: theme.colors.bgMain }}
			data-testid={`webfull-shortcuts-item-${sc.id}`}
		>
			<span className="text-sm font-medium" style={{ color: theme.colors.textMain }}>
				{sc.label}
			</span>
			<button
				onClick={(e) => {
					setRecordingId(sc.id);
					e.currentTarget.focus();
				}}
				onKeyDownCapture={(e) => {
					if (recordingId === sc.id) {
						handleRecord(e, sc.id, sc.isTabShortcut);
					}
				}}
				className={`px-3 py-1.5 rounded border text-xs font-mono min-w-[80px] text-center transition-colors ${
					recordingId === sc.id ? 'ring-2' : ''
				}`}
				style={{
					borderColor:
						recordingId === sc.id ? theme.colors.accent : theme.colors.border,
					backgroundColor:
						recordingId === sc.id ? theme.colors.accentDim : theme.colors.bgActivity,
					color: recordingId === sc.id ? theme.colors.accent : theme.colors.textDim,
				}}
				data-testid={`webfull-shortcuts-record-${sc.id}`}
				aria-label={`Record shortcut for ${sc.label}`}
			>
				{recordingId === sc.id ? 'Press keys…' : formatShortcutKeys(sc.keys)}
			</button>
		</div>
	);

	return (
		<div
			className="flex flex-col"
			style={{ minHeight: '450px' }}
			data-testid="webfull-shortcuts-tab"
		>
			{error && (
				<div
					className="p-3 rounded border text-sm mb-3"
					style={{
						borderColor: theme.colors.error,
						color: theme.colors.error,
						backgroundColor: theme.colors.error + '20',
					}}
					data-testid="webfull-shortcuts-error"
				>
					{error}
				</div>
			)}
			{hasNoAgents && (
				<p
					className="text-xs mb-3 px-2 py-1.5 rounded"
					style={{
						backgroundColor: theme.colors.accent + '20',
						color: theme.colors.accent,
					}}
					data-testid="webfull-shortcuts-no-agents"
				>
					Note: Most functionality is unavailable until you&apos;ve created your first agent.
				</p>
			)}
			<div className="flex items-center gap-2 mb-3">
				<div className="relative flex-1">
					<Search
						className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 opacity-50"
						style={{ color: theme.colors.textDim }}
					/>
					<input
						ref={filterRef}
						type="text"
						value={shortcutsFilter}
						onChange={(e) => setShortcutsFilter(e.target.value)}
						placeholder="Filter shortcuts..."
						className="w-full pl-7 pr-3 py-2 rounded border bg-transparent outline-none text-sm"
						style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
						data-testid="webfull-shortcuts-filter"
					/>
				</div>
				<span
					className="text-xs px-2 py-1.5 rounded font-medium"
					style={{
						backgroundColor: theme.colors.bgActivity,
						color: theme.colors.textDim,
					}}
					data-testid="webfull-shortcuts-count"
				>
					{shortcutsFilter ? `${filteredCount} / ${totalShortcuts}` : totalShortcuts}
				</span>
			</div>
			<p className="text-xs opacity-50 mb-3" style={{ color: theme.colors.textDim }}>
				Not all shortcuts can be modified. Press{' '}
				<kbd
					className="px-1.5 py-0.5 rounded font-mono"
					style={{ backgroundColor: theme.colors.bgActivity }}
				>
					{formatShortcutKeys(['Meta', '/'])}
				</kbd>{' '}
				from the main interface to view the full list of keyboard shortcuts.
			</p>

			{totalShortcuts === 0 && (
				<div
					className="p-4 rounded border text-sm flex items-center gap-2"
					style={{
						borderColor: theme.colors.border,
						backgroundColor: theme.colors.bgMain,
						color: theme.colors.textDim,
					}}
					data-testid="webfull-shortcuts-empty"
				>
					<Keyboard className="w-4 h-4 opacity-60" />
					No customizable shortcuts have been registered yet. Defaults will appear here once the
					server publishes a `shortcuts` settings entry.
				</div>
			)}

			<div className="space-y-4 flex-1 overflow-y-auto pr-2">
				{generalShortcuts.length > 0 && (
					<div data-testid="webfull-shortcuts-section-general">
						<h3
							className="text-xs font-bold uppercase mb-2 px-1"
							style={{ color: theme.colors.textDim }}
						>
							General
						</h3>
						<div className="space-y-2">{generalShortcuts.map(renderShortcutItem)}</div>
					</div>
				)}
				{tabShortcutsFiltered.length > 0 && (
					<div data-testid="webfull-shortcuts-section-aitab">
						<h3
							className="text-xs font-bold uppercase mb-2 px-1"
							style={{ color: theme.colors.textDim }}
						>
							AI Tab
						</h3>
						<div className="space-y-2">{tabShortcutsFiltered.map(renderShortcutItem)}</div>
					</div>
				)}
			</div>
		</div>
	);
}

export default ShortcutsTab;
