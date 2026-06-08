# Playwright Parity Catalog Executor

> Closes the behavioral-parity gap that the catalog-shape vitest checks leave open.

## What this is

Every lifted `src/webFull/components/<Name>.tsx` ships with a sibling
`<Name>.parity.test.ts` "parity catalog" — a `(given, when, then)` table of
stories using a fixed assertion vocabulary (`hasElement`, `hasText`,
`wsFrameMatches`, `dbHasRow`, `fsHas`, `processHas`, `notificationFired`,
`broadcast`). Today those files do double-duty:

1. They `export` the catalog (`<componentName>ParityCatalog: ParityStory[]`).
2. They run a small vitest `describe(...)` block that asserts the SHAPE of the
   catalog: ≥3 happy + ≥1 negative-per-happy stories, allowed verbs only, no
   banned IPC surfaces, etc.

What they DO NOT do is actually render the component and verify the documented
behavior. The shape-checks could pass on a catalog whose `then[]` claims are
total fiction.

This directory adds a Playwright executor that loads a catalog file, mounts the
lifted webFull component in a real Chromium DOM, performs each story's `given`
setup, and asserts the documented `then[]` assertions verb-by-verb. The two
layers coexist: catalog-shape vitest checks still run under `npm test`; the
behavioral pass runs under `npm run test:parity`.

## Layout

```
tests/parity/
├── harness/                          ← Vite-served test page
│   ├── index.html
│   ├── bridge.tsx                    ← URL-param-driven mount entry
│   ├── registry.ts                   ← componentKey → adapter
│   ├── vite.harness.config.ts        ← serves :5180
│   ├── vitest-browser-shim.ts        ← in-browser stub for `vitest`
│   └── adapters/
│       └── <Component>.adapter.tsx   ← one per adopted component
├── playwright-specs/                 ← Playwright test files (named to
│                                     ← dodge the root `.gitignore`'s
│                                     ← reserved `specs/` pattern)
│   └── <Component>.parity.spec.ts    ← one per adopted component
├── runParityCatalog.ts               ← shared executor
├── playwright.parity.config.ts       ← `npm run test:parity` entry
├── vitest-shim.cjs                   ← in-Node stub for `vitest`
└── README.md                         ← (this file)
```

## How to make your `.parity.test.ts` catalog actually-executed

Five steps to wire a new component into the executor:

### 1. Confirm the catalog exports a stable name

Open `src/webFull/components/<Name>.parity.test.ts` and verify the catalog
const is exported (e.g. `export const myComponentParityCatalog = [...]`). The
executor reads this array; the vitest `describe(...)` block at the bottom of
the file is untouched.

### 2. Write an adapter at `tests/parity/harness/adapters/<Name>.adapter.tsx`

The adapter teaches the harness HOW to translate each story's prose `given`
into concrete React props. Pattern:

```tsx
import type { ReactElement } from 'react';
import { MyComponent } from '../../../../src/webFull/components/MyComponent';
import { myComponentParityCatalog } from '../../../../src/webFull/components/MyComponent.parity.test';
import type { ParityStory } from '../registry';

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'my-component-happy-path-one':
			return <MyComponent prop1="value" prop2={42} />;
		case 'my-component-negative-path-one':
			return <MyComponent prop1="" />;
		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: myComponentParityCatalog as ParityStory[],
	render,
};

export default adapter;
```

For stories that require interaction sequences (click X, then re-render),
follow the `DismissalDriver` pattern in
`adapters/ContextWarningSash.adapter.tsx` — wrap the component in a tiny
local driver that performs the interaction on first paint and updates state
via `useState`.

### 3. Register the adapter in `tests/parity/harness/registry.ts`

Add one key under `registry`:

```ts
export const registry: Record<string, ComponentAdapter> = {
	ContextWarningSash: {
		load: () => import('./adapters/ContextWarningSash.adapter').then((m) => m.default),
	},
	MyComponent: {
		load: () => import('./adapters/MyComponent.adapter').then((m) => m.default),
	},
};
```

The lazy `import()` keeps the harness cold-load fast — only the adapter for
the story currently under test gets loaded.

### 4. Write a spec at `tests/parity/playwright-specs/<Name>.parity.spec.ts`

```ts
import { myComponentParityCatalog } from '../../../src/webFull/components/MyComponent.parity.test';
import { runParityCatalog } from '../runParityCatalog';
import type { ParityStory } from '../harness/registry';

runParityCatalog({
	componentKey: 'MyComponent',
	catalog: myComponentParityCatalog as ParityStory[],
});
```

### 5. Run it

```bash
npm run test:parity
```

The first run will boot a Vite dev server on `127.0.0.1:5180` and launch
chromium against each story.

## Verb coverage

The executor today supports two of the eight catalog verbs:

| Verb                | Supported | Notes                                                           |
| ------------------- | --------- | --------------------------------------------------------------- |
| `hasElement`        | yes       | Includes absence selectors (`body:not(:has(...))`).             |
| `hasText`           | yes       | `expect(...).toContainText(value)`.                             |
| `wsFrameMatches`    | no        | Skipped with a `[skipped: backend verbs not yet wired]` marker. |
| `dbHasRow`          | no        | Same.                                                           |
| `fsHas`             | no        | Same.                                                           |
| `processHas`        | no        | Same.                                                           |
| `notificationFired` | no        | Same.                                                           |
| `broadcast`         | no        | Same.                                                           |

The skip is intentional — the catalog file is the source of truth, and a story
that uses a backend verb stays in the catalog. The executor MARKS the test as
skipped (visible in the Playwright report) rather than silently passing or
mis-asserting. When the backend wire-up for those verbs lands, extend the
`switch` in `runParityCatalog.ts` accordingly.

## Why a custom harness instead of `@playwright/experimental-ct-react`

Two reasons. First, `@playwright/experimental-ct-react` is not yet a
dependency of this repo, and the catalog ports are happening in waves —
adding an experimental package is a bigger change than the gap it would close.
Second, the catalog files import `vitest` at the top (so they double as the
vitest catalog-shape suite); the experimental component-test runner has its
own preprocessor pipeline that conflicts with the vitest module-load side
effect. The custom harness uses Vite directly with a one-file `vitest`
browser shim, sidestepping both problems and staying in the territory the
fork already exercises (Vite + chromium).

## Current adoption

- **`ContextWarningSash`** — 8 stories, 8 passing. First adoption. See
  `tests/parity/playwright-specs/ContextWarningSash.parity.spec.ts`.

The remaining ~72 parity catalogs follow in subsequent waves — one adapter

- one spec per component. The runner is unchanged per addition.

## Coexistence with the existing E2E config

`tests/parity/playwright.parity.config.ts` is a sibling of the root
`playwright.config.ts` (which is wired for the Electron E2E suite at `./e2e/`).
They share `@playwright/test` but never collide:

- E2E config: `testDir: './e2e'`, `testMatch: '**/*.spec.ts'`
- Parity config: `testDir: './tests/parity/specs'`, `testMatch:
'**/*.parity.spec.ts'`

`npm run test:e2e` still launches the Electron app; `npm run test:parity`
boots a Vite dev server and runs catalog stories against the lifted webFull
components.
