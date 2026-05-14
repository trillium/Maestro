#!/usr/bin/env node
// maestro-p — wrapper binary that mimics `claude -p` semantics on the outside
// but drives Claude's interactive TUI on the inside, so usage falls under the
// user's Claude Max interactive quota instead of API billing.
//
// Phase 1 task 8: wires together args / TuiDriver / JsonEmitter /
// session-watcher / usage-parser into the two top-level modes (`run` and
// `--status`). See playbook MAESTRO-P-01-binary.md for the full contract.

import * as os from 'os';
import * as path from 'path';

import { parseArgs, type ParsedArgs } from './args';
import { TuiDriver } from './tui-driver';
import { JsonEmitter } from './json-emitter';
import { DEFAULT_TIMEOUT_MS, discoverSessionId } from './session-watcher';
import { parseUsage } from './usage-parser';
import { VERSION } from './package-info';

// Help text is hand-written rather than commander-generated so it stays in
// lockstep with the consumed / stripped / passthrough rules implemented in
// args.ts. Commander would over-claim ownership of unknown flags and silently
// drop the ones we want to forward to claude verbatim.
const HELP_TEXT = [
	'Usage: maestro-p [prompt] [...claude-flags]',
	'       maestro-p -p "<prompt>" [...claude-flags]',
	'       echo "<prompt>" | maestro-p [...claude-flags]',
	'       maestro-p --status [...claude-flags]',
	'',
	'Drive Claude Code interactively while emitting stream-json on stdout.',
	'',
	'Options:',
	'  -p, --print <text>     Prompt text (alias: --prompt). Mirrors `claude -p`.',
	'      --prompt <text>    Prompt text (alias for -p / --print).',
	'      --status           Run /usage in the TUI, emit one status JSON, exit.',
	'      --stream-thinking  Mirror ANSI-stripped TUI lines to stderr.',
	'      --max-wait <secs>  Hard timeout since last received byte (default 300).',
	'  -h, --help             Show this help and exit.',
	'  -V, --version          Print the maestro-p version and exit.',
	'',
	'Flag handling:',
	'  Consumed by maestro-p (not forwarded): -p, --print, --prompt, --status,',
	'    --stream-thinking, --max-wait, --help, --version.',
	'  Stripped with a warning (headless flags that would corrupt the TUI spawn):',
	'    --output-format, --input-format, --verbose.',
	'  Everything else is forwarded verbatim to the underlying `claude` invocation.',
	'',
	'Environment:',
	'  MAESTRO_CLAUDE_BIN  Override the `claude` binary location (default: PATH).',
	'  CLAUDE_CONFIG_DIR   Inherited by the spawned claude; switch Max accounts.',
	'',
	'Exit codes:',
	'  0  success',
	'  1  general failure (no prompt, parser error, TUI crashed, ...)',
	'  2  Claude quota limit hit during the run',
	'  3  --max-wait timeout (no bytes received for the configured window)',
	'',
].join('\n');

// `/usage` renders inline without a spinner cycle, so we can't lean on the
// TuiDriver's spinner-stop transition to know when the panel is done. Wait
// for this many ms of zero line events after sending /usage and treat that
// as "panel rendered." 1500ms covers a slow remote-account fetch comfortably.
const STATUS_QUIESCENCE_MS = 1500;

interface RuntimeOptions {
	binPath: string;
	cwd: string;
	configDir: string;
	parsed: ParsedArgs;
}

async function main(argv: string[]): Promise<number> {
	// Help/version take precedence over everything else and short-circuit
	// before parseArgs runs (parseArgs silently consumes those flags and has
	// no slot for them in its return type, matching commander's behavior).
	if (argv.includes('--help') || argv.includes('-h')) {
		process.stdout.write(HELP_TEXT);
		return 0;
	}
	if (argv.includes('--version') || argv.includes('-V')) {
		process.stdout.write(`${VERSION}\n`);
		return 0;
	}

	let parsed: ParsedArgs;
	try {
		parsed = parseArgs(argv);
	} catch (err) {
		process.stderr.write(`${(err as Error).message}\n`);
		return 1;
	}

	const opts: RuntimeOptions = {
		binPath: process.env.MAESTRO_CLAUDE_BIN ?? 'claude',
		cwd: process.cwd(),
		configDir: process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude'),
		parsed,
	};

	if (parsed.mode === 'status') {
		return runStatus(opts);
	}
	return runPrompt(opts);
}

async function runStatus(opts: RuntimeOptions): Promise<number> {
	const emitter = new JsonEmitter();
	const driver = new TuiDriver({
		binPath: opts.binPath,
		args: opts.parsed.passThroughArgs,
		cwd: opts.cwd,
		env: process.env,
	});

	const captured: string[] = [];
	driver.on('line', (line: string) => {
		captured.push(line);
		if (opts.parsed.streamThinking) {
			process.stderr.write(`${line}\n`);
		}
	});

	let exitedEarly = false;
	driver.on('exit', () => {
		exitedEarly = true;
	});

	try {
		await driver.start();
	} catch (err) {
		process.stderr.write(`maestro-p: failed to spawn claude: ${describeError(err)}\n`);
		return 1;
	}

	try {
		await waitForReady(driver);
	} catch {
		process.stderr.write('maestro-p: claude TUI exited before reaching ready state\n');
		return 1;
	}

	if (exitedEarly) {
		process.stderr.write('maestro-p: claude TUI exited before --status could run\n');
		return 1;
	}

	// Reset the buffer — only post-/usage lines feed the parser. Anything
	// captured during startup is chrome (welcome banner, MOTD, etc.).
	captured.length = 0;

	driver.send('/usage');
	await waitForQuiescence(driver, STATUS_QUIESCENCE_MS);

	const snapshot = parseUsage(captured.join('\n'), new Date().toISOString(), opts.configDir);

	if (snapshot === null) {
		process.stderr.write(
			'maestro-p: could not parse /usage output (expected three usage sections)\n'
		);
		await driver.quit();
		return 1;
	}

	emitter.emitStatus(snapshot);
	await driver.quit();
	return 0;
}

async function runPrompt(opts: RuntimeOptions): Promise<number> {
	if (opts.parsed.prompt === null || opts.parsed.prompt.trim() === '') {
		process.stderr.write(
			'maestro-p: no prompt provided (use -p, a positional arg, or pipe via stdin)\n'
		);
		return 1;
	}
	const prompt = opts.parsed.prompt;

	const emitter = new JsonEmitter();
	const startTime = Date.now();

	// Honor an explicit --resume <id> in the forwarded args; that id IS the
	// session_id by definition, so we skip fs-watch discovery entirely.
	const resumeSessionId = findResumeId(opts.parsed.passThroughArgs);

	// Mutable holder so the resolver below can update what init/result see
	// without coordinating with the event-emitter callbacks via a Promise.
	let discoveredSessionId: string | null = resumeSessionId;
	if (resumeSessionId === null) {
		// Fire-and-forget: the first-line handler reads whatever value has
		// landed by the time it runs. If discovery hasn't resolved yet, the
		// init event uses 'unknown' rather than blocking the stream. In
		// practice claude writes the jsonl very early in the session, so this
		// fallback rarely matters.
		void discoverSessionId({
			configDir: opts.configDir,
			cwd: opts.cwd,
			spawnTimestamp: Date.now(),
			timeoutMs: DEFAULT_TIMEOUT_MS,
		})
			.then((id) => {
				discoveredSessionId = id;
			})
			.catch(() => {
				// Watcher timed out or failed — falling back to 'unknown' is
				// the documented behavior. Don't surface to stderr; the
				// wrapper can still produce a valid stream-json envelope.
			});
	}

	const driver = new TuiDriver({
		binPath: opts.binPath,
		args: opts.parsed.passThroughArgs,
		cwd: opts.cwd,
		env: process.env,
	});

	let initEmitted = false;
	let limitHit = false;
	let finalized = false;
	let watchdog: NodeJS.Timeout | null = null;

	const emitInitOnce = (): void => {
		if (initEmitted) return;
		emitter.emitInit({
			sessionId: discoveredSessionId ?? 'unknown',
			cwd: opts.cwd,
		});
		initEmitted = true;
	};

	const finalize = async (result: {
		isError: boolean;
		error?: string;
		exitCode: number;
	}): Promise<void> => {
		if (finalized) return;
		finalized = true;
		if (watchdog) {
			clearTimeout(watchdog);
			watchdog = null;
		}

		// Init must precede result even in error paths where we never
		// received a content line. Falls back to 'unknown' if the watcher
		// race hasn't produced a real id by now.
		emitInitOnce();

		emitter.emitResult({
			sessionId: discoveredSessionId ?? 'unknown',
			durationMs: Date.now() - startTime,
			isError: result.isError,
			error: result.error,
		});

		await driver.quit();
		process.exit(result.exitCode);
	};

	const maxWaitMs = opts.parsed.maxWaitSeconds * 1000;
	const resetWatchdog = (): void => {
		if (finalized) return;
		if (watchdog) clearTimeout(watchdog);
		watchdog = setTimeout(() => {
			// If a limit message landed before the timeout, surface that as
			// the true cause — the timeout itself is downstream of the limit.
			void finalize({
				isError: true,
				error: limitHit ? 'limit_hit' : 'timeout',
				exitCode: limitHit ? 2 : 3,
			});
		}, maxWaitMs);
	};

	// The TuiDriver doesn't expose a per-chunk pulse event (out of scope for
	// task 3), so we approximate "byte received" with the events that DO
	// fire on every chunk we care about: content lines, new spinner cycles,
	// and limit-hit matches. Long stretches of "spinner ticking silently
	// with no content" would not refresh the watchdog, but that pattern
	// doesn't match Claude's actual generation cadence.
	driver.on('line', (line: string) => {
		resetWatchdog();
		if (opts.parsed.streamThinking) {
			process.stderr.write(`${line}\n`);
		}
		emitInitOnce();
		if (!finalized) {
			emitter.emitAssistantText(line);
		}
	});

	driver.on('spinner-start', () => {
		resetWatchdog();
	});

	driver.on('limit-hit', (line: string) => {
		// Capture but don't finalize yet — let the spinner-stop cycle run so
		// the result event lands after the human-readable limit message,
		// which often comes through as content.
		limitHit = true;
		if (opts.parsed.streamThinking) {
			process.stderr.write(`maestro-p: limit-hit observed: ${line}\n`);
		}
	});

	driver.on('spinner-stop', () => {
		void finalize({
			isError: limitHit,
			error: limitHit ? 'limit_hit' : undefined,
			exitCode: limitHit ? 2 : 0,
		});
	});

	driver.on('exit', (exitCode: number) => {
		if (!finalized) {
			void finalize({
				isError: true,
				error: `tui exited unexpectedly (code ${exitCode})`,
				exitCode: 1,
			});
		}
	});

	try {
		await driver.start();
	} catch (err) {
		process.stderr.write(`maestro-p: failed to spawn claude: ${describeError(err)}\n`);
		return 1;
	}

	try {
		await waitForReady(driver);
		resetWatchdog();
		driver.send(prompt);
	} catch {
		// TUI exited before the input prompt ever appeared. The 'exit'
		// listener registered above has already initiated finalize(); the
		// never-resolving promise below keeps this function alive until
		// finalize calls process.exit.
	}

	// finalize() calls process.exit, so this promise never resolves under
	// normal operation. Returning it satisfies the type contract while
	// keeping the event loop alive.
	return new Promise<number>(() => {
		/* never resolves — process.exit ends the run */
	});
}

function findResumeId(args: string[]): string | null {
	const prefix = '--resume=';
	for (let i = 0; i < args.length; i++) {
		if (args[i] === '--resume' && i + 1 < args.length) {
			return args[i + 1];
		}
		if (args[i].startsWith(prefix)) {
			return args[i].slice(prefix.length);
		}
	}
	return null;
}

function waitForReady(driver: TuiDriver): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		const onReady = (): void => {
			cleanup();
			resolve();
		};
		const onExit = (): void => {
			cleanup();
			reject(new Error('TUI exited before ready'));
		};
		const cleanup = (): void => {
			driver.off('ready', onReady);
			driver.off('exit', onExit);
		};
		driver.once('ready', onReady);
		driver.once('exit', onExit);
	});
}

function waitForQuiescence(driver: TuiDriver, idleMs: number): Promise<void> {
	return new Promise<void>((resolve) => {
		let timer: NodeJS.Timeout | null = null;
		let resolved = false;

		const finish = (): void => {
			if (resolved) return;
			resolved = true;
			if (timer) clearTimeout(timer);
			driver.off('line', onLine);
			driver.off('ready', onReady);
			driver.off('exit', onExit);
			resolve();
		};

		const onLine = (): void => {
			if (timer) clearTimeout(timer);
			timer = setTimeout(finish, idleMs);
		};
		const onReady = (): void => finish();
		const onExit = (): void => finish();

		driver.on('line', onLine);
		driver.on('ready', onReady);
		driver.on('exit', onExit);

		timer = setTimeout(finish, idleMs);
	});
}

function describeError(err: unknown): string {
	if (err instanceof Error) return err.message;
	return String(err);
}

main(process.argv.slice(2))
	.then((code) => process.exit(code))
	.catch((err) => {
		process.stderr.write(`maestro-p: ${describeError(err)}\n`);
		process.exit(1);
	});
