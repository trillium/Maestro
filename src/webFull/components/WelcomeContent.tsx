/**
 * WelcomeContent
 *
 * Lifted from `src/renderer/components/WelcomeContent.tsx` as part of the
 * Layer 2.5 leaf-parade wave. Implementation is verbatim except for two
 * import-path adjustments matching the L2.5 precedent:
 * - `Theme` from `'../types'` → `'../../shared/theme-types'` (renderer
 *   routes through `src/renderer/types/index.ts`; webFull imports the
 *   type directly from the canonical shared source).
 * - `maestroWandIcon` from `'../assets/icon-wand.png'` →
 *   `'../../renderer/assets/icon-wand.png'`. The renderer asset tree is
 *   re-used directly per the L2.5 `GroupChatMessages` / `ShortcutsHelpModal`
 *   precedent of importing non-divergent renderer modules and assets via
 *   relative path. The asset is a pure binary with zero runtime behaviour;
 *   duplicating it under `src/webFull/assets/` would create silent drift
 *   for the (load-bearing) Maestro wand glyph. webFull's vite config
 *   already aliases `@renderer` → `src/renderer` and the cross-tree
 *   relative import resolves through the standard Vite asset pipeline.
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop
 * convention, consistent with the L2.1 Modal/FormInput primitives and the
 * L2.4 / L2.5 sibling lifts. Callers in webFull call
 * `const { theme } = useTheme()` at the feature-component level and
 * thread it down.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched. Pre-flight
 * `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer"`
 * on the source file returned empty (exit 1).
 *
 * Composition shape: pure presentational content block. No hooks, no
 * effects, no state, no refs, no event handlers. Renders the Maestro
 * wand icon, an h1 heading, an introduction paragraph, two numbered
 * goal rows (parallel-agents / auto-run), a "How it works" explainer
 * card, and an optional get-started call-to-action gated on the
 * `showGetStarted` prop. Used by both the first-launch empty state and
 * the tour introduction overlay in the renderer.
 */

import type { Theme } from '../../shared/theme-types';
import maestroWandIcon from '../../renderer/assets/icon-wand.png';

interface WelcomeContentProps {
	theme: Theme;
	/** Show the "To get started..." call-to-action message */
	showGetStarted?: boolean;
}

/**
 * WelcomeContent - Shared welcome message component
 *
 * Displays the Maestro icon and introductory copy explaining:
 * - Parallel agent management
 * - Auto Run automation
 * - Non-interactive mode behavior
 * - Read-Only mode option
 */
export function WelcomeContent({
	theme,
	showGetStarted = false,
}: WelcomeContentProps): JSX.Element {
	return (
		<div className="flex flex-col items-center text-center max-w-xl">
			{/* Maestro Icon */}
			<img src={maestroWandIcon} alt="Maestro" className="w-20 h-20 mb-6 opacity-90" />

			{/* Heading */}
			<h1 className="text-2xl font-bold mb-4" style={{ color: theme.colors.textMain }}>
				Welcome to Maestro
			</h1>

			{/* Primary goals */}
			<p className="text-sm mb-4" style={{ color: theme.colors.textDim }}>
				Maestro is an orchestration tool designed to:
			</p>

			<div className="text-left space-y-3 mb-6">
				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						1
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							Manage multiple AI agents in parallel
						</strong>{' '}
						— Run several coding assistants simultaneously, each in their own session, switching
						between them effortlessly.
					</p>
				</div>

				<div className="flex gap-3">
					<span
						className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
						style={{
							backgroundColor: theme.colors.accent,
							color: theme.colors.accentForeground,
						}}
					>
						2
					</span>
					<p className="text-sm" style={{ color: theme.colors.textDim }}>
						<strong style={{ color: theme.colors.textMain }}>
							Enable unattended automation via Auto Run
						</strong>{' '}
						— Queue up task lists in markdown documents and let your agents execute them while you
						step away.
					</p>
				</div>
			</div>

			{/* How it works section */}
			<div
				className="text-sm leading-relaxed p-4 rounded-lg text-left space-y-2"
				style={{
					backgroundColor: theme.colors.bgActivity,
					color: theme.colors.textDim,
				}}
			>
				<p>
					<strong style={{ color: theme.colors.textMain }}>How it works:</strong> Maestro is a
					pass-through to your AI provider. Your MCP tools, skills, and permissions work exactly as
					they do when running the provider directly.
				</p>
				<p>
					Agents run in auto-approve mode with tool calls accepted automatically. Toggle Read-Only
					mode for guardrails.
				</p>
			</div>

			{/* Get started call-to-action (only on first-launch screen) */}
			{showGetStarted && (
				<p className="text-sm mt-6" style={{ color: theme.colors.textDim }}>
					To get started, create your first agent manually or with the help of the AI wizard.
				</p>
			)}
		</div>
	);
}
