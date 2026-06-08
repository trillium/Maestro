/**
 * runParityCatalog — Playwright executor for `.parity.test.ts` catalogs.
 *
 * Catalog-shape vitest checks (the `describe(... 'parity catalog', ...)` block
 * in every `<Component>.parity.test.ts`) prove the SHAPE of the document:
 * story count, allowed assertion verbs, no banned IPC surfaces, etc. They do
 * NOT prove that the documented behavior actually holds in a real DOM.
 *
 * This executor closes that gap: for each story in the catalog it spawns a
 * Playwright test that
 *   1. navigates to the parity harness (`tests/parity/harness/`) with
 *      `?component=<componentKey>&story=<story.name>`,
 *   2. waits for `window.__parityReady` to flip true,
 *   3. iterates the story's `then[]` assertions and asserts each verb against
 *      the rendered DOM (`hasElement` → query, `hasText` → text contains,
 *      `hasElement` against an absence selector (`body:not(:has(...))`) →
 *      hidden, etc.).
 *
 * Vocabulary today: `hasElement` and `hasText`. The other catalog verbs
 * (`wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`,
 * `broadcast`) require server-side infrastructure that this scaffold does
 * NOT yet stand up — stories using those verbs are MARKED-SKIPPED with a
 * reason rather than silently passing. Wiring them is a follow-on (see
 * `tests/parity/README.md` for the seam).
 *
 * Adoption: ONE call per component, from a `tests/parity/specs/*.parity.spec.ts`
 * file. The call expands at collection time into N Playwright `test()`s.
 */

import { test, expect, type Page } from '@playwright/test';
import type { ParityAssertion, ParityStory } from './harness/registry';

export interface RunParityOptions {
	componentKey: string;
	catalog: ParityStory[];
	harnessBaseUrl?: string;
}

const VERBS_REQUIRING_BACKEND = new Set([
	'wsFrameMatches',
	'dbHasRow',
	'fsHas',
	'processHas',
	'notificationFired',
	'broadcast',
]);

function isAbsenceSelector(selector: string): boolean {
	// Stories assert "element should NOT be present" by targeting either:
	//   `body:not(:has(<inner>))`   (no inner anywhere in body)
	// or `<a>, body:not(:has(<a>))` (presence-OR-absence guard).
	// The first form is a strict absence; the second is satisfied by either.
	return selector.includes(':not(:has(');
}

async function assertHasElement(page: Page, storyName: string, target: string): Promise<void> {
	const root = page.locator('#root');
	const locator = page.locator(target);
	if (isAbsenceSelector(target)) {
		// Absence selectors are evaluated against the document; existence is
		// the assertion's meaning ("there is a body matching this not-has
		// selector"). expect().toHaveCount(>=1) suits this.
		await expect(
			locator,
			`[${storyName}] expected absence-selector to match (target=${target})`
		).toHaveCount(1, { timeout: 2000 });
		return;
	}
	await expect(
		locator.first(),
		`[${storyName}] expected target to be visible (target=${target})`
	).toBeVisible({ timeout: 2000 });
	// Sanity: target must live inside the harness root (not outside the mount).
	await expect(root.locator(target).first()).toBeVisible();
}

async function assertHasText(
	page: Page,
	storyName: string,
	target: string,
	value: string | undefined
): Promise<void> {
	if (value === undefined) {
		throw new Error(`[${storyName}] hasText assertion missing 'value' (target=${target})`);
	}
	const locator = page.locator(target).first();
	await expect(locator, `[${storyName}] expected text "${value}" inside ${target}`).toContainText(
		value,
		{ timeout: 2000 }
	);
}

async function runAssertion(
	page: Page,
	storyName: string,
	assertion: ParityAssertion
): Promise<void> {
	switch (assertion.verb) {
		case 'hasElement':
			await assertHasElement(page, storyName, assertion.target);
			return;
		case 'hasText':
			await assertHasText(page, storyName, assertion.target, assertion.value);
			return;
		default:
			throw new Error(
				`[${storyName}] runParityCatalog does not yet support verb "${assertion.verb}". ` +
					`See tests/parity/README.md → "Verb coverage" for the wire-up checklist.`
			);
	}
}

/**
 * Expands a catalog into N Playwright tests, one per story.
 *
 * @example
 *   runParityCatalog({
 *     componentKey: 'ContextWarningSash',
 *     catalog: contextWarningSashParityCatalog,
 *   });
 */
export function runParityCatalog(options: RunParityOptions): void {
	const baseUrl = options.harnessBaseUrl ?? 'http://127.0.0.1:5180/';

	test.describe(`parity / ${options.componentKey}`, () => {
		for (const story of options.catalog) {
			const usesBackendVerb = story.then.some((a) => VERBS_REQUIRING_BACKEND.has(a.verb));

			if (usesBackendVerb) {
				test.skip(`${story.name} [skipped: backend verbs not yet wired]`, () => {
					/* skipped */
				});
				continue;
			}

			test(story.name, async ({ page }) => {
				const url = new URL(baseUrl);
				url.searchParams.set('component', options.componentKey);
				url.searchParams.set('story', story.name);
				await page.goto(url.toString());

				// Wait for the harness to signal readiness.
				await page.waitForFunction(() => window.__parityReady === true, undefined, {
					timeout: 10_000,
				});

				// If the harness itself errored during mount, surface it.
				const harnessError = await page.evaluate(() => window.__parityError ?? null);
				if (harnessError) {
					throw new Error(`Harness failed to mount story: ${harnessError}`);
				}

				for (const assertion of story.then) {
					await runAssertion(page, story.name, assertion);
				}
			});
		}
	});
}
