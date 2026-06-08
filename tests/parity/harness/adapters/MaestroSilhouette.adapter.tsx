/**
 * MaestroSilhouette — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/MaestroSilhouette.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * MaestroSilhouette ships TWO named exports — `MaestroSilhouette` (static)
 * and `AnimatedMaestro` (CSS-keyframe-driven). The catalog distinguishes
 * them by `alt` attribute (`"Maestro conductor silhouette"` vs
 * `"Animated maestro conductor"`). One happy-path story mounts BOTH
 * exports side-by-side; we use a tiny local `Pair` wrapper so the single
 * `render(story)` contract returns one ReactElement.
 *
 * Pure presentational primitive — no state, no lifecycle, no portals,
 * no theme dependency, no contexts. Asset loading goes through Vite's
 * standard `?import` pipeline for the two conductor PNGs that the
 * component imports relative to `src/renderer/assets/`.
 */

import type { ReactElement } from 'react';
import {
	MaestroSilhouette,
	AnimatedMaestro,
} from '../../../../src/webFull/components/MaestroSilhouette';
import { maestroSilhouetteParityCatalog } from '../../../../src/webFull/components/MaestroSilhouette.parity.test';
import type { ParityStory } from '../registry';

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'maestro-silhouette-renders-default-img-element-with-canonical-alt-text':
			return <MaestroSilhouette />;

		case 'animated-maestro-renders-img-element-with-distinct-canonical-alt-text':
			return <AnimatedMaestro />;

		case 'maestro-silhouette-passes-through-arbitrary-classname-and-preserves-img-tag':
			return <MaestroSilhouette className="custom-class" />;

		case 'maestro-silhouette-and-static-can-coexist-with-distinct-alt-attributes':
		case 'animated-maestro-and-static-can-coexist-with-distinct-alt-attributes':
			return (
				<>
					<MaestroSilhouette />
					<AnimatedMaestro />
				</>
			);

		case 'maestro-silhouette-emits-no-wrapper-div-no-role-attribute-no-aria-label':
			return <MaestroSilhouette />;

		case 'maestro-silhouette-fires-no-ipc-or-websocket-traffic-on-mount-or-rerender':
			return <MaestroSilhouette />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: maestroSilhouetteParityCatalog as ParityStory[],
	render,
};

export default adapter;
