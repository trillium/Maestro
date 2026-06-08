/**
 * Tests for `src/webFull/utils/terminalProseStyles.ts` — the surgical extract
 * of `generateTerminalProseStyles` from the renderer's `markdownConfig.ts`.
 *
 * Utility tests on output-shape — verifies the emitted CSS string carries the
 * theme colors, the scoping prefix, and the inlined Bionify rules, so a
 * future drift between the renderer source and this extract surfaces here.
 */

import { describe, it, expect } from 'vitest';
import type { Theme } from '../../shared/theme-types';
import { generateTerminalProseStyles } from './terminalProseStyles';

const baseColors = {
	bgMain: '#111111',
	bgSidebar: '#222222',
	bgActivity: '#333333',
	border: '#444444',
	textMain: '#eeeeee',
	textDim: '#aaaaaa',
	accent: '#ff00ff',
	accentDim: '#aa00aa',
	accentText: '#ff66ff',
	accentForeground: '#ffffff',
	success: '#00ff00',
	warning: '#ffaa00',
	error: '#ff0000',
};

const darkTheme: Theme = {
	id: 'dracula',
	name: 'Test Dark',
	mode: 'dark',
	colors: baseColors,
};

const lightTheme: Theme = {
	id: 'github-light',
	name: 'Test Light',
	mode: 'light',
	colors: baseColors,
};

describe('generateTerminalProseStyles', () => {
	it('returns a non-empty CSS string scoped to the given selector + .prose', () => {
		const css = generateTerminalProseStyles(darkTheme, '.group-chat-messages');
		expect(typeof css).toBe('string');
		expect(css.length).toBeGreaterThan(0);
		expect(css).toContain('.group-chat-messages .prose');
	});

	it('emits theme colors for headings, code, and accents', () => {
		const css = generateTerminalProseStyles(darkTheme, '.terminal-output');

		// h1 uses accent
		expect(css).toContain(`color: ${baseColors.accent}`);
		// h2 uses success
		expect(css).toContain(`color: ${baseColors.success}`);
		// h3 uses warning
		expect(css).toContain(`color: ${baseColors.warning}`);
		// code backgrounds use bgSidebar
		expect(css).toContain(`background-color: ${baseColors.bgSidebar}`);
		// link uses accent w/ underline
		expect(css).toContain(`color: ${baseColors.accent}; text-decoration: underline;`);
	});

	it('includes the inlined Bionify reading-mode rules and a rest-opacity variable', () => {
		const css = generateTerminalProseStyles(darkTheme, '.group-chat-messages');
		expect(css).toContain('.bionify-word');
		expect(css).toContain('.bionify-word-emphasis');
		expect(css).toContain('.bionify-word-rest');
		// dark theme path: opacity uses DEFAULT_BIONIFY_REST_OPACITY (0.65)
		expect(css).toContain('var(--bionify-rest-opacity, 0.65)');
	});

	it('shifts the Bionify rest-opacity fallback for light-mode themes', () => {
		const cssDark = generateTerminalProseStyles(darkTheme, '.group-chat-messages');
		const cssLight = generateTerminalProseStyles(lightTheme, '.group-chat-messages');
		expect(cssDark).toContain('var(--bionify-rest-opacity, 0.65)');
		// light theme: baseOpacity=0.73, intensity=1 → resolveBionifyRestOpacity = 0.73
		expect(cssLight).toContain('var(--bionify-rest-opacity, 0.73)');
		expect(cssLight).not.toBe(cssDark);
	});

	it('scopes every emitted rule under the provided selector', () => {
		const css = generateTerminalProseStyles(darkTheme, '.scope-x');
		// All meaningful rule selectors begin with the scope prefix
		const ruleLines = css
			.split('\n')
			.map((l) => l.trim())
			.filter((l) => l.length > 0 && !l.startsWith('/*') && l.includes('{'));
		for (const rule of ruleLines) {
			expect(rule.startsWith('.scope-x')).toBe(true);
		}
	});
});
