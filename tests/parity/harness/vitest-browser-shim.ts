/**
 * Vitest browser shim — aliased in place of the real `vitest` package by
 * `vite.harness.config.ts` (`resolve.alias`).
 *
 * The catalog files (`<Component>.parity.test.ts`) double as the vitest
 * catalog-shape suite AND as the exported `ParityStory[]` we want to read
 * from inside the browser. Importing the real vitest package in a browser
 * throws because vitest's runtime expects a vitest worker host — the
 * `describe(...)` registration at the catalog file's bottom would surface
 * a "no test context" exception and reject our dynamic import.
 *
 * This shim provides permissive no-ops for `describe` / `it` / `expect` /
 * lifecycle hooks so the module-load side effect is silent, and only the
 * exported `<componentName>ParityCatalog` constant matters at the
 * harness import boundary.
 *
 * Identical in intent to `tests/parity/vitest-shim.cjs` (the Node-side
 * counterpart loaded by Playwright). Two files because Node loads CJS and
 * Vite loads ESM — the alias machinery in each platform points to its
 * respective implementation.
 */

type Chainable = {
	(value?: unknown): Chainable;
	[k: string]: unknown;
};

function chainable(): Chainable {
	const fn = function () {
		return chainable();
	} as unknown as Chainable;
	return new Proxy(fn, {
		get() {
			return chainable;
		},
		apply() {
			return chainable();
		},
	}) as Chainable;
}

const noop = (): void => {};

// Vitest's `describe(name, fn)` signature — we accept both positionals to
// match the call shape but only run the optional `fn` body, so the test-suite
// registration in the catalog evaluates without throwing. `name` is captured
// in the signature but intentionally unused.
export const describe = (_name?: string, fn?: () => void): void => {
	if (typeof fn === 'function') {
		try {
			fn();
		} catch {
			// Catalog-shape `it(...)` callbacks may evaluate matchers eagerly via
			// the proxy; swallow — Playwright is not the vitest runner.
		}
	}
};
(describe as unknown as { skip: () => void }).skip = noop;
(describe as unknown as { only: typeof describe }).only = describe;
(describe as unknown as { each: () => typeof describe }).each = () => describe;

// Register-only; do not invoke. Both positionals are accepted to match the
// vitest call shape but discarded.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const it = (name?: string, fn?: () => void): void => {};
(it as unknown as { skip: () => void }).skip = noop;
(it as unknown as { only: typeof it }).only = it;
(it as unknown as { each: () => typeof it }).each = () => it;
export const test = it;

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export const expect = (...args: unknown[]): Chainable => chainable();
(expect as unknown as { assertions: () => void }).assertions = noop;
(expect as unknown as { extend: () => void }).extend = noop;
(expect as unknown as { fail: () => void }).fail = noop;
(expect as unknown as { objectContaining: (x: unknown) => unknown }).objectContaining = (x) => x;
(expect as unknown as { arrayContaining: (x: unknown) => unknown }).arrayContaining = (x) => x;
(expect as unknown as { stringContaining: (x: unknown) => unknown }).stringContaining = (x) => x;

export const beforeAll = noop;
export const beforeEach = noop;
export const afterAll = noop;
export const afterEach = noop;

export const vi = {
	fn: () => noop,
	spyOn: () => ({ mockRestore: noop }),
	mock: noop,
};

const all = {
	describe,
	it,
	test,
	expect,
	beforeAll,
	beforeEach,
	afterAll,
	afterEach,
	vi,
};

export default all;
