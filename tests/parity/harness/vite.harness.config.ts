/**
 * Vite config for the parity harness dev server.
 *
 * Separate from `vite.config.webfull.mts` because:
 *   - root is `tests/parity/harness/` (not `src/webFull/`) — we serve a
 *     mount-by-query-string harness, not the real webFull SPA.
 *   - port is 5180 to stay clear of webFull dev (5176) and any other vite
 *     instances a developer may have running.
 *   - no proxy / manualChunks / sourcemap-heavy production tuning — this is
 *     a test-time harness, not a shippable surface.
 *
 * Loaded ONLY by `tests/parity/playwright.parity.config.ts` via its
 * `webServer` block. Never imported from product code.
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

// Vite resolves `__dirname` correctly when the config file is consumed via
// its CJS entry point. We don't use `import.meta.url` here because the repo
// `package.json` does not opt into `"type": "module"` and the sibling
// `vite.config.webfull.mts` relies on the same `.mts` / `__dirname` pairing.
const here = __dirname;
const repoRoot = path.resolve(here, '../../..');

export default defineConfig({
	plugins: [react()],
	root: here,
	publicDir: false,
	resolve: {
		alias: {
			'@renderer': path.join(repoRoot, 'src/renderer'),
			'@web': path.join(repoRoot, 'src/webFull'),
			'@shared': path.join(repoRoot, 'src/shared'),
			// Catalog files import `vitest` at the top — we swap it for a
			// permissive browser-side shim so `describe(...)` registration
			// doesn't throw inside the harness. See vitest-browser-shim.ts
			// for the rationale.
			vitest: path.join(here, 'vitest-browser-shim.ts'),
		},
	},
	server: {
		port: 5180,
		strictPort: true,
		host: '127.0.0.1',
	},
	optimizeDeps: {
		include: ['react', 'react-dom', 'lucide-react'],
		// Stop Vite from pre-bundling vitest (we alias it away anyway).
		exclude: ['vitest'],
	},
});
