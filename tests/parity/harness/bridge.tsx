/**
 * Parity Harness Bridge
 *
 * Vite entry point loaded by the harness's `index.html`. Reads the URL
 * query string (`?component=<key>&story=<name>`), looks up the matching
 * adapter from the local `registry.ts`, mounts the configured React story
 * into `#root`, and flips `window.__parityReady = true` on completion.
 *
 * The Playwright runner waits for `window.__parityReady === true` before
 * running its assertion verbs against the rendered DOM. Failures during
 * mount surface in the `#__parity_error` element and on
 * `window.__parityError` so the spec can attach them to the test failure.
 *
 * Scope: HARNESS-ONLY. This file is never bundled into the shipped
 * webFull bundle — it lives under `tests/parity/harness/` and is served
 * by a Vite dev server scoped to the parity test run.
 */

import { createRoot, type Root } from 'react-dom/client';
import { registry, type StorySpec } from './registry';
// Side-effect import: pulls the three `@tailwind` directives through the
// shared root-level PostCSS pipeline so utility classes used by lifted
// components (e.g. SettingCheckbox's `translate-x-5`, ToggleButtonGroup's
// `ring-2`, the dot-Badge's `animate-pulse`) actually emit CSS rules in
// the harness bundle. Without this, empty inline Tailwind-styled spans
// collapse to 0×0 and Playwright's `toBeVisible` correctly judges them
// hidden — surfacing the gap as a false negative against the catalog.
import './harness.css';

declare global {
	interface Window {
		__parityReady?: boolean;
		__parityError?: string;
		__parityStory?: StorySpec | null;
	}
}

const errorEl = document.getElementById('__parity_error') as HTMLPreElement | null;
const rootEl = document.getElementById('root');

function fail(message: string, detail?: unknown): void {
	const text = detail ? `${message}\n${String(detail)}` : message;
	if (errorEl) errorEl.textContent = text;
	window.__parityError = text;
	window.__parityReady = true;
}

let _root: Root | null = null;

async function bootstrap(): Promise<void> {
	if (!rootEl) {
		fail('Harness root element missing');
		return;
	}

	const params = new URLSearchParams(window.location.search);
	const componentKey = params.get('component');
	const storyName = params.get('story');

	if (!componentKey) {
		fail(
			'Missing ?component query parameter. Append ?component=<key>&story=<name> to mount a story.'
		);
		return;
	}
	if (!storyName) {
		fail('Missing ?story query parameter. Append ?story=<name> to mount a story.');
		return;
	}

	const adapter = registry[componentKey];
	if (!adapter) {
		fail(
			`No registry entry for component "${componentKey}". Available keys: ${
				Object.keys(registry).join(', ') || '(none)'
			}`
		);
		return;
	}

	try {
		const { catalog, render } = await adapter.load();
		const story = catalog.find((s) => s.name === storyName) ?? null;
		window.__parityStory = story
			? { name: story.name, happyPath: story.happyPath, then: story.then }
			: null;
		if (!story) {
			fail(
				`Story "${storyName}" not found in "${componentKey}" catalog. Stories: ${catalog
					.map((s) => s.name)
					.join(', ')}`
			);
			return;
		}

		const element = render(story);
		// Negative-absence stories may return null on purpose — the catalog
		// expects the component to render nothing. Mount as-is; the assertion
		// layer asserts absence.
		_root = createRoot(rootEl);
		_root.render(element);
		// Give React one paint to flush, then signal readiness.
		await new Promise<void>((r) => requestAnimationFrame(() => r()));
		window.__parityReady = true;
	} catch (err) {
		fail('Harness threw while mounting story', err);
	}
}

void bootstrap();
