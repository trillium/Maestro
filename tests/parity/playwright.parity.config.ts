/**
 * Playwright config — parity-catalog component tests.
 *
 * Separate from the root `playwright.config.ts` (which is wired for the
 * Electron E2E suite at `./e2e/`). This config:
 *   - scopes testDir to `./specs/` (this directory),
 *   - boots a Vite dev server pointed at `./harness/` on port 5180,
 *   - runs against the bundled chromium headless shell,
 *   - does NOT touch the Electron build pipeline.
 *
 * Invoked via `npm run test:parity`.
 */

import { defineConfig } from '@playwright/test';
import path from 'path';
import Module from 'module';

// `tests/parity/playwright.parity.config.ts` is loaded by Playwright's
// CJS loader (the repo's `package.json` does not declare `"type": "module"`),
// so we use Node's CJS-side `__dirname` directly rather than `import.meta.url`.
const here = __dirname;

/**
 * Catalog files (`<Component>.parity.test.ts`) start with
 * `import { describe, expect, it } from 'vitest'` so they double as the
 * vitest catalog-shape suite. Vitest is ESM-only, so Playwright's CJS
 * loader throws "Vitest cannot be imported in a CommonJS module" when a
 * parity spec re-exports the catalog. We intercept `require('vitest')` at
 * the Node Module._load level and hand back a permissive CJS stand-in.
 * The shim has zero effect on the real vitest suite — it only fires inside
 * the Playwright process at parity-test collection time.
 *
 * If you find this needs to handle more vitest APIs, add them to
 * `tests/parity/vitest-shim.cjs`.
 */
const originalLoad = (Module as unknown as { _load: typeof Module.prototype.require })._load;
(Module as unknown as { _load: typeof Module.prototype.require })._load = function patchedLoad(
	this: NodeJS.Module,
	request: string,
	parent: NodeJS.Module | null,
	isMain: boolean
) {
	if (request === 'vitest') {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		return require(path.join(here, 'vitest-shim.cjs'));
	}
	return originalLoad.call(this, request, parent as never, isMain as never) as never;
} as typeof Module.prototype.require;

export default defineConfig({
	// Dir is `playwright-specs/` (not `specs/`) because the repo root
	// `.gitignore` blocks the bare `specs/` pattern (reserved for the
	// OpenSpec workflow at repo root). Renaming avoids needing a sub-rule
	// in `.gitignore` and keeps the test files trackable by default.
	testDir: path.join(here, 'playwright-specs'),
	testMatch: '**/*.parity.spec.ts',

	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: process.env.CI ? 1 : 0,
	workers: 1,

	reporter: [['list'], ['html', { open: 'never', outputFolder: 'results/html' }]],

	use: {
		baseURL: 'http://127.0.0.1:5180/',
		actionTimeout: 5000,
		trace: 'retain-on-failure',
		screenshot: 'only-on-failure',
		video: 'off',
	},

	projects: [
		{
			name: 'parity-chromium',
			use: {
				// Use the built-in chromium project.
				browserName: 'chromium',
			},
		},
	],

	timeout: 30_000,
	expect: { timeout: 5_000 },

	outputDir: path.join(here, 'results/artifacts'),

	webServer: {
		command: './node_modules/.bin/vite --config tests/parity/harness/vite.harness.config.ts',
		port: 5180,
		reuseExistingServer: !process.env.CI,
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: 30_000,
		cwd: path.resolve(here, '../..'),
	},
});
