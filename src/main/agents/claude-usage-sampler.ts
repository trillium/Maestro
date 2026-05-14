/**
 * Sampler for `maestro-p --status`.
 *
 * Spawns the bundled `maestro-p` wrapper in --status mode under a specific
 * `CLAUDE_CONFIG_DIR` (and `MAESTRO_CLAUDE_BIN`), reads the single JSON line it
 * writes to stdout, and maps it onto the canonical `UsageSnapshot` shape the
 * mode selector and usage store both consume.
 *
 * Failure handling: every error path (spawn ENOENT, timeout, non-zero exit,
 * non-JSON stdout, missing fields) reports to Sentry with `captureMessage` and
 * returns `null`. Callers — the spawner under `headlessMode === 'auto'`, the
 * startup lifecycle hook, and any future on-demand refresh trigger — already
 * have to handle "no snapshot available" via the selector's null branch, so
 * surfacing null is the cheapest contract for this primitive to honor.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';

import { resolveConfigDirKey } from '../stores/claudeUsageStore';
import { captureMessage } from '../utils/sentry';
import type { UsageSnapshot } from './claude-mode-selector';

const execFileAsync = promisify(execFile);

/** Default ceiling on the entire `maestro-p --status` run. Matches the value used inside maestro-p itself for its TUI ready/quiesce windows. */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Cap stdout at 1MB. The expected payload is <1KB; this only matters if the wrapper goes pathological. */
const MAX_BUFFER_BYTES = 1024 * 1024;

export interface SampleUsageOptions {
	/**
	 * Absolute path to the bundled `maestro-p.js` file. Invoked via `process.execPath`
	 * (the same node binary running Maestro) so we don't depend on a `maestro-p`
	 * shim being on the user's PATH.
	 */
	binPath: string;
	/**
	 * Overrides `CLAUDE_CONFIG_DIR` for the spawned wrapper. Takes precedence over any
	 * value supplied via `customEnvVars`. Omit to inherit whatever the current
	 * process has (which is what tabs without an explicit account override would see).
	 */
	configDir?: string;
	/** Working directory for the child process. */
	cwd: string;
	/**
	 * Extra environment variables merged into the child's env. The caller is
	 * responsible for setting `MAESTRO_CLAUDE_BIN` here so maestro-p knows which real
	 * `claude` binary to drive (defaults to PATH lookup if absent — usually fine in
	 * developer environments, never relied on in production).
	 */
	customEnvVars?: Record<string, string>;
	/** Hard timeout for the run; defaults to {@link DEFAULT_TIMEOUT_MS}. */
	timeoutMs?: number;
}

/** Wire shape emitted by `maestro-p --status` (see `src/maestro-p/json-emitter.ts`). */
interface RawStatusJson {
	type: 'status';
	config_dir: string;
	session: { percent: number; resets_at: string };
	week_all_models: { percent: number; resets_at: string };
	week_sonnet_only: { percent: number; resets_at: string };
}

/**
 * Sample the current Claude usage panel via `maestro-p --status`. Returns null on
 * any failure; never throws. Successful return is a fully-populated `UsageSnapshot`
 * with `sampledAt` set to "now" and `configDirKey` canonicalized from the resolved
 * env (NOT from the wrapper's `config_dir` echo — `resolveConfigDirKey()` is the
 * single source of truth so keys stay consistent across consumers).
 */
export async function sampleUsage(opts: SampleUsageOptions): Promise<UsageSnapshot | null> {
	const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

	const childEnv: NodeJS.ProcessEnv = {
		...process.env,
		...(opts.customEnvVars ?? {}),
	};
	// Explicit `configDir` arg wins over any CLAUDE_CONFIG_DIR smuggled in via
	// customEnvVars or process.env — it's the more specific slot.
	if (opts.configDir !== undefined) {
		childEnv.CLAUDE_CONFIG_DIR = opts.configDir;
	}

	let stdout: string;
	try {
		const result = await execFileAsync(process.execPath, [opts.binPath, '--status'], {
			cwd: opts.cwd,
			env: childEnv,
			timeout: timeoutMs,
			maxBuffer: MAX_BUFFER_BYTES,
			encoding: 'utf8',
		});
		stdout = result.stdout;
	} catch (err) {
		await captureMessage('maestro-p --status sample failed', 'warning', {
			stage: 'spawn',
			binPath: opts.binPath,
			configDir: opts.configDir,
			reason: describeSpawnError(err),
		});
		return null;
	}

	const raw = parseStatusLine(stdout);
	if (raw === null) {
		await captureMessage('maestro-p --status sample failed', 'warning', {
			stage: 'parse',
			binPath: opts.binPath,
			configDir: opts.configDir,
			stdoutHead: stdout.slice(0, 200),
		});
		return null;
	}

	return {
		sampledAt: new Date().toISOString(),
		configDirKey: resolveConfigDirKey(childEnv),
		session: { percent: raw.session.percent, resetsAt: raw.session.resets_at },
		weekAllModels: {
			percent: raw.week_all_models.percent,
			resetsAt: raw.week_all_models.resets_at,
		},
		weekSonnetOnly: {
			percent: raw.week_sonnet_only.percent,
			resetsAt: raw.week_sonnet_only.resets_at,
		},
	};
}

/**
 * Pull the single JSONL status object out of stdout. Tolerates a leading node
 * deprecation warning or stray blank lines by scanning for the first line that
 * looks like a JSON object — maestro-p's `--status` mode emits exactly one such
 * line, so this is unambiguous.
 */
function parseStatusLine(stdout: string): RawStatusJson | null {
	const lines = stdout.split(/\r?\n/);
	for (const line of lines) {
		const trimmed = line.trim();
		if (trimmed === '' || trimmed[0] !== '{') {
			continue;
		}
		try {
			const parsed: unknown = JSON.parse(trimmed);
			return isStatusJson(parsed) ? parsed : null;
		} catch {
			return null;
		}
	}
	return null;
}

function isStatusJson(value: unknown): value is RawStatusJson {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	if (v.type !== 'status') return false;
	if (typeof v.config_dir !== 'string') return false;
	return isSection(v.session) && isSection(v.week_all_models) && isSection(v.week_sonnet_only);
}

function isSection(value: unknown): value is { percent: number; resets_at: string } {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return typeof v.percent === 'number' && typeof v.resets_at === 'string';
}

/**
 * Boil a node child_process error down to a short tag suitable for the Sentry
 * `reason` field. We avoid attaching the full Error to the extra payload because
 * it tends to carry the user's env and cwd — better to keep the report narrow.
 */
function describeSpawnError(err: unknown): string {
	if (err && typeof err === 'object') {
		const e = err as {
			code?: string | number;
			killed?: boolean;
			signal?: string | null;
			message?: string;
		};
		// node sets killed=true + signal=SIGTERM when its own timeout fires.
		if (e.killed && (e.signal === 'SIGTERM' || e.code === 'ETIMEDOUT')) {
			return 'timeout';
		}
		if (typeof e.code === 'string') return e.code;
		if (typeof e.code === 'number') return `exit_${e.code}`;
		if (typeof e.message === 'string' && e.message.length > 0) return e.message;
	}
	return String(err);
}
