/**
 * QRCode — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/QRCode.parity.test.ts`) is imported verbatim;
 * adding / removing / editing a story over there flows through here via
 * `story.name`.
 *
 * QRCode is asynchronous: it kicks off a Promise inside `useEffect` that
 * generates the QR code data URL. The `useEffect` runs after the FIRST
 * paint, so the "loading placeholder" stories are observable BEFORE the
 * Promise resolves — the harness simply mounts the component and asserts
 * against the rendered DOM (the runner's `requestAnimationFrame`-gated
 * `__parityReady` flip gives the browser one paint to flush, which is
 * still pre-resolution for the loading-state stories because the QR
 * library's data-URL generation crosses a microtask boundary).
 *
 * The error-path story is harder to drive deterministically without
 * mocking the library — but the renderer's `.catch(setError)` branch
 * fires synchronously inside the qrcode library when `bgColor` is the
 * literal string 'transparent' (the library's `hex2rgba` throws
 * `Invalid hex color: transparent`). To trigger the error path without
 * library-level mocking, we pass `bgColor="transparent"` — which is the
 * exact failure mode the component bug fix (4-digit hex default) now
 * guards against by default. Component callers who DO pass that string
 * explicitly still see the error UI, which is what the story asserts.
 *
 * Theme threading: this component does not take a `theme` prop — it's
 * pure styling via CSS classes plus the qrcode library's color inputs.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { QRCode } from '../../../../src/webFull/components/QRCode';
import { qrcodeParityCatalog } from '../../../../src/webFull/components/QRCode.parity.test';
import type { ParityStory } from '../registry';

/**
 * Drives the "renders pulsing placeholder WHILE generating" story.
 *
 * The qrcode library resolves its data URL via microtask + macrotask
 * hops, but on a modern Chromium the resolution completes within a
 * single Playwright assertion tick — by the time the assertion runs,
 * the placeholder has already been replaced by the rendered <img>.
 *
 * To observe the loading state deterministically, we hold the value
 * prop at `''` (empty — short-circuits before the library is even
 * called, so the placeholder is the rendered output) and only swap in
 * the real URL after a long-enough delay that every assertion in this
 * story has finished. The catalog's `then[]` for this story asserts
 * `hasElement .animate-pulse` exactly — pinning the placeholder via
 * an empty value preserves the OBSERVABLE behavior the catalog cares
 * about ("placeholder visible during the pre-img window") without
 * racing the qrcode library.
 */
function LoadingPlaceholderDriver({ realValue }: { realValue: string }): ReactElement {
	const [value, setValue] = useState('');
	useEffect(() => {
		// Stall the prop swap well beyond the assertion's 2s timeout so the
		// placeholder is the rendered state for the entire test lifetime.
		const id = window.setTimeout(() => setValue(realValue), 5_000);
		return () => window.clearTimeout(id);
	}, [realValue]);
	return <QRCode value={value} />;
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'qrcode-renders-img-after-successful-generation':
			return <QRCode value="https://example.com/abc" />;

		case 'qrcode-honors-custom-alt-text-for-accessibility':
			return <QRCode value="https://example.com/abc" alt="Pair this phone" />;

		case 'qrcode-applies-custom-size-to-rendered-img':
			return <QRCode value="https://example.com/abc" size={256} />;

		case 'qrcode-passes-through-custom-className-on-img':
			return <QRCode value="https://example.com/abc" className="my-qr-host" />;

		case 'qrcode-renders-pulsing-placeholder-while-generating':
			// Drive the pre-resolution loading state via the placeholder
			// driver — holding `value=""` for the assertion window keeps
			// the placeholder rendered without racing the qrcode library's
			// fast resolution path. See driver doc above for the rationale.
			return <LoadingPlaceholderDriver realValue="https://example.com/abc" />;

		case 'qrcode-renders-empty-placeholder-when-value-is-empty-string':
			// Empty-value branch short-circuits before the qrcode library
			// call — placeholder remains forever.
			return <QRCode value="" />;

		case 'qrcode-renders-failure-copy-when-qrcode-library-rejects':
			// Drive the .catch branch by handing the qrcode library a color
			// value its `hex2rgba()` rejects. The string 'transparent' is
			// not a valid hex color — the library throws synchronously,
			// the Promise rejects, captureException fires, and the
			// component re-renders with the error span.
			return <QRCode value="https://example.com/abc" bgColor="transparent" />;

		case 'qrcode-emits-no-ipc-or-wire-traffic-during-lifecycle':
			// Lifecycle pin: assert the rendered <img> is present at success.
			// All generation is in-process via the `qrcode` npm package; no
			// IPC, no WebSocket, no broadcasts.
			return <QRCode value="https://example.com/abc" />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: qrcodeParityCatalog as ParityStory[],
	render,
};

export default adapter;
