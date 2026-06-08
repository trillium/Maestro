/**
 * Sentry utilities for error reporting in the webFull (browser) bundle.
 *
 * Mirrors the API surface of `src/main/utils/sentry.ts` (Electron main) and
 * `src/server/sentry.ts` (Node server) so that call sites can be shared or
 * swapped between the renderer, headless server, and webFull bundles without
 * signature churn. Backed by `@sentry/browser`.
 *
 * Lazy-load discipline:
 *   - `@sentry/browser` is only imported on first `initSentry()` call. Keeps
 *     the webFull cold-load fast for users who don't have a DSN configured
 *     and keeps `@sentry/*` out of the synchronous module graph.
 *   - DSN is read from Vite's build-time env (`import.meta.env`) under the
 *     key `MAESTRO_PUBLIC_SENTRY_DSN`. The `PUBLIC_` prefix follows the
 *     usual Vite convention for env vars that are safe to expose to the
 *     browser. If unset (or empty), `initSentry()` becomes a no-op and every
 *     subsequent capture call is also a no-op.
 *
 * Scaffold note: this module is NOT yet imported from `src/webFull/main.tsx`
 * or `src/webFull/App.tsx`. Wire-up is deferred to a follow-on change so
 * this commit doesn't collide with in-flight work on other layers. Once
 * wired, the webFull entrypoint should call `initSentry()` once before
 * mounting the React tree.
 */

/** Sentry severity levels (mirrors @sentry/types `SeverityLevel`). */
export type SentrySeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

/** Init options for the webFull Sentry wrapper. */
export interface InitSentryOptions {
	/**
	 * Sentry DSN. If omitted, falls back to
	 * `import.meta.env.MAESTRO_PUBLIC_SENTRY_DSN`. If neither is present,
	 * `initSentry` becomes a no-op.
	 */
	dsn?: string;
	/**
	 * Environment label (e.g. `'production'`, `'development'`). Defaults to
	 * `import.meta.env.MODE` when omitted.
	 */
	environment?: string;
}

/** Minimal shape of `@sentry/browser` we depend on. */
interface SentryBrowserModule {
	init: (options: {
		dsn: string;
		environment?: string;
	}) => void;
	captureException: (
		exception: unknown,
		captureContext?: { level?: SentrySeverityLevel; extra?: Record<string, unknown> }
	) => string;
	captureMessage: (
		message: string,
		captureContext?: { level?: SentrySeverityLevel; extra?: Record<string, unknown> }
	) => string;
}

/** Cached Sentry module reference (set on successful `initSentry`). */
let sentryModule: SentryBrowserModule | null = null;

/** Whether `initSentry` has been called and the SDK is live. */
let initialized = false;

/**
 * Vite-injected build-time env. Typed loosely so this module compiles cleanly
 * under any tsconfig (including the server-only build) without requiring the
 * Vite client types globally.
 */
interface ViteImportMetaEnv {
	MAESTRO_PUBLIC_SENTRY_DSN?: string;
	MODE?: string;
}
const viteEnv: ViteImportMetaEnv =
	typeof import.meta !== 'undefined' && (import.meta as { env?: ViteImportMetaEnv }).env
		? ((import.meta as { env: ViteImportMetaEnv }).env)
		: {};

/**
 * Initializes Sentry for the webFull browser bundle.
 *
 * No-op when no DSN is configured (neither `opts.dsn` nor
 * `import.meta.env.MAESTRO_PUBLIC_SENTRY_DSN` is set). When called multiple
 * times only the first call takes effect.
 *
 * @param opts - Init options. `dsn` overrides the build-time env var.
 *   `environment` defaults to `import.meta.env.MODE`.
 */
export function initSentry(opts?: InitSentryOptions): void {
	if (initialized) {
		return;
	}
	const dsn = opts?.dsn ?? viteEnv.MAESTRO_PUBLIC_SENTRY_DSN;
	if (!dsn) {
		// No DSN — stay un-initialized so subsequent capture calls remain no-ops.
		return;
	}
	// Lazy dynamic import: only pulls @sentry/browser into the bundle's
	// runtime when a DSN is actually configured. Vite/Rollup will code-split
	// this into a separate async chunk that production users without a DSN
	// never download.
	import('@sentry/browser')
		.then((sentry) => {
			const mod = sentry as unknown as SentryBrowserModule;
			mod.init({
				dsn,
				environment: opts?.environment ?? viteEnv.MODE,
			});
			sentryModule = mod;
			initialized = true;
		})
		.catch(() => {
			// @sentry/browser not installed or failed to initialize. Stay
			// un-initialized; subsequent capture calls become no-ops.
			// Intentionally swallowed — crash reporting failing must not break
			// the app.
		});
}

/**
 * Reports an exception to Sentry from the webFull bundle.
 *
 * No-op when `initSentry()` has not been called successfully (or has not
 * finished loading the SDK yet).
 *
 * @param err - The error to report
 * @param context - Additional context attached as `extra` on the Sentry event
 */
export function captureException(err: unknown, context?: Record<string, unknown>): void {
	if (!sentryModule) {
		return;
	}
	try {
		sentryModule.captureException(err, context ? { extra: context } : undefined);
	} catch {
		// Sentry-side failure — never propagate to the caller.
	}
}

/**
 * Reports a message to Sentry from the webFull bundle.
 *
 * No-op when `initSentry()` has not been called successfully (or has not
 * finished loading the SDK yet).
 *
 * @param msg - The message to report
 * @param level - Severity level (default: `'info'`)
 * @param context - Additional context attached as `extra` on the Sentry event
 */
export function captureMessage(
	msg: string,
	level: 'info' | 'warning' | 'error' = 'info',
	context?: Record<string, unknown>
): void {
	if (!sentryModule) {
		return;
	}
	try {
		sentryModule.captureMessage(msg, {
			level,
			...(context ? { extra: context } : {}),
		});
	} catch {
		// Sentry-side failure — never propagate to the caller.
	}
}
