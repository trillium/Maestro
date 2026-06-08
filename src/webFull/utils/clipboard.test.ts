/**
 * Tests for `src/webFull/utils/clipboard.ts` — the L2.5 lift of the renderer-side
 * clipboard util (pure surface only; `safeClipboardWriteImage` was deliberately
 * NOT lifted — see file header).
 *
 * Utility tests. Mocks `navigator.clipboard` because vitest's default jsdom env
 * does not provide a writable Clipboard implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { safeClipboardWrite, safeClipboardWriteBlob } from './clipboard';

type MockClipboard = {
	writeText: ReturnType<typeof vi.fn>;
	write: ReturnType<typeof vi.fn>;
};

const installMockClipboard = (impl: Partial<MockClipboard> = {}): MockClipboard => {
	const mock: MockClipboard = {
		writeText: impl.writeText ?? vi.fn().mockResolvedValue(undefined),
		write: impl.write ?? vi.fn().mockResolvedValue(undefined),
	};
	Object.defineProperty(globalThis.navigator, 'clipboard', {
		value: mock,
		configurable: true,
		writable: true,
	});
	return mock;
};

describe('safeClipboardWrite', () => {
	let originalClipboard: PropertyDescriptor | undefined;

	beforeEach(() => {
		originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
	});

	afterEach(() => {
		if (originalClipboard) {
			Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard);
		} else {
			// jsdom may not have clipboard at all — remove the mock we added
			delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
		}
	});

	it('returns true and forwards text on success', async () => {
		const mock = installMockClipboard();
		const ok = await safeClipboardWrite('hello world');
		expect(ok).toBe(true);
		expect(mock.writeText).toHaveBeenCalledExactlyOnceWith('hello world');
	});

	it('returns false when the clipboard rejects (e.g. NotAllowedError)', async () => {
		installMockClipboard({
			writeText: vi.fn().mockRejectedValue(new DOMException('not focused', 'NotAllowedError')),
		});
		const ok = await safeClipboardWrite('payload');
		expect(ok).toBe(false);
	});

	it('returns false when navigator.clipboard is unavailable', async () => {
		Object.defineProperty(globalThis.navigator, 'clipboard', {
			value: undefined,
			configurable: true,
			writable: true,
		});
		const ok = await safeClipboardWrite('payload');
		expect(ok).toBe(false);
	});
});

describe('safeClipboardWriteBlob', () => {
	let originalClipboard: PropertyDescriptor | undefined;

	beforeEach(() => {
		originalClipboard = Object.getOwnPropertyDescriptor(globalThis.navigator, 'clipboard');
	});

	afterEach(() => {
		if (originalClipboard) {
			Object.defineProperty(globalThis.navigator, 'clipboard', originalClipboard);
		} else {
			delete (globalThis.navigator as unknown as { clipboard?: unknown }).clipboard;
		}
	});

	it('returns true and forwards items on success', async () => {
		const mock = installMockClipboard();
		const items: ClipboardItem[] = [];
		const ok = await safeClipboardWriteBlob(items);
		expect(ok).toBe(true);
		expect(mock.write).toHaveBeenCalledExactlyOnceWith(items);
	});

	it('returns false when the clipboard write rejects', async () => {
		installMockClipboard({
			write: vi.fn().mockRejectedValue(new Error('denied')),
		});
		const ok = await safeClipboardWriteBlob([]);
		expect(ok).toBe(false);
	});
});
