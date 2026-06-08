/**
 * Vitest CJS shim — loaded by the Playwright parity config BEFORE any spec is
 * required. The `.parity.test.ts` catalog files (which live next to their
 * components and serve double-duty as both vitest catalog-shape suites AND as
 * the static catalog export consumed by Playwright) start with
 *
 *     import { describe, expect, it } from 'vitest';
 *
 * That import resolves through Playwright's `pirates`-based CJS hook, which
 * calls `require('vitest')`. But vitest is ESM-only (`"type": "module"` in its
 * `package.json`), so the require throws "Vitest cannot be imported in a
 * CommonJS module".
 *
 * We don't want to run vitest from inside Playwright — we only want to be able
 * to `require` the catalog files so we can read their exported
 * `ParityStory[]` array. So this shim hands back no-op stand-ins for
 * `describe`/`expect`/`it` that match enough of the surface that catalog-shape
 * `describe(...)` blocks evaluate without throwing.
 *
 * The catalog-shape vitest suite continues to be the source of truth for
 * shape checks under `npm test`. This shim only exists to keep Playwright's
 * loader from blowing up on the unrelated module-load side effect.
 *
 * Registration: `playwright.parity.config.ts` prepends this module to
 * `require.cache` under the resolved `vitest` package id before any spec
 * loads. See `cachePath` in that file.
 */

/* global module */
/* eslint-disable @typescript-eslint/no-unused-vars */
'use strict';

// Permissive no-op stand-in for vitest's chainable expect API. Catalog files
// only use `expect(...).toBe*` / `.toBeGreaterThanOrEqual` / `.toContain` from
// inside `it(...)` callbacks. The callbacks DO get registered (via our `it`
// stub) but we deliberately never invoke them — Playwright is not the vitest
// runner.
function chainable() {
	const proxy = new Proxy(function noop() {}, {
		get() {
			return chainable;
		},
		apply() {
			return chainable();
		},
	});
	return proxy;
}

const noop = () => {};
const describe = (_name, fn) => {
	if (typeof fn === 'function') {
		try {
			fn();
		} catch {
			// Catalog-shape `it(...)` registrations may throw inside vitest's own
			// matchers when invoked here; we never invoke them, so we just swallow.
		}
	}
};
describe.skip = noop;
describe.only = describe;
describe.each = () => describe;

const it = (_name, _fn) => {
	// Register-only; do not invoke. Catalog files declare their shape checks
	// here but we don't run them from Playwright.
};
it.skip = noop;
it.only = it;
it.each = () => it;
const test = it;

const expect = (..._args) => chainable();
expect.assertions = noop;
expect.extend = noop;
expect.fail = noop;
expect.objectContaining = (x) => x;
expect.arrayContaining = (x) => x;
expect.stringContaining = (x) => x;

const beforeAll = noop;
const beforeEach = noop;
const afterAll = noop;
const afterEach = noop;

module.exports = {
	describe,
	it,
	test,
	expect,
	beforeAll,
	beforeEach,
	afterAll,
	afterEach,
	vi: { fn: () => noop, spyOn: () => ({ mockRestore: noop }), mock: noop },
};
