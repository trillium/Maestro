/**
 * MaestroSilhouette
 *
 * Lifted from `src/renderer/components/MaestroSilhouette.tsx` as part of the
 * Layer 2.5 leaf-parade lift wave. Implementation is verbatim except for one
 * import-path adjustment matching the L2.5 precedent:
 * - PNG asset imports `'../assets/conductor-{dark,light}.png'` →
 *   `'../../renderer/assets/conductor-{dark,light}.png'`. The renderer assets
 *   are pure binaries with zero runtime behavior; re-using them directly
 *   follows the L2.5 `WelcomeContent` precedent (`maestroWandIcon` from
 *   `'../../renderer/assets/icon-wand.png'`). Duplicating the PNGs into
 *   `src/webFull/assets/` would create silent drift for the conductor glyph
 *   used by `AnimatedMaestro` in the Standing Ovation overlay and elsewhere.
 *   The webFull Vite config already routes cross-tree relative imports
 *   through the standard asset pipeline.
 *
 * Component body is verbatim from the renderer source — two named exports
 * (`MaestroSilhouette` static + `AnimatedMaestro` with CSS keyframe motion)
 * plus a module-load-time `document.head.appendChild` of the
 * `conductingMotion` keyframes guarded by both `typeof document !==
 * 'undefined'` and an `#maestro-animation-styles` id-check so it is
 * idempotent and SSR-safe.
 *
 * Pre-flight grep on the renderer source returned empty (no `window.maestro`,
 * no `from 'electron'`); the component is presentational-only and touches
 * neither the IPC bridge nor any Electron-only API. All input is via the
 * `MaestroSilhouetteProps` prop bag; all output is a single `<img>` element.
 */

import React from 'react';

// Import the conductor silhouette images
import conductorLight from '../../renderer/assets/conductor-light.png';
import conductorDark from '../../renderer/assets/conductor-dark.png';

interface MaestroSilhouetteProps {
	className?: string;
	style?: React.CSSProperties;
	variant?: 'dark' | 'light'; // dark = black silhouette, light = white silhouette
	size?: number;
}

/**
 * Maestro conductor silhouette component
 * Uses PNG assets for the authentic conductor graphic
 * - dark variant: black silhouette (for light backgrounds)
 * - light variant: white silhouette (for dark backgrounds)
 */
export function MaestroSilhouette({
	className = '',
	style = {},
	variant = 'dark',
	size = 200,
}: MaestroSilhouetteProps) {
	const imageSrc = variant === 'dark' ? conductorDark : conductorLight;

	return (
		<img
			src={imageSrc}
			alt="Maestro conductor silhouette"
			className={className}
			style={{
				width: size,
				height: size,
				objectFit: 'contain',
				...style,
			}}
		/>
	);
}

/**
 * Animated maestro for the Standing Ovation overlay
 * Includes a subtle conducting motion animation via CSS
 */
export function AnimatedMaestro({
	className = '',
	style = {},
	variant = 'dark',
	size = 200,
}: MaestroSilhouetteProps) {
	const imageSrc = variant === 'dark' ? conductorDark : conductorLight;

	return (
		<img
			src={imageSrc}
			alt="Animated maestro conductor"
			className={className}
			style={{
				width: size,
				height: size,
				objectFit: 'contain',
				animation: 'conductingMotion 2s ease-in-out infinite',
				...style,
			}}
		/>
	);
}

// Add the CSS animation to the document if not already present
if (typeof document !== 'undefined') {
	const styleId = 'maestro-animation-styles';
	if (!document.getElementById(styleId)) {
		const styleSheet = document.createElement('style');
		styleSheet.id = styleId;
		styleSheet.textContent = `
      @keyframes conductingMotion {
        0%, 100% { transform: rotate(0deg); }
        25% { transform: rotate(-3deg); }
        75% { transform: rotate(3deg); }
      }
    `;
		document.head.appendChild(styleSheet);
	}
}

export default MaestroSilhouette;
