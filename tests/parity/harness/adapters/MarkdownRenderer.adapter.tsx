/**
 * MarkdownRenderer — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/MarkdownRenderer.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * MarkdownRenderer is a pure presentational primitive — it takes a string
 * of markdown plus a theme and produces a `prose` container with
 * theme-styled element overrides. None of the catalog stories require
 * interaction; we mount once per story and the runner asserts against the
 * initial paint.
 *
 * `onCopy` is a required prop on the lifted component (the per-codeblock
 * copy-button overlay invokes it from a `data-copy` click handler). The
 * catalog stories do NOT exercise the click — they only assert the
 * affordance's `title="Copy code"` attribute is present — so a no-op
 * handler is sufficient.
 */

import type { ReactElement } from 'react';
import { MarkdownRenderer } from '../../../../src/webFull/components/MarkdownRenderer';
import { markdownRendererParityCatalog } from '../../../../src/webFull/components/MarkdownRenderer.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];
const onCopy = () => {};

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'markdown-renderer-wraps-content-in-prose-container':
			return <MarkdownRenderer content="Hello world" theme={theme} onCopy={onCopy} />;

		case 'markdown-renderer-renders-fenced-code-block-with-copy-button':
			return (
				<MarkdownRenderer content={'```ts\nconst x = 1;\n```'} theme={theme} onCopy={onCopy} />
			);

		case 'markdown-renderer-renders-h1-heading':
			return <MarkdownRenderer content="# Main Title" theme={theme} onCopy={onCopy} />;

		case 'markdown-renderer-renders-external-link-as-clickable-anchor':
			return (
				<MarkdownRenderer content="[GitHub](https://github.com)" theme={theme} onCopy={onCopy} />
			);

		case 'markdown-renderer-renders-unordered-list-with-list-items':
			return (
				<MarkdownRenderer content={'- first\n- second\n- third'} theme={theme} onCopy={onCopy} />
			);

		case 'markdown-renderer-empty-content-still-renders-prose-wrapper':
			return <MarkdownRenderer content="" theme={theme} onCopy={onCopy} />;

		case 'markdown-renderer-inline-code-does-not-show-copy-button':
			return <MarkdownRenderer content="Use the `foo()` helper" theme={theme} onCopy={onCopy} />;

		case 'markdown-renderer-plain-paragraph-does-not-render-heading':
			return <MarkdownRenderer content="Just a paragraph." theme={theme} onCopy={onCopy} />;

		case 'markdown-renderer-strips-javascript-pseudo-protocol-from-href':
			return (
				<MarkdownRenderer content="[click](javascript:alert(1))" theme={theme} onCopy={onCopy} />
			);

		case 'markdown-renderer-pure-text-render-does-not-fire-ipc-or-ws':
			return <MarkdownRenderer content="Hello" theme={theme} onCopy={onCopy} />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: markdownRendererParityCatalog as ParityStory[],
	render,
};

export default adapter;
