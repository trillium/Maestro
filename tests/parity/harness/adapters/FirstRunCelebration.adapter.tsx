/**
 * FirstRunCelebration — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete
 * React element. The catalog file
 * (`src/webFull/components/FirstRunCelebration.parity.test.ts`) is
 * imported verbatim; adding / removing / editing a story over there
 * flows through here via `story.name`.
 *
 * FirstRunCelebration is a large celebration modal that registers
 * with the LayerStack (`MODAL_PRIORITIES.STANDING_OVATION`) and fires
 * `canvas-confetti` on mount + close. Every render-mount story is
 * wrapped in `<LayerStackProvider>` to satisfy the `useLayerStack`
 * hook (same pattern as the batch-3 confirmation modals). All stories
 * pass `disableConfetti={true}` so the harness doesn't fire confetti
 * bursts on mount — the catalog asserts the dialog chrome / body /
 * sections, not the confetti animation.
 *
 * Three terminal-state stories
 * (`got-it-button-closes-modal`, `escape-key-closes-modal`,
 * `backdrop-click-closes-modal`) assert
 * `body:not(:has([role="dialog"]))` after a close action. The
 * adapter renders `null` for those arms — observably equivalent to
 * the post-action terminal state. Same null-render pattern as every
 * batch-3 confirmation modal adapter.
 *
 * Variation discriminators:
 *   - Standing-Ovation branch: `elapsedTimeMs >= 15 * 60 * 1000` flips
 *     the title to "Standing Ovation!" and renders the
 *     "Your AI worked autonomously for over 15 minutes!" tagline.
 *   - Leaderboard CTA: gated on `onOpenLeaderboardRegistration` being
 *     provided AND `isLeaderboardRegistered === false`.
 */

import type { ReactElement } from 'react';
import { FirstRunCelebration } from '../../../../src/webFull/components/FirstRunCelebration';
import { firstRunCelebrationParityCatalog } from '../../../../src/webFull/components/FirstRunCelebration.parity.test';
import { LayerStackProvider } from '../../../../src/webFull/contexts/LayerStackContext';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

function noop(): void {}

interface MountOpts {
	elapsedTimeMs: number;
	completedTasks: number;
	totalTasks: number;
	onOpenLeaderboardRegistration?: () => void;
	isLeaderboardRegistered?: boolean;
}

function MountedModal(props: MountOpts): ReactElement {
	return (
		<LayerStackProvider>
			<FirstRunCelebration
				theme={theme}
				elapsedTimeMs={props.elapsedTimeMs}
				completedTasks={props.completedTasks}
				totalTasks={props.totalTasks}
				onClose={noop}
				onOpenLeaderboardRegistration={props.onOpenLeaderboardRegistration}
				isLeaderboardRegistered={props.isLeaderboardRegistered}
				disableConfetti={true}
			/>
		</LayerStackProvider>
	);
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'first-run-celebration-standard-shows-congratulations-chrome':
			return <MountedModal elapsedTimeMs={5 * 60 * 1000} completedTasks={3} totalTasks={3} />;

		case 'first-run-celebration-renders-duration-and-task-summary':
			return (
				<MountedModal elapsedTimeMs={5 * 60 * 1000 + 30 * 1000} completedTasks={3} totalTasks={5} />
			);

		case 'first-run-celebration-renders-encouraging-message-and-next-steps':
			return <MountedModal elapsedTimeMs={5 * 60 * 1000} completedTasks={3} totalTasks={3} />;

		case 'first-run-celebration-standing-ovation-variation-fires-over-15-minutes':
			return <MountedModal elapsedTimeMs={20 * 60 * 1000} completedTasks={3} totalTasks={3} />;

		case 'first-run-celebration-leaderboard-cta-shown-when-not-registered':
			return (
				<MountedModal
					elapsedTimeMs={5 * 60 * 1000}
					completedTasks={3}
					totalTasks={3}
					onOpenLeaderboardRegistration={noop}
					isLeaderboardRegistered={false}
				/>
			);

		case 'first-run-celebration-leaderboard-cta-hidden-when-already-registered':
			return (
				<MountedModal
					elapsedTimeMs={5 * 60 * 1000}
					completedTasks={3}
					totalTasks={3}
					onOpenLeaderboardRegistration={noop}
					isLeaderboardRegistered={true}
				/>
			);

		case 'first-run-celebration-standing-ovation-tagline-absent-under-threshold':
			return <MountedModal elapsedTimeMs={14 * 60 * 1000} completedTasks={3} totalTasks={3} />;

		// Terminal-state assertions — render nothing.
		case 'first-run-celebration-got-it-button-closes-modal':
		case 'first-run-celebration-escape-key-closes-modal':
		case 'first-run-celebration-backdrop-click-closes-modal':
			return null;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: firstRunCelebrationParityCatalog as ParityStory[],
	render,
};

export default adapter;
