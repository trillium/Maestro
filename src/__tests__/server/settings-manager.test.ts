/**
 * SettingsManager — unit tests for the Audit #14 disk-backing port.
 *
 * Covers the four contract points called out in the audit:
 *
 *   1. **server reads on boot** — a pre-populated `maestro-settings.json`
 *      is loaded into memory by `load()`, and `getSettings()` returns
 *      the persisted values without any further disk read.
 *   2. **persists on set** — `setSettings(patch)` writes through to disk
 *      under the same `<dataDir>/maestro-settings.json` filename used by
 *      the existing electron-store / FileStore surface.
 *   3. **atomic-write resilience** — the writer goes through a
 *      `<file>.tmp` → `rename` sequence, so a process kill mid-write
 *      cannot leave a half-written `maestro-settings.json`.
 *   4. **default-empty case** — a missing file produces an empty
 *      `{}` snapshot (not a crash), and the first write creates the
 *      file fresh.
 *
 * Tests stay on the local filesystem under `os.tmpdir()` — no FileStore,
 * no Fastify, no providers. The manager's only external dependency is
 * `fs/promises`, which is exercised directly.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { SettingsManager, _resetSettingsManager } from '../../server/settings-manager';

async function makeTmpDir(): Promise<string> {
	return fs.mkdtemp(path.join(os.tmpdir(), 'maestro-settings-manager-'));
}

async function rmDirSafe(dir: string): Promise<void> {
	try {
		await fs.rm(dir, { recursive: true, force: true });
	} catch {
		/* ignore */
	}
}

describe('SettingsManager', () => {
	let dataDir: string;

	beforeEach(async () => {
		dataDir = await makeTmpDir();
		_resetSettingsManager();
	});

	afterEach(async () => {
		await rmDirSafe(dataDir);
	});

	describe('server reads on boot', () => {
		it('loads an existing maestro-settings.json into memory', async () => {
			// Pre-populate the file with the same schema electron-store writes.
			const filePath = path.join(dataDir, 'maestro-settings.json');
			await fs.writeFile(
				filePath,
				JSON.stringify({ conductorProfile: 'concise', fontSize: 16 }, null, 2),
				'utf-8'
			);

			const mgr = new SettingsManager({ dataDir });
			await mgr.load();

			const snapshot = mgr.getSettings();
			expect(snapshot).toEqual({ conductorProfile: 'concise', fontSize: 16 });
			expect(mgr.isDegraded()).toBe(false);
		});

		it('returns a defensive copy from getSettings()', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			mgr.setSettings({ key: 'one' });

			const snapshot = mgr.getSettings();
			(snapshot as Record<string, unknown>).key = 'mutated-externally';

			// Re-read should NOT reflect the external mutation.
			expect(mgr.getSettings()).toEqual({ key: 'one' });

			// Drain the write queue before afterEach removes the tmpdir, so
			// the queued async write doesn't race against the cleanup and
			// log an EINVAL on the way out (the test result is correct
			// either way; this just keeps the stderr clean).
			await mgr.flush();
		});

		it('load() is idempotent', async () => {
			const filePath = path.join(dataDir, 'maestro-settings.json');
			await fs.writeFile(filePath, JSON.stringify({ a: 1 }), 'utf-8');

			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			// Mutate the file post-load. A second `load()` should be a no-op.
			await fs.writeFile(filePath, JSON.stringify({ a: 2 }), 'utf-8');
			await mgr.load();

			expect(mgr.getSettings()).toEqual({ a: 1 });
		});
	});

	describe('persists on set', () => {
		it('writes a single-key patch through to disk', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			mgr.setSettings({ conductorProfile: 'verbose' });
			await mgr.flush();

			const onDisk = JSON.parse(
				await fs.readFile(path.join(dataDir, 'maestro-settings.json'), 'utf-8')
			);
			expect(onDisk).toEqual({ conductorProfile: 'verbose' });
		});

		it('merges multi-key patches shallowly at the top level', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			mgr.setSettings({ a: 1, b: { nested: 'orig' } });
			await mgr.flush();
			mgr.setSettings({ b: { nested: 'overwrite' }, c: 3 });
			await mgr.flush();

			const onDisk = JSON.parse(
				await fs.readFile(path.join(dataDir, 'maestro-settings.json'), 'utf-8')
			);
			expect(onDisk).toEqual({ a: 1, b: { nested: 'overwrite' }, c: 3 });
		});

		it('returns a snapshot synchronously from setSettings() before disk write completes', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();

			const returned = mgr.setSettings({ k: 'v' });
			// Synchronously-returned snapshot reflects the write.
			expect(returned).toEqual({ k: 'v' });
			// And the in-memory cache does too — even before flush().
			expect(mgr.getSettings()).toEqual({ k: 'v' });

			await mgr.flush();
		});

		it('serializes concurrent setSettings() calls through the write chain', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();

			// Issue 5 sequential patches without awaiting flush in between.
			mgr.setSettings({ counter: 1 });
			mgr.setSettings({ counter: 2 });
			mgr.setSettings({ counter: 3 });
			mgr.setSettings({ counter: 4 });
			mgr.setSettings({ counter: 5 });

			await mgr.flush();

			const onDisk = JSON.parse(
				await fs.readFile(path.join(dataDir, 'maestro-settings.json'), 'utf-8')
			);
			expect(onDisk).toEqual({ counter: 5 });
		});

		it('creates the data dir if it does not exist yet', async () => {
			// Use a nested path that does not exist yet to exercise mkdir.
			const nested = path.join(dataDir, 'nested', 'deeper');
			const mgr = new SettingsManager({ dataDir: nested });
			await mgr.load();
			mgr.setSettings({ k: 'v' });
			await mgr.flush();

			const onDisk = JSON.parse(
				await fs.readFile(path.join(nested, 'maestro-settings.json'), 'utf-8')
			);
			expect(onDisk).toEqual({ k: 'v' });
		});
	});

	describe('atomic-write resilience', () => {
		it('uses a .tmp + rename sequence (verified via post-write directory listing)', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			mgr.setSettings({ k: 'v' });
			await mgr.flush();

			// After a clean write, only the target file should exist — the
			// `.tmp` file is gone because `rename()` moved it onto the target.
			const entries = await fs.readdir(dataDir);
			expect(entries).toContain('maestro-settings.json');
			expect(entries).not.toContain('maestro-settings.json.tmp');
		});

		it('does not corrupt the existing file when a write fails mid-stream', async () => {
			// Pre-populate a good on-disk state.
			const filePath = path.join(dataDir, 'maestro-settings.json');
			await fs.writeFile(filePath, JSON.stringify({ original: true }), 'utf-8');

			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			expect(mgr.getSettings()).toEqual({ original: true });

			// Simulate a failure between writeFile and rename by replacing
			// the target with a directory of the same name as the .tmp file.
			// This makes the `rename(tmp, file)` step fail (cannot rename
			// onto a directory). The original file should be intact afterward.
			const tmpAsDir = `${filePath}.tmp`;
			await fs.mkdir(tmpAsDir);
			// Make it non-empty so the writer's writeFile(tmp, ...) fails too
			// (writing a file over a non-empty directory is an EISDIR).
			await fs.writeFile(path.join(tmpAsDir, 'block'), 'x', 'utf-8');

			mgr.setSettings({ original: false, newkey: 'newval' });
			await mgr.flush();

			// The original file is unchanged on disk.
			const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
			expect(onDisk).toEqual({ original: true });

			// Clean up the simulated-failure directory before afterEach so the
			// rm-rf cleanup doesn't have to handle the nested dir specially.
			await fs.rm(tmpAsDir, { recursive: true, force: true });
		});

		it('subsequent successful write recovers after a failed write', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();

			// Force a failure with the directory trick from the previous test.
			const tmpAsDir = path.join(dataDir, 'maestro-settings.json.tmp');
			await fs.mkdir(tmpAsDir);
			await fs.writeFile(path.join(tmpAsDir, 'block'), 'x', 'utf-8');

			mgr.setSettings({ first: 'attempt' });
			await mgr.flush();

			// In-memory snapshot still has the patch even though disk failed.
			expect(mgr.getSettings()).toEqual({ first: 'attempt' });

			// Remove the blocker and patch again — the second write replaces
			// the orphan .tmp via `writeFile` (overwrite) + `rename`.
			await fs.rm(tmpAsDir, { recursive: true, force: true });

			mgr.setSettings({ first: 'attempt', second: 'wins' });
			await mgr.flush();

			const onDisk = JSON.parse(
				await fs.readFile(path.join(dataDir, 'maestro-settings.json'), 'utf-8')
			);
			expect(onDisk).toEqual({ first: 'attempt', second: 'wins' });
		});
	});

	describe('default-empty case', () => {
		it('returns {} when the file is missing (first boot)', async () => {
			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			expect(mgr.getSettings()).toEqual({});
			expect(mgr.isDegraded()).toBe(false);
		});

		it('first write after a default-empty load creates the file', async () => {
			const filePath = path.join(dataDir, 'maestro-settings.json');
			await expect(fs.access(filePath)).rejects.toThrow();

			const mgr = new SettingsManager({ dataDir });
			await mgr.load();
			mgr.setSettings({ created: true });
			await mgr.flush();

			const onDisk = JSON.parse(await fs.readFile(filePath, 'utf-8'));
			expect(onDisk).toEqual({ created: true });
		});

		it('falls back to {} on a corrupted JSON file and flags degraded', async () => {
			const filePath = path.join(dataDir, 'maestro-settings.json');
			await fs.writeFile(filePath, '{not valid json', 'utf-8');

			const mgr = new SettingsManager({ dataDir });
			await mgr.load();

			expect(mgr.getSettings()).toEqual({});
			expect(mgr.isDegraded()).toBe(true);
		});

		it('falls back to {} when the file root is not an object', async () => {
			const filePath = path.join(dataDir, 'maestro-settings.json');
			await fs.writeFile(filePath, JSON.stringify(['array', 'not', 'object']), 'utf-8');

			const mgr = new SettingsManager({ dataDir });
			await mgr.load();

			expect(mgr.getSettings()).toEqual({});
			expect(mgr.isDegraded()).toBe(true);
		});
	});
});
