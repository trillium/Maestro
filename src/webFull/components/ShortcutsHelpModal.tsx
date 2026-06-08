/**
 * ShortcutsHelpModal
 *
 * Lifted from src/renderer/components/ShortcutsHelpModal.tsx as part of the
 * Layer 2.5 leaf-parade lift wave (audit #5: 216 LOC, 0 IPC, 0 Electron-only
 * APIs). Implementation is verbatim except for the standard L2.4 / L2.5
 * import-path adjustments:
 *
 * - `Theme` previously resolved through the renderer's `src/renderer/types/
 *   index.ts` aggregator. webFull has no `types/` aggregator — `Theme` is
 *   pulled directly from `src/shared/theme-types` (per the L2.1 / L2.3 /
 *   L2.4 / L2.5 sibling precedent).
 * - `Shortcut` and `KeyboardMasteryStats` are not present in `src/shared/` —
 *   they remain in `src/renderer/types/index.ts`. Per the L2.5 precedent set
 *   by DeleteWorktreeModal (which pulls the canonical webFull `Session` type
 *   from `src/webFull/hooks/useSessions` while accepting `Theme` from
 *   `src/shared/theme-types`), we pull these two non-divergent type-only
 *   shapes directly from the renderer aggregator. They are pure data
 *   contracts (`{ id, label, keys }` and `{ usedShortcuts, currentLevel,
 *   lastLevelUpTimestamp, lastAcknowledgedLevel }`); copying them into
 *   `src/shared/` would create a silent-drift surface the audit risk-A
 *   guidance explicitly warns against.
 * - `MODAL_PRIORITIES` resolves via the webFull re-export at
 *   `src/webFull/constants/modalPriorities.ts` (per Architect 2026-06-08
 *   audit risk A — non-divergent constants stay re-exported from renderer
 *   to prevent silent drift).
 * - `FIXED_SHORTCUTS`, `KEYBOARD_MASTERY_LEVELS`, `getLevelForPercentage`,
 *   `fuzzyMatch`, and `formatShortcutKeys` are sourced from the renderer
 *   tree by relative import. Each was audited for Electron-only surfaces:
 *     - `FIXED_SHORTCUTS` (renderer/constants/shortcuts.ts) only `import
 *       type { Shortcut } from '../types'` — type-only, no runtime leak.
 *     - `KEYBOARD_MASTERY_LEVELS` / `getLevelForPercentage`
 *       (renderer/constants/keyboardMastery.ts) only `import type
 *       { KeyboardMasteryLevel } from '../types'` — type-only.
 *     - `fuzzyMatch` (renderer/utils/search.ts) is pure (string ops only).
 *     - `formatShortcutKeys` (renderer/utils/shortcutFormatter.ts)
 *       transitively depends on `isMacOSPlatform()` from
 *       `renderer/utils/platformUtils.ts`, which reads
 *       `window.maestro.platform` (an Electron preload bridge). In a
 *       browser this returns `''` and `isMacOSPlatform()` returns false,
 *       which means webFull would always render the non-Mac key map
 *       (`Ctrl+Shift+K` instead of `⌘ ⇧ K`). The platform-correct path is
 *       to swap to `src/webFull/utils/platformUtils.ts` which sniffs the
 *       user-agent. We therefore import `formatShortcutKeys` from the
 *       renderer source BUT supply our own thin wrapper using webFull's
 *       platform shim so the formatter respects the browser host instead
 *       of leaning on a missing preload. The renderer's formatter is left
 *       untouched (src/renderer/ is read-only); the wrapper lives below.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention,
 * consistent with the L2.1 Modal/FormInput primitives and every Layer 2.4 /
 * 2.5 modal lift to date. Callers in webFull call `const { theme } =
 * useTheme()` at the feature-component level and thread it down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { useState, useRef, useMemo } from 'react';
import { X, Award, CheckCircle, Trophy } from 'lucide-react';
import type { Theme } from '../../shared/theme-types';
import type { Shortcut, KeyboardMasteryStats } from '../../renderer/types';
import { fuzzyMatch } from '../../renderer/utils/search';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { FIXED_SHORTCUTS } from '../../renderer/constants/shortcuts';
import { isMacOSPlatform } from '../utils/platformUtils';
import { Modal } from './ui/Modal';
import {
	KEYBOARD_MASTERY_LEVELS,
	getLevelForPercentage,
} from '../../renderer/constants/keyboardMastery';

// macOS key symbol mappings (mirror of renderer/utils/shortcutFormatter.ts)
const MAC_KEY_MAP: Record<string, string> = {
	Meta: '⌘',
	Alt: '⌥',
	Shift: '⇧',
	Control: '⌃',
	Ctrl: '⌃',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Backspace: '⌫',
	Delete: '⌦',
	Enter: '↩',
	Return: '↩',
	Escape: '⎋',
	Tab: '⇥',
	Space: '␣',
};

// Windows/Linux key mappings
const OTHER_KEY_MAP: Record<string, string> = {
	Meta: 'Ctrl',
	Alt: 'Alt',
	Shift: 'Shift',
	Control: 'Ctrl',
	Ctrl: 'Ctrl',
	ArrowUp: '↑',
	ArrowDown: '↓',
	ArrowLeft: '←',
	ArrowRight: '→',
	Backspace: 'Backspace',
	Delete: 'Delete',
	Enter: 'Enter',
	Return: 'Enter',
	Escape: 'Esc',
	Tab: 'Tab',
	Space: 'Space',
};

/**
 * webFull-native shortcut key formatter.
 *
 * Behaves identically to `formatShortcutKeys` from
 * `src/renderer/utils/shortcutFormatter.ts` but routes platform detection
 * through `src/webFull/utils/platformUtils.ts` (user-agent sniff) instead of
 * the renderer's `window.maestro.platform` preload bridge.
 *
 * Kept private to this module — if a second webFull consumer needs the same
 * formatting, hoist this to `src/webFull/utils/shortcutFormatter.ts` as a
 * sibling-precedent webFull util (like `platformUtils.ts`).
 */
function formatKeyForBrowser(key: string): string {
	const keyMap = isMacOSPlatform() ? MAC_KEY_MAP : OTHER_KEY_MAP;
	if (keyMap[key]) return keyMap[key];
	if (key.length === 1) return key.toUpperCase();
	return key;
}

function formatShortcutKeysForBrowser(keys: string[], separator?: string): string {
	const defaultSeparator = isMacOSPlatform() ? ' ' : '+';
	const sep = separator ?? defaultSeparator;
	return keys.map(formatKeyForBrowser).join(sep);
}

interface ShortcutsHelpModalProps {
	theme: Theme;
	shortcuts: Record<string, Shortcut>;
	tabShortcuts: Record<string, Shortcut>;
	onClose: () => void;
	hasNoAgents?: boolean;
	keyboardMasteryStats?: KeyboardMasteryStats;
}

export function ShortcutsHelpModal({
	theme,
	shortcuts,
	tabShortcuts,
	onClose,
	hasNoAgents,
	keyboardMasteryStats,
}: ShortcutsHelpModalProps) {
	const [searchQuery, setSearchQuery] = useState('');
	const searchInputRef = useRef<HTMLInputElement>(null);

	// Combine all shortcuts for display and mastery tracking
	const allShortcuts = useMemo(
		() => ({
			...shortcuts,
			...tabShortcuts,
			...FIXED_SHORTCUTS,
		}),
		[shortcuts, tabShortcuts]
	);

	const totalShortcuts = Object.values(allShortcuts).length;

	// Calculate mastery progress
	const usedShortcutsCount = keyboardMasteryStats?.usedShortcuts.length ?? 0;
	const masteryPercentage =
		totalShortcuts > 0 ? Math.round((usedShortcutsCount / totalShortcuts) * 100) : 0;
	const currentLevel = keyboardMasteryStats
		? getLevelForPercentage(masteryPercentage)
		: KEYBOARD_MASTERY_LEVELS[0];
	const nextLevel = useMemo(() => {
		return KEYBOARD_MASTERY_LEVELS.find((l) => l.threshold > masteryPercentage);
	}, [masteryPercentage]);
	const usedShortcutIds = new Set(keyboardMasteryStats?.usedShortcuts ?? []);
	const filteredShortcuts = Object.values(allShortcuts)
		.filter((sc) => fuzzyMatch(sc.label, searchQuery) || fuzzyMatch(sc.keys.join(' '), searchQuery))
		.sort((a, b) => a.label.localeCompare(b.label));
	const filteredCount = filteredShortcuts.length;

	// Custom header with title, badge, mastery progress, search input, and close button
	const customHeader = (
		<div className="p-4 border-b" style={{ borderColor: theme.colors.border }}>
			<div className="flex items-center justify-between mb-3">
				<div className="flex items-center gap-2">
					<h2 className="text-sm font-bold" style={{ color: theme.colors.textMain }}>
						Keyboard Shortcuts
					</h2>
					<span
						className="text-xs px-2 py-0.5 rounded"
						style={{ backgroundColor: theme.colors.bgActivity, color: theme.colors.textDim }}
					>
						{searchQuery ? `${filteredCount} / ${totalShortcuts}` : totalShortcuts}
					</span>
				</div>
				<button
					onClick={onClose}
					className="p-1 rounded hover:bg-white/10 transition-colors"
					style={{ color: theme.colors.textDim }}
				>
					<X className="w-4 h-4" />
				</button>
			</div>

			{hasNoAgents && (
				<p
					className="text-xs mb-3 px-2 py-1.5 rounded"
					style={{ backgroundColor: theme.colors.accent + '20', color: theme.colors.accent }}
				>
					Note: Most functionality is unavailable until you've created your first agent.
				</p>
			)}
			<input
				ref={searchInputRef}
				type="text"
				value={searchQuery}
				onChange={(e) => setSearchQuery(e.target.value)}
				placeholder="Search shortcuts..."
				className="w-full px-3 py-2 rounded border bg-transparent outline-none text-sm"
				style={{ borderColor: theme.colors.border, color: theme.colors.textMain }}
			/>
			<p className="text-xs mt-2" style={{ color: theme.colors.textDim }}>
				Many shortcuts can be customized from Settings → Shortcuts.
			</p>
		</div>
	);

	// Footer with mastery progress
	const footer = keyboardMasteryStats ? (
		<div className="w-full space-y-2">
			{/* Keyboard Mastery Progress */}
			<div className="p-2 rounded" style={{ backgroundColor: theme.colors.bgActivity }}>
				<div className="flex items-center justify-between mb-1.5">
					<div className="flex items-center gap-1.5">
						<Award className="w-4 h-4" style={{ color: theme.colors.accent }} />
						<span className="text-xs font-medium" style={{ color: theme.colors.textMain }}>
							{currentLevel.name}
						</span>
					</div>
					<span className="text-xs" style={{ color: theme.colors.textDim }}>
						{usedShortcutsCount} / {totalShortcuts} mastered ({masteryPercentage}%)
					</span>
				</div>
				<div
					className="h-1.5 rounded-full overflow-hidden"
					style={{ backgroundColor: theme.colors.border }}
				>
					<div
						className="h-full rounded-full transition-all duration-300"
						style={{
							width: `${masteryPercentage}%`,
							backgroundColor: theme.colors.accent,
						}}
					/>
				</div>
				{/* Next level hint */}
				{masteryPercentage < 100 && nextLevel && (
					<p className="text-xs mt-1.5" style={{ color: theme.colors.textDim }}>
						{nextLevel.threshold - masteryPercentage}% more to reach {nextLevel.name}
					</p>
				)}
			</div>
			{/* Special 100% completion badge - standalone below the progress box */}
			{masteryPercentage === 100 && (
				<div
					className="flex items-center justify-center gap-2 py-1.5 px-3 rounded-lg"
					style={{
						backgroundColor: `${theme.colors.accent}20`,
						border: `1px solid ${theme.colors.accent}40`,
					}}
				>
					<Trophy className="w-4 h-4" style={{ color: '#FFD700' }} />
					<span className="text-xs font-medium" style={{ color: theme.colors.accent }}>
						Keyboard Maestro - Complete Mastery!
					</span>
					<Trophy className="w-4 h-4" style={{ color: '#FFD700' }} />
				</div>
			)}
		</div>
	) : undefined;

	return (
		<Modal
			theme={theme}
			title="Keyboard Shortcuts"
			priority={MODAL_PRIORITIES.SHORTCUTS_HELP}
			onClose={onClose}
			customHeader={customHeader}
			footer={footer}
			initialFocusRef={searchInputRef}
		>
			<div className="space-y-2 max-h-[400px] overflow-y-auto scrollbar-thin -my-2">
				{filteredShortcuts.map((sc, i) => {
					const isUsed = usedShortcutIds.has(sc.id);
					return (
						<div key={i} className="flex justify-between items-center text-sm gap-2">
							<div className="flex items-center gap-1.5 min-w-0 flex-1">
								{keyboardMasteryStats && (
									<span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
										{isUsed ? (
											<CheckCircle className="w-3.5 h-3.5" style={{ color: theme.colors.accent }} />
										) : (
											<span
												className="w-3 h-3 rounded-full border"
												style={{ borderColor: theme.colors.border }}
											/>
										)}
									</span>
								)}
								<span
									className="truncate"
									style={{ color: isUsed ? theme.colors.textMain : theme.colors.textDim }}
								>
									{sc.label}
								</span>
							</div>
							<kbd
								className="px-2 py-1 rounded border font-mono text-xs font-bold flex-shrink-0"
								style={{
									backgroundColor: theme.colors.bgActivity,
									borderColor: theme.colors.border,
									color: theme.colors.textMain,
								}}
							>
								{formatShortcutKeysForBrowser(sc.keys)}
							</kbd>
						</div>
					);
				})}
				{filteredCount === 0 && (
					<div className="text-center text-sm opacity-50" style={{ color: theme.colors.textDim }}>
						No shortcuts found
					</div>
				)}
			</div>
		</Modal>
	);
}
