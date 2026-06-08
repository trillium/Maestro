/**
 * Sentry utilities for error reporting in the headless server process.
 *
 * Mirrors the API surface of `src/main/utils/sentry.ts` (Electron main) so that
 * call sites can be migrated between desktop-main and headless-server without
 * signature churn. Backed by `@sentry/node` instead of the Electron-main Sentry
 * SDK used by the desktop wrapper.
 *
 * Lazy-load discipline (carried over from the main-process wrapper):
 *   - The Sentry SDK is only imported on first capture call. This keeps cold
 *     boot fast for development runs that never set `MAESTRO_SENTRY_DSN` and
 *     it keeps the module import graph free of @sentry/* until something
 *     actually wants to report.
 *   - `initSentry()` is the explicit init hook. If no DSN is configured (via
 *     `opts.dsn` or `process.env.MAESTRO_SENTRY_DSN`) the call is a no-op and
 *     every subsequent `captureException` / `captureMessage` is also a no-op.
 *
 * Scaffold note: this module is NOT yet imported from `src/server/index.ts`.
 * Wire-up is deferred to a follow-on change so this commit doesn't collide
 * with in-flight work on `layer-0c-remaining-writes`. Once wired, the server
 * boot path should call `initSentry()` once before constructing `WebServer`.
 */

/** Sentry severity levels (mirrors @sentry/types `SeverityLevel`). */
export type SentrySeverityLevel = 'fatal' | 'error' | 'warning' | 'log' | 'info' | 'debug';

/** Init options for the headless server Sentry wrapper. */
export interface InitSentryOptions {
	/**
	 * Sentry DSN. If omitted, falls back to `process.env.MAESTRO_SENTRY_DSN`.
	 * If neither is present, `initSentry` becomes a no-op.
	 */
	dsn?: string;
	/**
	 * Environment label (e.g. `'production'`, `'development'`). Defaults to
	 * `process.env.NODE_ENV` when omitted.
	 */
	environment?: string;
}

/** Minimal shape of `@sentry/node` we depend on. Avoids a hard import-time dep. */
interface SentryNodeModule {
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
let sentryModule: SentryNodeModule | null = null;

/** Whether `initSentry` has been called and the SDK is live. */
let initialized = false;

/**
 * Initializes Sentry for the headless server process.
 *
 * No-op when no DSN is configured (neither `opts.dsn` nor
 * `process.env.MAESTRO_SENTRY_DSN` is set). When called multiple times only
 * the first call takes effect.
 *
 * @param opts - Init options. `dsn` overrides the env var. `environment`
 *   defaults to `process.env.NODE_ENV`.
 */
export function initSentry(opts?: InitSentryOptions): void {
	if (initialized) {
		return;
	}
	const dsn = opts?.dsn ?? process.env.MAESTRO_SENTRY_DSN;
	if (!dsn) {
		// No DSN — stay un-initialized so subsequent capture calls remain no-ops.
		return;
	}
	try {
		// Lazy require: only pulls @sentry/node into the module graph when a
		// DSN is actually configured. Use require() rather than dynamic import
		// to keep `initSentry` synchronous (the caller is typically a top-of-
		// boot init line and doesn't want to await).
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const sentry = require('@sentry/node') as SentryNodeModule;
		sentry.init({
			dsn,
			environment: opts?.environment ?? process.env.NODE_ENV,
		});
		sentryModule = sentry;
		initialized = true;
	} catch {
		// @sentry/node not installed or failed to initialize. Stay un-initialized;
		// subsequent capture calls become no-ops. Intentionally swallowed —
		// crash reporting failing must not crash the server.
	}
}

/**
 * Reports an exception to Sentry from the headless server process.
 *
 * No-op when `initSentry()` has not been called successfully.
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
 * Reports a message to Sentry from the headless server process.
 *
 * No-op when `initSentry()` has not been called successfully.
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
