/**
 * StandingOvationOverlay
 *
 * Lifted from `src/renderer/components/StandingOvationOverlay.tsx` (654 LOC)
 * as part of the Layer 2.5 leaf-parade lift wave. Closes ISC-44.layer-2.5
 * .standing_ovation_overlay and — per the `AppOverlays` lift header
 * (`leaf-app-overlays`) — closes the LAST deferred slot in AppOverlays'
 * three-overlay surface. Two prior siblings landed earlier on 2026-06-08:
 *   - `FirstRunCelebration` @ `fd9bc3cf9` (ISC-44.layer-2.5.first_run_celebration)
 *   - `KeyboardMasteryCelebration` (ISC-44.layer-2.5.keyboard_mastery_celebration)
 * This lift makes all three slots simultaneously available in webFull, so the
 * downstream host wiring layer can plumb the dispatcher end-to-end without
 * any remaining cross-fork imports.
 *
 * ## Pre-flight grep
 *
 * `grep -nE "window\.maestro\.|from ['"]electron['"]|shell\.openExternal
 * |shell\.openPath|ipcRenderer" src/renderer/components/StandingOvationOverlay.tsx`
 * → one hit at line 498 (the badge external-link click handler — see
 * "Audit decision: openExternal → window.open swap" below). Audit #9 from
 * the Architect's leaf-parade review classified this hit as
 * event-handler-deferred (NOT module-load); the dispatcher's MarkdownRenderer
 * precedent documents this same lambda-deferred IPC class and accepts it
 * verbatim. This lift makes a different call — see swap rationale.
 *
 * ## Audit decision: `openExternal → window.open` swap
 *
 * The renderer source carries one `window.maestro.shell.openExternal` call
 * at line 498, inside the `onClick` handler for the "Learn more on
 * Wikipedia" anchor under the Example Maestro card. The call is
 * event-handler-deferred (the IPC bridge is only touched when a user clicks
 * the badge's external-link affordance — not at module load, not in a
 * useEffect body, not during render). The brief's pre-flight notes the
 * audit specifically calls out that this site uses the `window.open(url,
 * '_blank')` swap pattern established by the `MarkdownRenderer` lift's file
 * header (which catalogues — but preserves verbatim — three lambda-deferred
 * `window.maestro.shell.*` calls, and explicitly names `window.open(href)`
 * as the swap downstream consumers can use).
 *
 * This lift does the swap inline rather than preserving the renderer call
 * verbatim. Rationale:
 *
 *   - The webFull bundle's runtime has no `window.maestro` preload bridge —
 *     the renderer call would throw `TypeError: Cannot read properties of
 *     undefined (reading 'shell')` on first click, with no catch handler.
 *     The renderer-source verbatim path is "preserve and let the host wire
 *     a fallback later," which means the LAST deferred slot in AppOverlays
 *     would carry a known-broken click handler into production. The swap
 *     pattern fixes the failure mode without changing semantics — both
 *     paths "open external URL in a new browser context" — and matches how
 *     a standard web app would handle a Wikipedia link affordance.
 *
 *   - `window.open(url, '_blank', 'noopener,noreferrer')` is the
 *     security-hardened form documented in OWASP / MDN: `noopener` prevents
 *     the opened page from accessing `window.opener` (and from running
 *     reverse-tabnabbing attacks against the host); `noreferrer` further
 *     suppresses the HTTP Referer header. Both flags are appropriate for
 *     external content links and match the form a hand-written browser
 *     anchor `target="_blank" rel="noopener noreferrer"` produces.
 *
 *   - The audit notes this is the ONE site the swap pattern applies to —
 *     no other `window.maestro` call exists in this component (verified by
 *     pre-flight grep returning exactly one match).
 *
 * The semantic contract preserved: clicking the external-link button on the
 * Example Maestro card opens the badge's `wikipediaUrl` in a new browser
 * context. The Electron renderer surfaces this via the OS shell handler
 * (`shell.openExternal`); webFull surfaces it via the browser's native
 * popup-window API. Both round-trip to "render the URL in a separate
 * top-level browser context."
 *
 * ## Import-path adapts (matching established L2.5 precedent)
 *
 * - `Theme`, `ThemeMode` from `'../types'` → `'../../shared/theme-types'`
 *   (standard L2.5 swap — webFull has no `types/` aggregator that
 *   re-exports the theme types; the renderer aggregator routes through
 *   `src/renderer/types/index.ts` which re-exports from
 *   `src/shared/theme-types`; webFull pulls directly from canonical).
 * - `ConductorBadge`, `formatCumulativeTime`, `formatTimeRemaining`,
 *   `getNextBadge` from `'../constants/conductorBadges'` →
 *   `'../../renderer/constants/conductorBadges'`. The constants module is
 *   pure data + pure helpers (zero IPC, zero Electron-only API per
 *   pre-flight grep against the renderer source), matching the L2.5
 *   `AppOverlays` precedent of pulling the badge module directly by
 *   relative path rather than duplicating into `src/shared/` (which would
 *   create the audit-risk-A silent-drift surface).
 * - `useLayerStack` from `'../contexts/LayerStackContext'` resolves to the
 *   webFull-side context at `src/webFull/contexts/LayerStackContext.tsx`
 *   (lifted in L2.1). Same path string — different module under webFull's
 *   tsconfig.
 * - `MODAL_PRIORITIES` from `'../constants/modalPriorities'` resolves via
 *   the webFull re-export at `src/webFull/constants/modalPriorities.ts`
 *   (per Architect 2026-06-08 audit risk A — non-divergent constants stay
 *   re-exported from renderer to prevent silent drift). Uses
 *   `MODAL_PRIORITIES.STANDING_OVATION` (1100, top tier) as in the
 *   renderer source.
 * - `AnimatedMaestro` from `'./MaestroSilhouette'` resolves to the
 *   webFull-side L2.5 `MaestroSilhouette` lift (closed at
 *   ISC-44.layer-2.5.maestro_silhouette). Same path string — different
 *   module under webFull's tsconfig.
 * - `safeClipboardWriteBlob` from `'../utils/clipboard'` resolves to the
 *   webFull-side L2.5 clipboard util at `src/webFull/utils/clipboard.ts`
 *   (closed at ISC-44.layer-2.5.clipboard_util). The webFull version is
 *   pure `navigator.clipboard.write` (no IPC) — the renderer source's
 *   `safeClipboardWriteBlob` is the same surface; the difference matters
 *   only for `safeClipboardWrite` (the renderer version routes through
 *   `window.maestro.shell.copyImageToClipboard` for data-URLs but neither
 *   variant is referenced from this component).
 *
 * ## Composition shape (preserved verbatim from renderer source)
 *
 * Large celebration modal — does NOT compose the L2.1 `Modal` primitive
 * because the renderer source builds bespoke DOM chrome: dark backdrop at
 * z-index 99997, confetti at z-index 99998, modal at z-index 99999 (gold
 * border, scaled-in zoom transition, gradient header glow, animated
 * bouncing Trophy icon, animated maestro silhouette with drop-shadow
 * filter, level + badge name display, flavor-text italic copy, Example
 * Maestro card with name / era / achievement / Wikipedia external-link
 * button, two-column stats grid, optional Next-level info row, primary
 * Take-a-Bow gradient button, Share Achievement secondary button with
 * pop-up share menu (Copy to Clipboard + Save as Image), optional Join
 * Global Leaderboard CTA when both `onOpenLeaderboardRegistration` is
 * provided AND `isLeaderboardRegistered` is falsy). Layer-stack
 * registration uses `MODAL_PRIORITIES.STANDING_OVATION` (1100, top tier)
 * with `focusTrap: 'strict'` and routes Escape to `handleTakeABow()`.
 *
 * ## Confetti behavior (preserved verbatim)
 *
 * Confetti fires on mount (3-burst: center, left, right, all from y=1) and
 * on close (same 3-burst), using a 500-particle 91-degree spread with
 * `disableForReducedMotion: true` and an 8-colour palette. `zIndex` stays
 * at 99998 (between backdrop and modal). All confetti calls honour
 * `prefers-reduced-motion` AND the `disableConfetti` prop.
 *
 * ## Canvas share image generation (preserved verbatim)
 *
 * `generateShareImage()` synthesises a 600x400 PNG card using `Canvas2D`:
 * theme-aware background gradient (rgba-stripped via `ensureSolidColor`),
 * gold border + header gradient + trophy circle, "STANDING OVATION" title,
 * achievement-type sub-line, level badge row, badge name, flavor text
 * (word-wrapped via the local `wrapText` helper), two-column stats box,
 * and footer branding. Output is consumed by `copyToClipboard` (via
 * `canvas.toBlob` + `ClipboardItem({ 'image/png': blob })` through the
 * webFull-side `safeClipboardWriteBlob` shim) and by `downloadImage` (via
 * `canvas.toDataURL('image/png')` + a synthetic anchor click). Both paths
 * are pure browser APIs — no IPC required.
 *
 * ## Theme access pattern: keeps the renderer's `theme: Theme` prop
 * convention, matching every L2.1 / L2.3 / L2.4 / L2.5 sibling lift.
 *
 * Closes ISC-44.layer-2.5.standing_ovation_overlay.
 */
import React, { useEffect, useRef, useState, useCallback } from 'react';
import { ExternalLink, Trophy, Clock, Star, Share2, Copy, Download, Check } from 'lucide-react';
import confetti from 'canvas-confetti';
import type { Theme, ThemeMode } from '../../shared/theme-types';
import type { ConductorBadge } from '../../renderer/constants/conductorBadges';
import { useLayerStack } from '../contexts/LayerStackContext';
import { MODAL_PRIORITIES } from '../constants/modalPriorities';
import { AnimatedMaestro } from './MaestroSilhouette';
import {
	formatCumulativeTime,
	formatTimeRemaining,
	getNextBadge,
} from '../../renderer/constants/conductorBadges';
import { safeClipboardWriteBlob } from '../utils/clipboard';

interface StandingOvationOverlayProps {
	theme: Theme;
	themeMode: ThemeMode;
	badge: ConductorBadge;
	isNewRecord?: boolean;
	recordTimeMs?: number;
	cumulativeTimeMs: number;
	onClose: () => void;
	onOpenLeaderboardRegistration?: () => void;
	isLeaderboardRegistered?: boolean;
	/** Whether confetti animations are disabled by user preference */
	disableConfetti?: boolean;
}

/**
 * Full-screen celebration overlay for badge unlocks and new records
 * Features animated maestro, confetti-like effects, and badge information
 */
export function StandingOvationOverlay({
	theme,
	themeMode,
	badge,
	isNewRecord = false,
	recordTimeMs,
	cumulativeTimeMs,
	onClose,
	onOpenLeaderboardRegistration,
	isLeaderboardRegistered,
	disableConfetti = false,
}: StandingOvationOverlayProps) {
	const { registerLayer, unregisterLayer, updateLayerHandler } = useLayerStack();
	const layerIdRef = useRef<string>();
	const containerRef = useRef<HTMLDivElement>(null);
	const onCloseRef = useRef(onClose);
	onCloseRef.current = onClose;

	// Ref for the close handler that includes confetti animation
	const handleCloseRef = useRef<() => void>(onClose);

	// State
	const nextBadge = getNextBadge(badge);
	const isDark = themeMode === 'dark';
	const maestroVariant = isDark ? 'light' : 'dark';
	const [shareMenuOpen, setShareMenuOpen] = useState(false);
	const [copySuccess, setCopySuccess] = useState(false);
	const [isClosing, setIsClosing] = useState(false);

	// Accent colors
	const goldColor = '#FFD700';
	const purpleAccent = theme.colors.accent;

	// Confetti colors from playground
	const confettiColors = React.useMemo(
		() => [
			'#FFD700', // Gold
			'#FF6B6B', // Red
			'#4ECDC4', // Teal
			'#45B7D1', // Blue
			'#FFA726', // Orange
			'#BA68C8', // Purple
			'#F48FB1', // Pink
			'#FFEAA7', // Yellow
		],
		[]
	);

	// Z-index layering: backdrop (99997) < confetti (99998) < modal (99999)
	const CONFETTI_Z_INDEX = 99998;

	// Fire confetti from multiple origins with playground settings
	const fireConfetti = useCallback(() => {
		// Skip if disabled by user preference
		if (disableConfetti) return;

		const defaults = {
			particleCount: 500,
			angle: 90,
			spread: 91,
			startVelocity: 74,
			gravity: 0.8,
			decay: 0.9,
			drift: 1.5,
			scalar: 1.2,
			ticks: 355,
			flat: false,
			shapes: ['circle', 'star', 'square'] as ('circle' | 'star' | 'square')[],
			colors: confettiColors,
			zIndex: CONFETTI_Z_INDEX,
			disableForReducedMotion: true,
		};

		// Center burst
		confetti({
			...defaults,
			origin: { x: 0.5, y: 1 },
		});

		// Left burst
		confetti({
			...defaults,
			origin: { x: 0, y: 1 },
		});

		// Right burst
		confetti({
			...defaults,
			origin: { x: 1, y: 1 },
		});
	}, [confettiColors, disableConfetti]);

	// Fire confetti on mount only - empty deps to run once
	useEffect(() => {
		fireConfetti();
	}, []);

	// Handle graceful close with confetti
	const handleTakeABow = useCallback(() => {
		if (isClosing) return;
		setIsClosing(true);

		// Fire closing confetti burst
		fireConfetti();

		// Wait for confetti animation then close
		setTimeout(() => {
			onClose();
		}, 1500);
	}, [isClosing, onClose, fireConfetti]);

	// Register with layer stack
	useEffect(() => {
		const id = registerLayer({
			type: 'modal',
			priority: MODAL_PRIORITIES.STANDING_OVATION,
			blocksLowerLayers: true,
			capturesFocus: true,
			focusTrap: 'strict',
			ariaLabel: 'Standing Ovation Achievement',
			onEscape: () => handleCloseRef.current(),
		});
		layerIdRef.current = id;

		containerRef.current?.focus();

		return () => {
			if (layerIdRef.current) {
				unregisterLayer(layerIdRef.current);
			}
		};
	}, [registerLayer, unregisterLayer]);

	// Update close handler ref when handleTakeABow changes
	useEffect(() => {
		handleCloseRef.current = handleTakeABow;
	}, [handleTakeABow]);

	useEffect(() => {
		if (layerIdRef.current) {
			updateLayerHandler(layerIdRef.current, () => handleCloseRef.current());
		}
	}, [updateLayerHandler]);

	// Generate shareable achievement card as canvas using theme colors
	const generateShareImage = useCallback(async (): Promise<HTMLCanvasElement> => {
		const canvas = document.createElement('canvas');
		const ctx = canvas.getContext('2d')!;

		// Card dimensions
		const width = 600;
		const height = 400;
		canvas.width = width;
		canvas.height = height;

		// Helper to ensure solid color (strip alpha if present, default to fallback)
		const ensureSolidColor = (color: string, fallback: string): string => {
			if (!color || color === 'transparent') return fallback;
			// Handle rgba - extract rgb and ignore alpha
			if (color.startsWith('rgba')) {
				const match = color.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
				if (match) {
					return `rgb(${match[1]}, ${match[2]}, ${match[3]})`;
				}
			}
			return color;
		};

		// Theme-aware colors
		const bgColor = ensureSolidColor(theme.colors.bgSidebar, '#1a1a2e');
		const bgSecondary = ensureSolidColor(theme.colors.bgActivity, '#16213e');
		const textMain = ensureSolidColor(theme.colors.textMain, '#FFFFFF');
		const textDim = ensureSolidColor(theme.colors.textDim, '#AAAAAA');
		const borderColor = ensureSolidColor(theme.colors.border, '#333333');

		// Background gradient using theme colors
		const bgGradient = ctx.createLinearGradient(0, 0, width, height);
		bgGradient.addColorStop(0, bgColor);
		bgGradient.addColorStop(1, bgSecondary);
		ctx.fillStyle = bgGradient;
		ctx.roundRect(0, 0, width, height, 16);
		ctx.fill();

		// Border
		ctx.strokeStyle = goldColor;
		ctx.lineWidth = 3;
		ctx.roundRect(0, 0, width, height, 16);
		ctx.stroke();

		// Header accent
		const headerGradient = ctx.createLinearGradient(0, 0, width, 100);
		headerGradient.addColorStop(0, `${purpleAccent}40`);
		headerGradient.addColorStop(1, 'transparent');
		ctx.fillStyle = headerGradient;
		ctx.fillRect(0, 0, width, 100);

		// Trophy icon (simplified circle)
		ctx.beginPath();
		ctx.arc(width / 2, 60, 30, 0, Math.PI * 2);
		const trophyGradient = ctx.createRadialGradient(width / 2, 60, 0, width / 2, 60, 30);
		trophyGradient.addColorStop(0, '#FFA500');
		trophyGradient.addColorStop(1, goldColor);
		ctx.fillStyle = trophyGradient;
		ctx.fill();

		// Trophy text
		ctx.fillStyle = textMain;
		ctx.font = 'bold 28px system-ui';
		ctx.textAlign = 'center';
		ctx.fillText('🏆', width / 2, 70);

		// "Standing Ovation" title
		ctx.font = 'bold 24px system-ui';
		ctx.fillStyle = goldColor;
		ctx.textAlign = 'center';
		ctx.fillText('STANDING OVATION', width / 2, 120);

		// Achievement type
		ctx.font = '16px system-ui';
		ctx.fillStyle = textMain;
		ctx.fillText(isNewRecord ? 'New Personal Record!' : 'Achievement Unlocked!', width / 2, 145);

		// Level badge
		ctx.font = 'bold 18px system-ui';
		ctx.fillStyle = goldColor;
		ctx.fillText(`⭐ Level ${badge.level} ⭐`, width / 2, 180);

		// Badge name
		ctx.font = 'bold 28px system-ui';
		ctx.fillStyle = purpleAccent;
		ctx.fillText(badge.name, width / 2, 215);

		// Flavor text
		ctx.font = 'italic 14px system-ui';
		ctx.fillStyle = textDim;
		const flavorLines = wrapText(ctx, `"${badge.flavorText}"`, width - 80);
		let yOffset = 250;
		flavorLines.forEach((line) => {
			ctx.fillText(line, width / 2, yOffset);
			yOffset += 18;
		});

		// Stats box with theme border
		const statsY = 300;
		ctx.fillStyle = bgSecondary;
		ctx.beginPath();
		ctx.roundRect(50, statsY - 10, width - 100, 50, 8);
		ctx.fill();
		ctx.strokeStyle = borderColor;
		ctx.lineWidth = 1;
		ctx.stroke();

		ctx.font = '14px system-ui';
		ctx.fillStyle = textDim;
		ctx.textAlign = 'left';
		ctx.fillText('Total AutoRun:', 70, statsY + 15);
		ctx.fillStyle = textMain;
		ctx.font = 'bold 14px system-ui';
		ctx.fillText(formatCumulativeTime(cumulativeTimeMs), 180, statsY + 15);

		if (recordTimeMs) {
			ctx.fillStyle = textDim;
			ctx.font = '14px system-ui';
			ctx.textAlign = 'left';
			ctx.fillText('Longest Run:', 350, statsY + 15);
			ctx.fillStyle = isNewRecord ? goldColor : textMain;
			ctx.font = 'bold 14px system-ui';
			ctx.fillText(formatCumulativeTime(recordTimeMs), 450, statsY + 15);
		}

		// Footer branding
		ctx.font = 'bold 12px system-ui';
		ctx.fillStyle = textDim;
		ctx.textAlign = 'center';
		ctx.fillText('MAESTRO • Agent Orchestration Command Center', width / 2, height - 20);

		return canvas;
	}, [badge, cumulativeTimeMs, recordTimeMs, isNewRecord, purpleAccent, theme.colors]);

	// Helper to wrap text
	const wrapText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] => {
		const words = text.split(' ');
		const lines: string[] = [];
		let currentLine = '';

		words.forEach((word) => {
			const testLine = currentLine ? `${currentLine} ${word}` : word;
			const metrics = ctx.measureText(testLine);
			if (metrics.width > maxWidth && currentLine) {
				lines.push(currentLine);
				currentLine = word;
			} else {
				currentLine = testLine;
			}
		});
		lines.push(currentLine);
		return lines.filter(Boolean);
	};

	// Copy to clipboard
	const copyToClipboard = useCallback(async () => {
		try {
			const canvas = await generateShareImage();
			const blob = await new Promise<Blob | null>((resolve) => {
				canvas.toBlob((b) => resolve(b), 'image/png');
			});
			if (blob) {
				const ok = await safeClipboardWriteBlob([new ClipboardItem({ 'image/png': blob })]);
				if (ok) {
					setCopySuccess(true);
					setTimeout(() => setCopySuccess(false), 2000);
				}
			}
		} catch (error) {
			// Canvas/image generation errors — not clipboard
			console.error('Failed to generate share image:', error);
		}
	}, [generateShareImage]);

	// Download as image
	const downloadImage = useCallback(async () => {
		try {
			const canvas = await generateShareImage();
			const link = document.createElement('a');
			link.download = `maestro-achievement-level-${badge.level}.png`;
			link.href = canvas.toDataURL('image/png');
			link.click();
		} catch (error) {
			console.error('Failed to download image:', error);
		}
	}, [generateShareImage, badge.level]);

	return (
		<>
			{/* Dark backdrop - lowest layer (z-index 99997) */}
			<div
				className="fixed inset-0 z-[99997] animate-in fade-in duration-500"
				onClick={handleTakeABow}
				style={{
					backgroundColor: 'rgba(0, 0, 0, 0.85)',
				}}
			/>

			{/* Confetti renders at z-index 99998 (set in fireConfetti) */}

			{/* Modal container - highest layer (z-index 99999) */}
			<div
				ref={containerRef}
				className="fixed inset-0 flex items-center justify-center z-[99999] pointer-events-none p-4"
				role="dialog"
				aria-modal="true"
				aria-label="Standing Ovation Achievement"
				tabIndex={-1}
			>
				{/* Main content card */}
				<div
					className={`relative max-w-lg w-full rounded-2xl shadow-2xl overflow-y-auto transition-all duration-500 pointer-events-auto ${
						isClosing ? 'opacity-0 scale-95' : 'animate-in zoom-in-95'
					}`}
					onClick={(e) => e.stopPropagation()}
					style={{
						backgroundColor: theme.colors.bgSidebar,
						border: `2px solid ${goldColor}`,
						boxShadow: `0 0 40px rgba(0, 0, 0, 0.5)`,
						maxHeight: 'calc(100vh - 2rem)',
					}}
				>
					{/* Header with glow */}
					<div
						className="relative px-8 pt-8 pb-4 text-center"
						style={{
							background: `linear-gradient(180deg, ${purpleAccent}20 0%, transparent 100%)`,
						}}
					>
						{/* Trophy icon */}
						<div className="flex justify-center mb-4">
							<div
								className="relative p-4 rounded-full animate-bounce"
								style={{
									background: `linear-gradient(135deg, ${goldColor} 0%, #FFA500 100%)`,
									boxShadow: `0 0 30px ${goldColor}60`,
								}}
							>
								<Trophy className="w-10 h-10 text-white" />
							</div>
						</div>

						{/* Title */}
						<h1
							className="text-3xl font-bold tracking-wider mb-2"
							style={{
								color: goldColor,
								textShadow: `0 0 20px ${goldColor}60`,
							}}
						>
							STANDING OVATION
						</h1>

						<p className="text-lg" style={{ color: theme.colors.textMain }}>
							{isNewRecord ? 'New Personal Record!' : 'Achievement Unlocked!'}
						</p>
					</div>

					{/* Maestro silhouette */}
					<div className="flex justify-center py-4">
						<div
							className="relative"
							style={{
								filter: `drop-shadow(0 0 20px ${purpleAccent}60)`,
							}}
						>
							<AnimatedMaestro variant={maestroVariant} size={160} />
						</div>
					</div>

					{/* Badge info */}
					<div className="px-8 pb-6 text-center">
						{/* Badge name */}
						<div className="flex items-center justify-center gap-2 mb-2">
							<Star className="w-5 h-5" style={{ color: goldColor }} />
							<span className="text-xl font-bold" style={{ color: theme.colors.textMain }}>
								Level {badge.level}
							</span>
							<Star className="w-5 h-5" style={{ color: goldColor }} />
						</div>

						<h2 className="text-2xl font-bold mb-3" style={{ color: purpleAccent }}>
							{badge.name}
						</h2>

						<p className="text-sm mb-4 leading-relaxed" style={{ color: theme.colors.textDim }}>
							{badge.description}
						</p>

						{/* Flavor text */}
						<p
							className="text-sm italic mb-4"
							style={{ color: theme.colors.textMain, opacity: 0.8 }}
						>
							"{badge.flavorText}"
						</p>

						{/* Example conductor */}
						<div
							className="p-3 rounded-lg mb-4"
							style={{
								backgroundColor: theme.colors.bgActivity,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							<p className="text-xs mb-1" style={{ color: theme.colors.textDim }}>
								Example Maestro
							</p>
							<p className="font-medium" style={{ color: theme.colors.textMain }}>
								{badge.exampleConductor.name}
							</p>
							<p className="text-xs" style={{ color: theme.colors.textDim }}>
								{badge.exampleConductor.era}
							</p>
							<p className="text-xs mt-1" style={{ color: theme.colors.textDim }}>
								{badge.exampleConductor.achievement}
							</p>
							<button
								onClick={() =>
									// webFull swap: renderer source called
									// `window.maestro.shell.openExternal(badge.exampleConductor.wikipediaUrl)`
									// here. In webFull's browser runtime there is no preload bridge —
									// the call would throw. Swap to the standard
									// `window.open(url, '_blank', 'noopener,noreferrer')` form per the
									// `MarkdownRenderer` swap-pattern precedent documented in this
									// file's header. Same semantic contract — open the Wikipedia URL
									// in a separate top-level browser context.
									window.open(badge.exampleConductor.wikipediaUrl, '_blank', 'noopener,noreferrer')
								}
								className="inline-flex items-center gap-1 text-xs mt-2 hover:underline"
								style={{ color: purpleAccent }}
							>
								<ExternalLink className="w-3 h-3" />
								Learn more on Wikipedia
							</button>
						</div>

						{/* Stats */}
						<div
							className="grid grid-cols-2 gap-4 p-3 rounded-lg mb-4"
							style={{
								backgroundColor: theme.colors.bgActivity,
								border: `1px solid ${theme.colors.border}`,
							}}
						>
							<div>
								<div className="flex items-center justify-center gap-1 mb-1">
									<Clock className="w-3 h-3" style={{ color: theme.colors.textDim }} />
									<span className="text-xs" style={{ color: theme.colors.textDim }}>
										Total AutoRun
									</span>
								</div>
								<span className="font-mono font-bold" style={{ color: theme.colors.textMain }}>
									{formatCumulativeTime(cumulativeTimeMs)}
								</span>
							</div>
							{recordTimeMs && (
								<div>
									<div className="flex items-center justify-center gap-1 mb-1">
										<Trophy className="w-3 h-3" style={{ color: goldColor }} />
										<span className="text-xs" style={{ color: theme.colors.textDim }}>
											{isNewRecord ? 'New Record' : 'Longest Run'}
										</span>
									</div>
									<span
										className="font-mono font-bold"
										style={{ color: isNewRecord ? goldColor : theme.colors.textMain }}
									>
										{formatCumulativeTime(recordTimeMs)}
									</span>
								</div>
							)}
						</div>

						{/* Next level info */}
						{nextBadge && (
							<div className="text-xs" style={{ color: theme.colors.textDim }}>
								<span>Next: </span>
								<span style={{ color: purpleAccent }}>{nextBadge.name}</span>
								<span> • {formatTimeRemaining(cumulativeTimeMs, nextBadge)}</span>
							</div>
						)}

						{!nextBadge && (
							<div className="text-xs" style={{ color: goldColor }}>
								You have achieved the highest rank! A true Titan of the Baton.
							</div>
						)}
					</div>

					{/* Buttons */}
					<div className="px-8 pb-8 space-y-3">
						<button
							onClick={handleTakeABow}
							disabled={isClosing}
							className="w-full py-3 rounded-lg font-medium transition-all hover:scale-[1.02] disabled:opacity-70 disabled:cursor-not-allowed"
							style={{
								background: `linear-gradient(135deg, ${purpleAccent} 0%, ${goldColor} 100%)`,
								color: '#FFFFFF',
								boxShadow: `0 4px 20px ${purpleAccent}40`,
							}}
						>
							{isClosing ? '🎉 Bravo! 🎉' : 'Take a Bow'}
						</button>

						{/* Share options */}
						<div className="relative">
							<button
								onClick={() => setShareMenuOpen(!shareMenuOpen)}
								className="w-full py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 hover:opacity-90"
								style={{
									backgroundColor: theme.colors.bgActivity,
									color: theme.colors.textMain,
									border: `1px solid ${theme.colors.border}`,
								}}
							>
								<Share2 className="w-4 h-4" />
								Share Achievement
							</button>

							{shareMenuOpen && (
								<div
									className="absolute bottom-full left-0 right-0 mb-2 p-2 rounded-lg shadow-xl"
									style={{
										backgroundColor: theme.colors.bgSidebar,
										border: `1px solid ${theme.colors.border}`,
									}}
								>
									<button
										onClick={async () => {
											await copyToClipboard();
											setTimeout(() => setShareMenuOpen(false), 1000);
										}}
										className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-white/10 transition-colors"
									>
										{copySuccess ? (
											<Check className="w-4 h-4" style={{ color: theme.colors.success }} />
										) : (
											<Copy className="w-4 h-4" style={{ color: theme.colors.textDim }} />
										)}
										<span style={{ color: theme.colors.textMain }}>
											{copySuccess ? 'Copied!' : 'Copy to Clipboard'}
										</span>
									</button>
									<button
										onClick={() => {
											downloadImage();
											setShareMenuOpen(false);
										}}
										className="w-full flex items-center gap-3 px-3 py-2 rounded hover:bg-white/10 transition-colors"
									>
										<Download className="w-4 h-4" style={{ color: theme.colors.textDim }} />
										<span style={{ color: theme.colors.textMain }}>Save as Image</span>
									</button>
								</div>
							)}
						</div>

						{/* Leaderboard Registration */}
						{onOpenLeaderboardRegistration && !isLeaderboardRegistered && (
							<button
								onClick={() => {
									onClose();
									onOpenLeaderboardRegistration();
								}}
								className="w-full py-2.5 rounded-lg font-medium transition-all flex items-center justify-center gap-2 hover:opacity-90"
								style={{
									backgroundColor: `${goldColor}20`,
									color: goldColor,
									border: `1px solid ${goldColor}60`,
								}}
							>
								<Trophy className="w-4 h-4" />
								Join Global Leaderboard
							</button>
						)}
					</div>
				</div>
			</div>
		</>
	);
}

export default StandingOvationOverlay;
