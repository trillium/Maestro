/**
 * KeyboardMasteryCelebration
 *
 * Lifted from `src/renderer/components/KeyboardMasteryCelebration.tsx` as part
 * of the Layer 2.5 leaf-parade lift wave. Implementation is verbatim from the
 * renderer source with import-path adjustments only — no behavioral changes,
 * no chrome divergence, no semantic edits.
 *
 * ## Why this lift exists
 *
 * The L2.5 `AppOverlays` dispatcher (`leaf-app-overlays`) landed with the
 * `keyboardMasterySlot` prop deferred — the renderer dispatcher imports
 * `KeyboardMasteryCelebration` directly, but the webFull dispatcher accepts
 * the slot as a `ReactNode` so that the host could supply it once the
 * underlying component was ported. This lift ports the component itself,
 * unblocking the host wiring layer to either pass `<KeyboardMasteryCelebration
 * ... />` directly into `AppOverlays`'s `keyboardMasterySlot` or to keep the
 * render-prop indirection (host's call). Either way, the dispatcher contract
 * is stable; this is the second of the three overlays referenced in
 * `AppOverlays.tsx`'s file header to land in webFull (after
 * `FirstRunCelebration` @ `fd9bc3cf9`), with `StandingOvationOverlay` still
 * deferred for a separate brief on account of its
 * `window.maestro.shell.openExternal` callsite.
 *
 * ## Pre-flight grep
 *
 * `grep -E "window\.maestro\.|from ['\"]electron['\"]"
 * src/renderer/components/KeyboardMasteryCelebration.tsx` → empty (exit 1).
 *
 * The component touches none of the banned surface. All input is via the
 * `KeyboardMasteryCelebrationProps` prop bag (`theme`, `level`, `onClose`,
 * optional `shortcuts`, optional `disableConfetti`); all side effects are
 * the `canvas-confetti` burst on mount + on-close, the layer-stack
 * registration, the `keydown` listener for Enter / Escape dismissal, and
 * the `onClose()` callback the host wires. No IPC, no Electron-only APIs,
 * no `src/main/` touches.
 *
 * ## Import-path adapts (four, all matching L2.5 precedent)
 *
 * - `Theme` from `'../types'` → `'../../shared/theme-types'` (standard L2.5
 *   swap — webFull has no `types/` aggregator that re-exports `Theme`; the
 *   renderer barrel itself routes through `src/renderer/types/index.ts`
 *   which re-exports from `src/shared/theme-types`).
 * - `Shortcut` from `'../types'` → `'../../renderer/types'` directly. The
 *   interface lives in the renderer types barrel only (`src/renderer/types/
 *   index.ts`) and is not yet replicated to `src/shared/`. `Shortcut` is a
 *   pure data shape (no transitive `window.maestro` references). This
 *   matches the L2.5 `ShortcutsHelpModal` / `GroupChatHeader` precedent of
 *   pulling specific types from the canonical renderer aggregator rather
 *   than copying into `src/shared/` (which would create the audit-risk-A
 *   silent-drift surface).
 * - `useLayerStack` from `'../contexts/LayerStackContext'` resolves to the
 *   webFull-side context at `src/webFull/contexts/LayerStackContext.tsx`
 *   (lifted in L2.1). Same path string — different module under webFull's
 *   tsconfig.
 * - `MODAL_PRIORITIES` from `'../constants/modalPriorities'` resolves via
 *   the webFull re-export at `src/webFull/constants/modalPriorities.ts`
 *   (per Architect 2026-06-08 audit risk A — non-divergent constants stay
 *   re-exported from renderer to prevent silent drift). Uses
 *   `MODAL_PRIORITIES.KEYBOARD_MASTERY` (1095) as in the renderer source.
 * - `KEYBOARD_MASTERY_LEVELS` from `'../constants/keyboardMastery'` →
 *   `'../../renderer/constants/keyboardMastery'`. The constants module is
 *   pure data (zero IPC, zero Electron API surface — the level definitions
 *   `{ id, name, threshold, description }`). Matches the L2.5
 *   `ShortcutsHelpModal` precedent of pulling non-divergent renderer
 *   constants directly by relative path rather than duplicating into
 *   `src/shared/`.
 * - `DEFAULT_SHORTCUTS` from `'../constants/shortcuts'` →
 *   `'../../renderer/constants/shortcuts'`. Same rationale — pure data
 *   module (shortcut key arrays + metadata), zero IPC at module load. Used
 *   as the fallback when the optional `shortcuts` prop is not supplied.
 * - `isMacOSPlatform` from `'../utils/platformUtils'` → `'../utils/
 *   platformUtils'` (resolves to the webFull-side shim at
 *   `src/webFull/utils/platformUtils.ts` which uses `navigator.userAgent`
 *   instead of the renderer's `window.maestro.platform` preload bridge).
 *   This is the same platform-detection divergence the L2.5
 *   `shortcutFormatter` shim handles for other lifts. The component's
 *   local `formatShortcutKeys` helper is preserved verbatim from the
 *   renderer source — it takes `(keys: string[], isMac: boolean)` and
 *   joins without a separator (e.g. `['Meta', '/']` → `'⌘/'`), which is a
 *   different signature from the webFull `shortcutFormatter` shim's
 *   `formatShortcutKeys(keys, separator?)`. Keeping the helper local
 *   preserves source fidelity — the renderer uses this no-separator form
 *   intentionally for the shortcut hint copy ("Press ⌘/ to see all
 *   shortcuts").
 *
 * ## Composition shape
 *
 * Large celebration modal — does NOT compose the L2.1 `Modal` primitive
 * directly because the renderer source builds bespoke DOM chrome (dark
 * backdrop, gradient header glow, animated bouncing icon, level-progress
 * dot row, music-themed confetti palette with per-level intensity scaling,
 * gradient dismiss button, level-specific message swap between
 * `Keyboard` + `Level Up!` for levels 0-3 and `Trophy` + `Keyboard
 * Maestro!` for level 4). Layer-stack registration uses
 * `MODAL_PRIORITIES.KEYBOARD_MASTERY` (1095, just below
 * `STANDING_OVATION` at 1100) with `focusTrap: 'strict'` and routes
 * Escape to `handleClose()`.
 *
 * ## Confetti behavior preserved verbatim
 *
 * The renderer's per-level `confettiIntensity` table (50 / 100 / 200 / 300
 * / 500 particles for levels 0-4) is preserved as-is. The Maestro variant
 * (`level === 4`) fires an extra delayed 100-particle star burst at 300ms
 * after mount. All confetti calls honour `prefers-reduced-motion` AND the
 * `disableConfetti` prop. Confetti `zIndex` stays at 99998 (between the
 * backdrop at 99997 and the modal at 99999). All timeouts are tracked in
 * `timeoutsRef` and cleared on unmount to avoid leaking timers.
 *
 * ## What this lift is NOT
 *
 * - Not a feature-wiring change. `src/webFull/App.tsx` is untouched —
 *   feature wiring into the webFull tree is a downstream-layer concern.
 *   When the host wires this into `AppOverlays`'s `keyboardMasterySlot`,
 *   the data source (current mastery level transition) needs to come from
 *   either a webFull-side modal store, REST-backed `useSettings()`, or
 *   prop drilling at the App root — same dispatcher contract the
 *   `AppOverlays` lift documented.
 * - Not a lift of `useSettingsStore` or `useModalStore` — the renderer
 *   uses these to source `shortcuts` and `disableConfetti`; here both are
 *   plain props per the L2.5 prop-promotion pattern.
 * - Not a divergence from the renderer's behavior — every confetti burst,
 *   every animation timing, every aria-label, every text string is
 *   verbatim. Future host-driven copy edits go through the renderer
 *   source first to keep parity.
 *
 * 0 IPC, 0 Electron-only APIs, 0 `src/main/` touches, 0 `src/renderer/`
 * edits, 0 `src/web/` edits, 0 `src/server/` edits.
 */

import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { Keyboard, Trophy, Sparkles } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Theme } from '../../shared/theme-types';
import type { Shortcut } from '../../renderer/types';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { KEYBOARD_MASTERY_LEVELS } from '../../renderer/constants/keyboardMastery';
import { DEFAULT_SHORTCUTS } from '../../renderer/constants/shortcuts';
import { isMacOSPlatform } from '../utils/platformUtils';

interface KeyboardMasteryCelebrationProps {
	theme: Theme;
	level: number; // 0-4 (Beginner, Student, Performer, Virtuoso, Maestro)
	onClose: () => void;
	shortcuts?: Record<string, Shortcut>;
	/** Whether confetti animations are disabled by user preference */
	disableConfetti?: boolean;
}

// Music-themed colors
const goldColor = '#FFD700';
const musicPurple = '#9B59B6';

// Different confetti intensities per level
const confettiIntensity: Record<number, { particleCount: number; spread: number }> = {
	0: { particleCount: 50, spread: 50 }, // Beginner
	1: { particleCount: 100, spread: 60 }, // Student
	2: { particleCount: 200, spread: 80 }, // Performer
	3: { particleCount: 300, spread: 100 }, // Virtuoso
	4: { particleCount: 500, spread: 120 }, // Maestro - big celebration!
};

// Z-index layering: backdrop (99997) < confetti (99998) < modal (99999)
const CONFETTI_Z_INDEX = 99998;

/**
 * KeyboardMasteryCelebration - Modal celebrating the user reaching a new mastery level
 */
/**
 * Format shortcut keys for display (e.g., ['Meta', '/'] -> '⌘/')
 */
function formatShortcutKeys(keys: string[], isMac: boolean): string {
	return keys
		.map((key) => {
			if (key === 'Meta') return isMac ? '⌘' : 'Ctrl';
			if (key === 'Alt') return isMac ? '⌥' : 'Alt';
			if (key === 'Shift') return '⇧';
			if (key === 'Control') return isMac ? '⌃' : 'Ctrl';
			return key;
		})
		.join('');
}

export function KeyboardMasteryCelebration({
	theme,
	level,
	onClose,
	shortcuts,
	disableConfetti = false,
}: KeyboardMasteryCelebrationProps): JSX.Element {
	const containerRef = useRef<HTMLDivElement>(null);
	const { registerLayer, unregisterLayer } = useLayerStack();
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Use ref for isClosing to avoid race conditions and stale closures
	const isClosingRef = useRef(false);
	const [isClosing, setIsClosing] = useState(false);

	// Track active timeouts for cleanup
	const timeoutsRef = useRef<NodeJS.Timeout[]>([]);

	// Determine level info
	const levelInfo = KEYBOARD_MASTERY_LEVELS[level] || KEYBOARD_MASTERY_LEVELS[0];
	const isMaestro = level === 4;

	// Get help shortcut for display
	const isMac = isMacOSPlatform();
	const helpShortcut = useMemo(() => {
		const activeShortcuts = shortcuts || DEFAULT_SHORTCUTS;
		const helpKeys = activeShortcuts.help?.keys || ['Meta', '/'];
		return formatShortcutKeys(helpKeys, isMac);
	}, [shortcuts, isMac]);

	// Fire confetti burst - returns timeout ID for cleanup
	const fireConfetti = useCallback(() => {
		// Skip if disabled by user preference
		if (disableConfetti) return;

		// Check for reduced motion preference
		const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
		if (prefersReducedMotion) return;

		const intensity = confettiIntensity[level] || confettiIntensity[0];

		// Musical note-inspired colors
		const colors = isMaestro
			? ['#FFD700', '#FFA500', '#9B59B6', '#E91E63', '#00BCD4'] // Gold-heavy for Maestro
			: ['#9B59B6', '#E91E63', '#00BCD4', '#4CAF50', '#FF9800']; // Purple-heavy for others

		confetti({
			particleCount: intensity.particleCount,
			spread: intensity.spread,
			origin: { x: 0.5, y: 0.6 },
			colors,
			shapes: ['circle', 'star'] as ('circle' | 'star')[],
			scalar: 1.2,
			zIndex: CONFETTI_Z_INDEX,
			disableForReducedMotion: true,
		});

		// Extra burst for Maestro - track timeout for cleanup
		if (isMaestro) {
			const burstTimeout = setTimeout(() => {
				confetti({
					particleCount: 100,
					spread: 360,
					origin: { x: 0.5, y: 0.4 },
					colors: [goldColor],
					shapes: ['star'] as 'star'[],
					scalar: 1.5,
					zIndex: CONFETTI_Z_INDEX,
					disableForReducedMotion: true,
				});
			}, 300);
			timeoutsRef.current.push(burstTimeout);
		}
	}, [level, isMaestro, disableConfetti]);

	// Fire confetti on mount with cleanup
	useEffect(() => {
		fireConfetti();
		return () => {
			// Clear all tracked timeouts on unmount
			timeoutsRef.current.forEach(clearTimeout);
			timeoutsRef.current = [];
		};
	}, []);

	// Handle close with confetti - use ref to avoid stale state
	const handleClose = useCallback(() => {
		if (isClosingRef.current) return;
		isClosingRef.current = true;
		setIsClosing(true);

		// Fire closing confetti
		fireConfetti();

		// Wait then close - track timeout for cleanup
		const closeTimeout = setTimeout(() => {
			onCloseRef.current();
		}, 800);
		timeoutsRef.current.push(closeTimeout);
	}, [fireConfetti]);

	// Stable ref for handleClose to avoid re-attaching keyboard listener
	const handleCloseRef = useRef(handleClose);
	handleCloseRef.current = handleClose;

	// Handle keyboard events - use ref to avoid stale closure
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === 'Enter' || e.key === 'Escape') {
				e.preventDefault();
				handleCloseRef.current();
			}
		};

		window.addEventListener('keydown', handleKeyDown);
		return () => window.removeEventListener('keydown', handleKeyDown);
	}, []); // Empty deps - handler reads from ref

	// Register with layer stack
	useEffect(() => {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.KEYBOARD_MASTERY,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Keyboard Mastery Level Up Celebration',
			onEscape: () => handleCloseRef.current(),
		});

		containerRef.current?.focus();

		return () => {
			unregisterLayer(id);
		};
	}, [registerLayer, unregisterLayer]);

	// Get next level info for encouragement message
	const nextLevel =
		level < KEYBOARD_MASTERY_LEVELS.length - 1 ? KEYBOARD_MASTERY_LEVELS[level + 1] : null;

	return (
		<>
			{/* Backdrop */}
			<div
				className="fixed inset-0 z-[99997] animate-in fade-in duration-300"
				onClick={handleClose}
				style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
			/>

			{/* Modal */}
			<div
				ref={containerRef}
				className="fixed inset-0 flex items-center justify-center z-[99999] pointer-events-none p-4"
				role="dialog"
				aria-modal="true"
				aria-label="Keyboard Mastery Level Up"
				tabIndex={-1}
			>
				<div
					className={`relative max-w-md w-full rounded-2xl shadow-2xl overflow-hidden transition-all duration-300 pointer-events-auto ${
						isClosing ? 'opacity-0 scale-95' : 'animate-in zoom-in-95'
					}`}
					onClick={(e) => e.stopPropagation()}
					style={{
						backgroundColor: theme.colors.bgSidebar,
						border: `2px solid ${isMaestro ? goldColor : musicPurple}`,
						boxShadow: `0 0 40px ${isMaestro ? goldColor : musicPurple}40`,
					}}
				>
					{/* Header */}
					<div
						className="relative px-6 pt-6 pb-4 text-center"
						style={{
							background: `linear-gradient(180deg, ${isMaestro ? goldColor : musicPurple}20 0%, transparent 100%)`,
						}}
					>
						{/* Icon */}
						<div className="flex justify-center mb-4">
							<div
								className="relative p-4 rounded-full animate-bounce"
								style={{
									background: isMaestro
										? `linear-gradient(135deg, ${goldColor} 0%, #FFA500 100%)`
										: `linear-gradient(135deg, ${musicPurple} 0%, #E91E63 100%)`,
									boxShadow: `0 0 30px ${isMaestro ? goldColor : musicPurple}60`,
								}}
							>
								{isMaestro ? (
									<Trophy className="w-8 h-8 text-white" />
								) : (
									<Keyboard className="w-8 h-8 text-white" />
								)}
							</div>
						</div>

						{/* Title */}
						<h1
							className="text-2xl font-bold mb-1"
							style={{
								color: isMaestro ? goldColor : theme.colors.textMain,
								textShadow: isMaestro ? `0 0 20px ${goldColor}60` : undefined,
							}}
						>
							{isMaestro ? 'Keyboard Maestro!' : 'Level Up!'}
						</h1>

						<p className="text-lg" style={{ color: theme.colors.textMain }}>
							You've reached{' '}
							<span style={{ color: isMaestro ? goldColor : musicPurple, fontWeight: 600 }}>
								{isMaestro ? 'the highest level' : levelInfo.name}
							</span>
						</p>
					</div>

					{/* Content */}
					<div className="px-6 pb-6">
						{/* Level description */}
						<div
							className="flex items-center justify-center gap-2 p-3 rounded-lg mb-4"
							style={{ backgroundColor: theme.colors.bgActivity }}
						>
							<Sparkles className="w-4 h-4" style={{ color: musicPurple }} />
							<span className="text-sm" style={{ color: theme.colors.textDim }}>
								{levelInfo.description}
							</span>
						</div>

						{/* Progress indicator */}
						<div className="flex items-center justify-center gap-1 mb-4">
							{KEYBOARD_MASTERY_LEVELS.map((l, i) => (
								<div
									key={l.id}
									className="w-8 h-1.5 rounded-full transition-colors"
									style={{
										backgroundColor:
											i <= level ? (i === 4 ? goldColor : musicPurple) : theme.colors.border,
									}}
								/>
							))}
						</div>

						{/* Encouragement message */}
						<p className="text-xs text-center mb-2" style={{ color: theme.colors.textDim }}>
							{isMaestro
								? "You've mastered all keyboard shortcuts!"
								: `Keep using shortcuts to reach ${nextLevel?.name || 'the next level'}!`}
						</p>

						{/* Shortcut hint */}
						<p className="text-xs text-center mb-4" style={{ color: theme.colors.textDim }}>
							Press{' '}
							<span
								className="font-mono px-1.5 py-0.5 rounded"
								style={{ backgroundColor: theme.colors.bgActivity }}
							>
								{helpShortcut}
							</span>{' '}
							to see all shortcuts and your progress
						</p>

						{/* Close button */}
						<button
							onClick={handleClose}
							disabled={isClosing}
							className="w-full py-2.5 rounded-lg font-medium transition-all hover:scale-[1.02] disabled:opacity-70"
							style={{
								background: isMaestro
									? `linear-gradient(135deg, ${musicPurple} 0%, ${goldColor} 100%)`
									: `linear-gradient(135deg, ${musicPurple} 0%, #E91E63 100%)`,
								color: '#FFFFFF',
								boxShadow: `0 4px 20px ${musicPurple}40`,
							}}
						>
							{isClosing ? 'Onwards!' : 'Continue'}
						</button>

						<p className="text-xs text-center mt-3" style={{ color: theme.colors.textDim }}>
							Press Enter or Escape to dismiss
						</p>
					</div>
				</div>
			</div>
		</>
	);
}

export default KeyboardMasteryCelebration;
