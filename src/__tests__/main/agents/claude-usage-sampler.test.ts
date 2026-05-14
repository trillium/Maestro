import { describe, it, expect, vi, beforeEach } from 'vitest';
import os from 'os';
import path from 'path';

// Single mock function backing both the child_process and util.promisify mocks.
// Hoisted so the vi.mock factories below (which are themselves hoisted above all
// imports) can reach it without the TDZ "Cannot access 'mockExecFile' before
// initialization" error vitest 4.x surfaces in that ordering.
const { mockExecFile } = vi.hoisted(() => ({ mockExecFile: vi.fn() }));

vi.mock('child_process', async (importOriginal) => {
	const actual = await importOriginal<typeof import('child_process')>();
	return {
		...actual,
		default: { ...actual, execFile: mockExecFile },
		execFile: mockExecFile,
	};
});

vi.mock('util', async (importOriginal) => {
	const actual = await importOriginal<typeof import('util')>();
	const promisifyMock = (fn: unknown): unknown => {
		if (fn === mockExecFile) {
			return async (...args: unknown[]) =>
				new Promise((resolve, reject) => {
					mockExecFile(...args, (error: Error | null, stdout: string, stderr: string) => {
						if (error) reject(error);
						else resolve({ stdout, stderr });
					});
				});
		}
		return actual.promisify(fn as never);
	};
	return {
		...actual,
		default: { ...actual, promisify: promisifyMock },
		promisify: promisifyMock,
	};
});

vi.mock('../../../main/utils/sentry', () => ({
	captureMessage: vi.fn().mockResolvedValue(undefined),
}));

// electron-store mock used by claudeUsageStore — we never actually touch the store
// in these tests (sampleUsage only imports resolveConfigDirKey), but importing the
// module pulls electron-store in, and the real module isn't available outside the
// electron runtime.
vi.mock('electron-store', () => {
	class MockStore<T extends Record<string, unknown>> {
		private state: Record<string, unknown>;
		constructor(options: { defaults?: T } = {}) {
			this.state = { ...(options.defaults ?? {}) };
		}
		get<K extends keyof T>(key: K, defaultValue?: T[K]): T[K] {
			const value = this.state[key as string];
			return (value === undefined ? defaultValue : value) as T[K];
		}
		set<K extends keyof T>(key: K, value: T[K]): void {
			this.state[key as string] = value;
		}
	}
	return { default: MockStore };
});

import { sampleUsage } from '../../../main/agents/claude-usage-sampler';
import { captureMessage } from '../../../main/utils/sentry';

const mockedCaptureMessage = vi.mocked(captureMessage);

interface CapturedCall {
	command: string;
	args: readonly string[];
	options: { cwd?: string; env?: NodeJS.ProcessEnv; timeout?: number; maxBuffer?: number };
}

/**
 * Convenience helper — set up `mockExecFile` to capture its invocation arguments
 * and invoke the callback with either success (stdout/stderr) or an Error.
 */
type ExecError = Error & { code?: string | number; killed?: boolean; signal?: string };

function stubExecFile(
	result: { ok: true; stdout: string; stderr?: string } | { ok: false; error: ExecError }
): CapturedCall[] {
	const calls: CapturedCall[] = [];
	mockExecFile.mockImplementation(
		(
			command: string,
			args: readonly string[],
			options: {
				cwd?: string;
				env?: NodeJS.ProcessEnv;
				timeout?: number;
				maxBuffer?: number;
			},
			callback: (err: Error | null, stdout: string, stderr: string) => void
		) => {
			calls.push({ command, args, options });
			if (result.ok) {
				callback(null, result.stdout, result.stderr ?? '');
			} else {
				callback(result.error, '', '');
			}
			return {} as never;
		}
	);
	return calls;
}

function buildStatusJsonLine(
	overrides: Partial<{
		config_dir: string;
		session: { percent: number; resets_at: string };
		week_all_models: { percent: number; resets_at: string };
		week_sonnet_only: { percent: number; resets_at: string };
	}> = {}
): string {
	const payload = {
		type: 'status',
		config_dir: '/Users/test/.claude',
		session: { percent: 42, resets_at: '2026-05-13T17:00:00Z' },
		week_all_models: { percent: 30, resets_at: '2026-05-20T00:00:00Z' },
		week_sonnet_only: { percent: 25, resets_at: '2026-05-20T00:00:00Z' },
		...overrides,
	};
	return `${JSON.stringify(payload)}\n`;
}

describe('sampleUsage', () => {
	beforeEach(() => {
		mockExecFile.mockReset();
		mockedCaptureMessage.mockClear();
	});

	describe('happy path', () => {
		it('parses a valid maestro-p --status JSON line into a UsageSnapshot', async () => {
			stubExecFile({ ok: true, stdout: buildStatusJsonLine() });

			const before = Date.now();
			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});
			const after = Date.now();

			expect(snapshot).not.toBeNull();
			expect(snapshot!.session).toEqual({ percent: 42, resetsAt: '2026-05-13T17:00:00Z' });
			expect(snapshot!.weekAllModels).toEqual({
				percent: 30,
				resetsAt: '2026-05-20T00:00:00Z',
			});
			expect(snapshot!.weekSonnetOnly).toEqual({
				percent: 25,
				resetsAt: '2026-05-20T00:00:00Z',
			});
			// sampledAt is set to "now" by the sampler, not lifted from the wire payload.
			const sampledAtMs = new Date(snapshot!.sampledAt).getTime();
			expect(sampledAtMs).toBeGreaterThanOrEqual(before);
			expect(sampledAtMs).toBeLessThanOrEqual(after);
		});

		it('invokes process.execPath with [binPath, --status] and the assembled env', async () => {
			const calls = stubExecFile({ ok: true, stdout: buildStatusJsonLine() });

			await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
				configDir: '/Users/x/.claude-gmail',
				customEnvVars: { MAESTRO_CLAUDE_BIN: '/usr/local/bin/claude' },
			});

			expect(calls).toHaveLength(1);
			expect(calls[0].command).toBe(process.execPath);
			expect(calls[0].args).toEqual(['/abs/path/maestro-p.js', '--status']);
			expect(calls[0].options.cwd).toBe('/some/cwd');
			expect(calls[0].options.env?.CLAUDE_CONFIG_DIR).toBe('/Users/x/.claude-gmail');
			expect(calls[0].options.env?.MAESTRO_CLAUDE_BIN).toBe('/usr/local/bin/claude');
		});

		it('keys the snapshot by the canonicalized CLAUDE_CONFIG_DIR (not the wire echo)', async () => {
			// The wire payload claims a different config_dir than what we passed via
			// configDir. The snapshot should be keyed against the env we resolved, not
			// what maestro-p thinks it saw — keeps consumers consistent.
			stubExecFile({
				ok: true,
				stdout: buildStatusJsonLine({ config_dir: '/something/else/entirely' }),
			});

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
				configDir: '/Users/x/./.claude-gmail',
			});

			expect(snapshot!.configDirKey).toBe(path.resolve('/Users/x/./.claude-gmail'));
		});

		it('falls back to ~/.claude for the key when no configDir is supplied', async () => {
			stubExecFile({ ok: true, stdout: buildStatusJsonLine() });

			// Scrub CLAUDE_CONFIG_DIR from the inherited process.env so the fallback path
			// is exercised. Restore after the test to keep other suites unaffected.
			const original = process.env.CLAUDE_CONFIG_DIR;
			delete process.env.CLAUDE_CONFIG_DIR;
			try {
				const snapshot = await sampleUsage({
					binPath: '/abs/path/maestro-p.js',
					cwd: '/some/cwd',
				});
				expect(snapshot!.configDirKey).toBe(path.resolve(path.join(os.homedir(), '.claude')));
			} finally {
				if (original === undefined) delete process.env.CLAUDE_CONFIG_DIR;
				else process.env.CLAUDE_CONFIG_DIR = original;
			}
		});

		it('explicit configDir arg wins over a CLAUDE_CONFIG_DIR smuggled via customEnvVars', async () => {
			const calls = stubExecFile({ ok: true, stdout: buildStatusJsonLine() });

			await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
				configDir: '/explicit/.claude',
				customEnvVars: { CLAUDE_CONFIG_DIR: '/sneaky/.claude' },
			});

			expect(calls[0].options.env?.CLAUDE_CONFIG_DIR).toBe('/explicit/.claude');
		});

		it('honors a custom timeoutMs', async () => {
			const calls = stubExecFile({ ok: true, stdout: buildStatusJsonLine() });

			await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
				timeoutMs: 5_000,
			});

			expect(calls[0].options.timeout).toBe(5_000);
		});

		it('uses a 30s default timeout when none is provided', async () => {
			const calls = stubExecFile({ ok: true, stdout: buildStatusJsonLine() });

			await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(calls[0].options.timeout).toBe(30_000);
		});

		it('tolerates a node deprecation warning prefixed before the JSON line', async () => {
			// Real-world: node 22 prints a (node:1234) DeprecationWarning to stdout
			// under some flags. Sampler should skip non-JSON lines.
			const stdout = `(node:1234) DeprecationWarning: punycode is deprecated\n${buildStatusJsonLine()}`;
			stubExecFile({ ok: true, stdout });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).not.toBeNull();
			expect(snapshot!.session.percent).toBe(42);
		});
	});

	describe('failure modes', () => {
		it('returns null and reports to Sentry when the spawn errors with ENOENT', async () => {
			const enoent: ExecError = Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' });
			stubExecFile({ ok: false, error: enoent });

			const snapshot = await sampleUsage({
				binPath: '/nope/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
			expect(mockedCaptureMessage).toHaveBeenCalledWith(
				'maestro-p --status sample failed',
				'warning',
				expect.objectContaining({
					stage: 'spawn',
					binPath: '/nope/maestro-p.js',
					reason: 'ENOENT',
				})
			);
		});

		it('returns null and reports "timeout" when the child is killed via SIGTERM', async () => {
			const timeoutErr: ExecError = Object.assign(new Error('Command failed'), {
				killed: true,
				signal: 'SIGTERM',
			});
			stubExecFile({ ok: false, error: timeoutErr });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
			expect(mockedCaptureMessage).toHaveBeenCalledWith(
				'maestro-p --status sample failed',
				'warning',
				expect.objectContaining({ stage: 'spawn', reason: 'timeout' })
			);
		});

		it('returns null and reports "exit_<code>" for non-zero exit codes', async () => {
			const nonZero: ExecError = Object.assign(new Error('Command failed'), { code: 1 });
			stubExecFile({ ok: false, error: nonZero });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
			expect(mockedCaptureMessage).toHaveBeenCalledWith(
				'maestro-p --status sample failed',
				'warning',
				expect.objectContaining({ stage: 'spawn', reason: 'exit_1' })
			);
		});

		it('returns null when stdout is empty', async () => {
			stubExecFile({ ok: true, stdout: '' });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
			expect(mockedCaptureMessage).toHaveBeenCalledWith(
				'maestro-p --status sample failed',
				'warning',
				expect.objectContaining({ stage: 'parse' })
			);
		});

		it('returns null when stdout is not valid JSON', async () => {
			stubExecFile({ ok: true, stdout: '{this is not valid json}\n' });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
			expect(mockedCaptureMessage).toHaveBeenCalledWith(
				'maestro-p --status sample failed',
				'warning',
				expect.objectContaining({ stage: 'parse', stdoutHead: expect.any(String) })
			);
		});

		it('returns null when the JSON object is missing required fields', async () => {
			// Has type=status but no week_sonnet_only section.
			const malformed = JSON.stringify({
				type: 'status',
				config_dir: '/x/.claude',
				session: { percent: 5, resets_at: '2026-05-13T17:00:00Z' },
				week_all_models: { percent: 10, resets_at: '2026-05-20T00:00:00Z' },
			});
			stubExecFile({ ok: true, stdout: `${malformed}\n` });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
			expect(mockedCaptureMessage).toHaveBeenCalledWith(
				'maestro-p --status sample failed',
				'warning',
				expect.objectContaining({ stage: 'parse' })
			);
		});

		it('returns null when type !== "status"', async () => {
			const wrongType = JSON.stringify({
				type: 'system',
				config_dir: '/x/.claude',
				session: { percent: 5, resets_at: '2026-05-13T17:00:00Z' },
				week_all_models: { percent: 10, resets_at: '2026-05-20T00:00:00Z' },
				week_sonnet_only: { percent: 15, resets_at: '2026-05-20T00:00:00Z' },
			});
			stubExecFile({ ok: true, stdout: `${wrongType}\n` });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
		});

		it('returns null when a section has a non-numeric percent', async () => {
			const badPercent = JSON.stringify({
				type: 'status',
				config_dir: '/x/.claude',
				session: { percent: 'forty-two', resets_at: '2026-05-13T17:00:00Z' },
				week_all_models: { percent: 10, resets_at: '2026-05-20T00:00:00Z' },
				week_sonnet_only: { percent: 15, resets_at: '2026-05-20T00:00:00Z' },
			});
			stubExecFile({ ok: true, stdout: `${badPercent}\n` });

			const snapshot = await sampleUsage({
				binPath: '/abs/path/maestro-p.js',
				cwd: '/some/cwd',
			});

			expect(snapshot).toBeNull();
		});

		it('never throws — every failure path resolves to null', async () => {
			const exotic: ExecError = Object.assign(new Error('something weird'), {});
			stubExecFile({ ok: false, error: exotic });

			await expect(
				sampleUsage({ binPath: '/abs/path/maestro-p.js', cwd: '/some/cwd' })
			).resolves.toBeNull();
		});
	});
});
