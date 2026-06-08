/**
 * webFull-side markdownConfig — surgical extract of
 * `createWizardBubbleMarkdownComponents` from
 * `src/renderer/utils/markdownConfig.ts` (925 LOC) into a focused
 * webFull module with the renderer's hardcoded Electron
 * `shell.openExternal(href)` IPC call swapped for an injected
 * `onExternalLinkClick(href)` callback (default: `window.open(href,
 * '_blank', 'noopener,noreferrer')`).
 *
 * Lift rationale: the `InlineWizard/WizardMessageBubble` lift was the
 * last Wizard Phase-1 leaf blocked by `markdownConfig.ts`. That source
 * file is 925 LOC of `react-markdown` + `react-syntax-highlighter` +
 * theme-registry surface that includes multiple Electron
 * `shell.openExternal` IPC callsites inside the
 * `createWizardBubbleMarkdownComponents` and
 * `createReleaseNotesMarkdownComponents` factory bodies. The
 * `WizardMessageBubble` consumer only depends on the single export
 * `createWizardBubbleMarkdownComponents`, so a full module lift would
 * drag in surface that has no consumer here AND has the IPC dependency
 * baked into the factory body itself (not lambda-deferrable — the
 * factory body wires `onClick` to the Electron IPC bridge directly).
 *
 * Lift strategy — surgical extract, NOT full lift. Mirrors the
 * `terminalProseStyles` precedent that did the same surgical extract
 * for the `generateTerminalProseStyles` symbol for the
 * `GroupChatMessages` lift. Same shape, different symbol.
 *
 * Divergence from the renderer implementation:
 *   - The renderer's L696 hardcodes the Electron `shell.openExternal(href)`
 *     IPC call. This webFull version takes an optional `onExternalLinkClick(href)`
 *     parameter on the factory; if not supplied, defaults to
 *     `window.open(href, '_blank', 'noopener,noreferrer')` so the link
 *     still opens in the browser host.
 *   - Mirrors the callback-injection pattern used by the sibling
 *     `createMarkdownComponents(options)` in the renderer source (see
 *     line 366), which takes `onExternalLinkClick` as a typed callback.
 *
 * Renderer-side `markdownConfig.ts` is UNTOUCHED — fork hygiene.
 */

import type { Components } from 'react-markdown';
import React from 'react';
import type { Theme } from '../../shared/theme-types';
import { REMARK_GFM_PLUGINS } from '../../shared/markdownPlugins';

export { REMARK_GFM_PLUGINS };

/**
 * Default external link handler for the webFull host. Opens the URL in
 * a new browser tab with `noopener,noreferrer` to avoid leaking the
 * opener reference back to the destination page. Used when the
 * factory's caller does not supply an `onExternalLinkClick` callback.
 */
function defaultExternalLinkHandler(href: string): void {
	window.open(href, '_blank', 'noopener,noreferrer');
}

/**
 * Shared markdown component overrides for wizard chat bubbles
 * (WizardMessageBubble).
 *
 * Behavioural parity with the renderer's
 * `createWizardBubbleMarkdownComponents(theme)` except the external
 * link handler is injectable. The default handler opens links in a new
 * browser tab.
 *
 * @param theme Theme object carrying the color palette for inline code,
 *   pre blocks, anchor color, and blockquote border.
 * @param onExternalLinkClick Optional callback fired when a rendered
 *   anchor's href matches `https?://` or `mailto:`. Defaults to
 *   `window.open(href, '_blank', 'noopener,noreferrer')`.
 */
export function createWizardBubbleMarkdownComponents(
	theme: Theme,
	onExternalLinkClick?: (href: string) => void
): Partial<Components> {
	const handleExternal = onExternalLinkClick ?? defaultExternalLinkHandler;
	return {
		p: ({ children }: any) => React.createElement('p', { className: 'mb-2 last:mb-0' }, children),
		ul: ({ children }: any) =>
			React.createElement('ul', { className: 'list-disc ml-4 mb-2' }, children),
		ol: ({ children }: any) =>
			React.createElement('ol', { className: 'list-decimal ml-4 mb-2' }, children),
		li: ({ children }: any) => React.createElement('li', { className: 'mb-1' }, children),
		strong: ({ children }: any) =>
			React.createElement('strong', { className: 'font-semibold' }, children),
		em: ({ children }: any) => React.createElement('em', { className: 'italic' }, children),
		code: ({ children, className }: any) => {
			const isInline = !className;
			return isInline
				? React.createElement(
						'code',
						{
							className: 'px-1 py-0.5 rounded text-xs font-mono',
							style: { backgroundColor: `${theme.colors.bgMain}80` },
						},
						children
					)
				: React.createElement('code', { className }, children);
		},
		pre: ({ children }: any) =>
			React.createElement(
				'pre',
				{
					className: 'p-2 rounded text-xs font-mono overflow-x-auto mb-2',
					style: { backgroundColor: theme.colors.bgMain },
				},
				children
			),
		a: ({ href, children }: any) =>
			React.createElement(
				'button',
				{
					type: 'button',
					className: 'underline',
					style: { color: theme.colors.accent },
					onClick: () => {
						if (href && /^https?:\/\/|^mailto:/.test(href)) {
							handleExternal(href);
						}
					},
				},
				children
			),
		h1: ({ children }: any) =>
			React.createElement('h1', { className: 'text-lg font-bold mb-2' }, children),
		h2: ({ children }: any) =>
			React.createElement('h2', { className: 'text-base font-bold mb-2' }, children),
		h3: ({ children }: any) =>
			React.createElement('h3', { className: 'text-sm font-bold mb-1' }, children),
		blockquote: ({ children }: any) =>
			React.createElement(
				'blockquote',
				{
					className: 'border-l-2 pl-2 mb-2 italic',
					style: { borderColor: theme.colors.border },
				},
				children
			),
	};
}
