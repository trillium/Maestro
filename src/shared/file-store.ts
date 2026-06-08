/**
 * Minimal `electron-store`-compatible drop-in for headless Node mode.
 *
 * Mirrors the subset of `electron-store`'s API that Maestro's codebase uses:
 *   - new Store({ name, cwd, defaults })
 *   - store.get(key, defaultValue?)
 *   - store.set(key, value)
 *   - store.has(key)
 *   - store.delete(key)
 *   - store.store (whole-object getter)
 *
 * Persists as a single JSON file at `<cwd>/<name>.json`. Writes are sync
 * with a temp-file-rename pattern to keep the on-disk file always valid.
 *
 * This preserves electron-store's on-disk schema so a Maestro data
 * directory created in Electron mode can be opened in headless mode
 * (and vice versa) with no migration.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface FileStoreOptions<T extends Record<string, unknown>> {
	/** Base filename (without `.json`). Maps to `electron-store`'s `name` option. */
	name: string;
	/** Directory the JSON file lives in. */
	cwd: string;
	/** Default object used when the file is missing or invalid. */
	defaults?: T;
}

export class FileStore<T extends Record<string, unknown>> {
	private filePath: string;
	private data: T;
	private defaults: T;

	constructor(opts: FileStoreOptions<T>) {
		this.defaults = (opts.defaults ?? {}) as T;
		fs.mkdirSync(opts.cwd, { recursive: true });
		this.filePath = path.join(opts.cwd, `${opts.name}.json`);
		this.data = this.load();
	}

	private load(): T {
		try {
			const raw = fs.readFileSync(this.filePath, 'utf-8');
			const parsed = JSON.parse(raw) as Partial<T>;
			return { ...this.defaults, ...parsed } as T;
		} catch {
			return { ...this.defaults } as T;
		}
	}

	private persist(): void {
		const tmp = `${this.filePath}.tmp`;
		fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf-8');
		fs.renameSync(tmp, this.filePath);
	}

	get<K extends keyof T>(key: K): T[K];
	get<K extends keyof T>(key: K, defaultValue: T[K]): T[K];
	get<V>(key: string, defaultValue?: V): V;
	get(key: string, defaultValue?: unknown): unknown {
		if (key in this.data) {
			return (this.data as Record<string, unknown>)[key];
		}
		return defaultValue;
	}

	set<K extends keyof T>(key: K, value: T[K]): void;
	set(key: string, value: unknown): void;
	set(key: string, value: unknown): void {
		(this.data as Record<string, unknown>)[key] = value;
		this.persist();
	}

	has<K extends keyof T>(key: K): boolean;
	has(key: string): boolean;
	has(key: string): boolean {
		return key in this.data;
	}

	delete<K extends keyof T>(key: K): void;
	delete(key: string): void;
	delete(key: string): void {
		delete (this.data as Record<string, unknown>)[key];
		this.persist();
	}

	get store(): T {
		return { ...this.data };
	}

	clear(): void {
		this.data = { ...this.defaults } as T;
		this.persist();
	}

	get path(): string {
		return this.filePath;
	}
}
