/**
 * Tests for `src/webFull/utils/textProcessing.ts` — the L2.5 lift of the
 * renderer-side text-processing util.
 *
 * Utility tests (NOT a parity catalog — utilities don't render). Focused on
 * `stripMarkdown` per the brief's minimum (≥5 cases) plus smoke coverage of
 * the other pure helpers so future refactors don't drift the two copies.
 */

import { describe, it, expect } from 'vitest';
import {
	stripMarkdown,
	processCarriageReturns,
	processLogTextHelper,
	filterTextByLinesHelper,
} from './textProcessing';

describe('stripMarkdown', () => {
	it('removes bold, italic, and strikethrough markers', () => {
		const input = 'Hello **bold** and *italic* and ~~struck~~ text';
		expect(stripMarkdown(input)).toBe('Hello bold and italic and struck text');
	});

	it('strips inline code backticks but keeps content', () => {
		const input = 'Run `npm test` to verify';
		expect(stripMarkdown(input)).toBe('Run npm test to verify');
	});

	it('extracts fenced code block content without the fences', () => {
		const input = '```ts\nconst x = 1;\nconst y = 2;\n```';
		expect(stripMarkdown(input)).toBe('const x = 1;\nconst y = 2;');
	});

	it('strips ATX headers and blockquote markers', () => {
		const input = '# Heading\n## Subheading\n> A quote line';
		expect(stripMarkdown(input)).toBe('Heading\nSubheading\nA quote line');
	});

	it('converts link markdown to its visible text (link regex runs before image regex)', () => {
		// NOTE: stripMarkdown strips links before images, so `![alt](url)` collapses
		// to `!alt` rather than `alt`. This matches the renderer-side behavior
		// verbatim; the extract preserves it intentionally.
		const input = 'See [Maestro](https://runmaestro.ai) and ![logo](img.png)';
		expect(stripMarkdown(input)).toBe('See Maestro and !logo');
	});

	it('normalizes mixed bullet markers to a leading dash', () => {
		const input = '* first\n+ second\n- third';
		expect(stripMarkdown(input)).toBe('- first\n- second\n- third');
	});

	it('preserves numbered list ordering after normalization', () => {
		const input = '1. one\n  2. two\n3. three';
		expect(stripMarkdown(input)).toBe('1. one\n2. two\n3. three');
	});
});

describe('processCarriageReturns', () => {
	it('keeps the last non-empty segment after \\r within a line', () => {
		expect(processCarriageReturns('progress 10%\rprogress 100%')).toBe('progress 100%');
	});

	it('leaves lines without carriage returns untouched', () => {
		expect(processCarriageReturns('plain line\nother line')).toBe('plain line\nother line');
	});
});

describe('processLogTextHelper', () => {
	it('drops bare bash/zsh prompts and empty lines in terminal mode', () => {
		const input = 'real output\n$\nzsh%\n\nbash-5.2$\nmore output';
		expect(processLogTextHelper(input, true)).toBe('real output\nmore output');
	});

	it('returns carriage-return-processed text unchanged in AI mode', () => {
		const input = 'kept line\n$\nzsh%';
		expect(processLogTextHelper(input, false)).toBe(input);
	});
});

describe('filterTextByLinesHelper', () => {
	it('returns input unchanged when query is empty', () => {
		expect(filterTextByLinesHelper('a\nb\nc', '', 'include', false)).toBe('a\nb\nc');
	});

	it('includes only matching lines for plain-text queries', () => {
		const input = 'apple pie\nbanana bread\napple tart';
		expect(filterTextByLinesHelper(input, 'apple', 'include', false)).toBe('apple pie\napple tart');
	});

	it('excludes matching lines for regex queries', () => {
		const input = 'foo1\nbar\nfoo2';
		expect(filterTextByLinesHelper(input, '^foo\\d', 'exclude', true)).toBe('bar');
	});

	it('falls back to plain-text search on an invalid regex', () => {
		const input = 'has [bracket\nplain';
		expect(filterTextByLinesHelper(input, '[bracket', 'include', true)).toBe('has [bracket');
	});
});
