/**
 * EmptyState — Usage Dashboard
 *
 * Lifted from src/renderer/components/UsageDashboard/EmptyState.tsx as part of
 * the Layer 2.3 leaf-component wave. Implementation is verbatim except for the
 * `Theme` import path:
 * - Renderer: `'../../types'` (routes through `src/renderer/types/index.ts`
 *   re-export of `src/shared/theme-types`).
 * - webFull:  `'../../../shared/theme-types'` (no `types/` aggregator in
 *   webFull yet — feature components import the shared theme types directly,
 *   consistent with `src/webFull/components/ui/Modal.tsx` and
 *   `src/webFull/components/ui/FormInput.tsx`).
 *
 * Theme access pattern: keeps the renderer's `theme: Theme` prop convention.
 * Callers in webFull resolve theme via `useTheme()` at the feature-component
 * level and thread it down to this primitive.
 *
 * Displays a friendly empty state message when no usage data exists.
 * Used in the Usage Dashboard to indicate that the user should start
 * using Maestro to generate stats.
 *
 * Features:
 * - Theme-aware styling with inline styles
 * - Subtle chart illustration/icon
 * - Friendly, encouraging message
 * - Reusable component with customizable message
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

import { memo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Theme } from '../../../shared/theme-types';

interface EmptyStateProps {
	/** Current theme for styling */
	theme: Theme;
	/** Optional custom title (default: "No usage data yet") */
	title?: string;
	/** Optional custom message (default: "Start using Maestro to see your stats!") */
	message?: string;
}

export const EmptyState = memo(function EmptyState({
	theme,
	title = 'No usage data yet',
	message = 'Start using Maestro to see your stats!',
}: EmptyStateProps) {
	return (
		<div
			className="h-full flex flex-col items-center justify-center gap-4"
			style={{ color: theme.colors.textDim }}
			data-testid="usage-dashboard-empty"
		>
			{/* Subtle chart illustration */}
			<div className="relative" style={{ opacity: 0.3 }}>
				{/* Main chart icon */}
				<BarChart3 className="w-16 h-16" />

				{/* Decorative subtle bars for visual interest */}
				<svg
					className="absolute -bottom-1 -right-2 w-6 h-6"
					viewBox="0 0 24 24"
					fill="none"
					style={{ opacity: 0.5 }}
				>
					<rect x="4" y="12" width="4" height="8" rx="1" fill={theme.colors.textDim} />
					<rect x="10" y="8" width="4" height="12" rx="1" fill={theme.colors.textDim} />
					<rect x="16" y="4" width="4" height="16" rx="1" fill={theme.colors.textDim} />
				</svg>
			</div>

			{/* Message text */}
			<div className="text-center">
				<p className="text-lg mb-2" style={{ color: theme.colors.textMain }}>
					{title}
				</p>
				<p className="text-sm">{message}</p>
			</div>
		</div>
	);
});

export default EmptyState;
