/**
 * ContextWarningSash — parity harness adapter
 *
 * Bridges the prose `given`/`when` of each catalog story to a concrete React
 * element for the harness to mount. The catalog file
 * (`src/webFull/components/ContextWarningSash.parity.test.ts`) is imported
 * verbatim — adding/removing/editing a story over there flows through here
 * via story.name without any handler-side change for behaviorally-similar
 * stories.
 *
 * Stories that require BOTH an initial mount AND a re-render with new props
 * (e.g. "reappears when usage escalates yellow→red after dismissal") are
 * staged via the local <DismissalDriver> wrapper, which dismisses the banner
 * on first mount and then forwards the catalog-supplied `nextUsage` into the
 * component on a queued tick.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import {
	ContextWarningSash,
	type ContextWarningSashProps,
} from '../../../../src/webFull/components/ContextWarningSash';
import { contextWarningSashParityCatalog } from '../../../../src/webFull/components/ContextWarningSash.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const darkTheme = THEMES['dracula'];

/**
 * Drives the dismissal-recurrence stories. Mounts the sash at `initialUsage`,
 * synthesises a click on the Dismiss button on first paint, then re-renders
 * with `nextUsage`. This mirrors the renderer's per-tab dismissal state
 * machine without any catalog-side mocking.
 */
function DismissalDriver({
	initialUsage,
	nextUsage,
	baseProps,
}: {
	initialUsage: number;
	nextUsage: number;
	baseProps: Omit<ContextWarningSashProps, 'contextUsage'>;
}): ReactElement {
	const [usage, setUsage] = useState(initialUsage);
	const dismissedRef = useRef(false);

	useEffect(() => {
		if (dismissedRef.current) return;
		// Wait one paint so the banner is in the DOM, click Dismiss, then bump usage.
		const id = requestAnimationFrame(() => {
			const dismissBtn = document.querySelector<HTMLButtonElement>(
				'[role="alert"] [aria-label="Dismiss warning"]'
			);
			if (dismissBtn) {
				dismissBtn.click();
				dismissedRef.current = true;
				// One more paint to land the dismissed state, then bump usage.
				requestAnimationFrame(() => setUsage(nextUsage));
			}
		});
		return () => cancelAnimationFrame(id);
	}, [initialUsage, nextUsage]);

	return <ContextWarningSash {...baseProps} contextUsage={usage} />;
}

function render(story: ParityStory): ReactElement | null {
	const noop = () => {};
	const base: Omit<ContextWarningSashProps, 'contextUsage'> = {
		theme: darkTheme,
		yellowThreshold: 60,
		redThreshold: 80,
		enabled: true,
		onSummarizeClick: noop,
		tabId: 'parity-harness-tab',
	};

	switch (story.name) {
		case 'context-warning-sash-renders-yellow-banner-when-usage-at-yellow-threshold':
			return <ContextWarningSash {...base} contextUsage={65} />;

		case 'context-warning-sash-renders-red-banner-when-usage-at-red-threshold':
			return <ContextWarningSash {...base} contextUsage={85} />;

		case 'context-warning-sash-exposes-compact-and-dismiss-affordances':
			return <ContextWarningSash {...base} contextUsage={85} />;

		case 'context-warning-sash-reappears-when-usage-escalates-yellow-to-red-after-dismissal':
			return <DismissalDriver initialUsage={65} nextUsage={82} baseProps={base} />;

		case 'context-warning-sash-hidden-when-usage-below-yellow-threshold':
			return <ContextWarningSash {...base} contextUsage={40} />;

		case 'context-warning-sash-hidden-when-disabled-even-at-red-threshold':
			return <ContextWarningSash {...base} contextUsage={95} enabled={false} />;

		case 'context-warning-sash-stays-hidden-after-dismissal-without-meaningful-usage-bump':
			return <DismissalDriver initialUsage={65} nextUsage={68} baseProps={base} />;

		case 'context-warning-sash-fires-no-ipc-or-websocket-traffic-on-mount-or-dismiss':
			// Pure-presentation guard story. Mount the red banner; the harness
			// runner's network-side watchdog (in the spec) confirms no IPC/WS
			// traffic. The assertion verb the catalog uses here ("hasElement
			// matches either the banner OR a body without alert") is satisfied
			// by either the mounted banner or its absence — we mount it.
			return <ContextWarningSash {...base} contextUsage={85} />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

// The harness `registry.ts` dynamic-imports this module and reads
// `m.default`. We export the adapter contract — `{ catalog, render }` —
// as the default export so the registry can consume it without a double
// unwrap.
const adapter = {
	catalog: contextWarningSashParityCatalog as ParityStory[],
	render,
};

export default adapter;
