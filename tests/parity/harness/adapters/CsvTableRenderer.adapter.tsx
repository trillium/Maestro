/**
 * CsvTableRenderer — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/CsvTableRenderer.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * CsvTableRenderer is mostly stateless from the catalog's perspective —
 * the input `content` / `delimiter` / `searchQuery` props drive every
 * observable behavior. One story (`...sorts-column-ascending...`) needs
 * a header-click interaction before the assertion runs; we drive that
 * via the local <SortDriver> wrapper, which clicks the named header cell
 * on first paint and lets the assertion run on the post-click state.
 *
 * Theme is supplied from the shared `dracula` theme so the inline-style
 * driven `color`/`background-color` values resolve deterministically.
 * The catalog's assertions all target tag names, classes, ARIA, and text
 * — not inline-style values — so the picked theme is cosmetic.
 *
 * The "no IPC / no FS / no process" story uses the `wsFrameMatches` /
 * `fsHas` / `processHas` backend verbs which the runner auto-skips per
 * `runParityCatalog.ts`'s `VERBS_REQUIRING_BACKEND` set; we still provide
 * a render mapping for switch exhaustiveness.
 */

import { useEffect, useRef, type ReactElement } from 'react';
import { CsvTableRenderer } from '../../../../src/webFull/components/CsvTableRenderer';
import { csvTableRendererParityCatalog } from '../../../../src/webFull/components/CsvTableRenderer.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];

/**
 * Drives the header-click sort story. Mounts the renderer with the
 * provided content, then clicks the first non-row-number header cell
 * on first paint so the assertion runs against the post-click state
 * (chevron-up visible, body still contains every name).
 */
function SortDriver({ content }: { content: string }): ReactElement {
	const clickedRef = useRef(false);

	useEffect(() => {
		if (clickedRef.current) return;
		// Wait one paint so the thead is in the DOM, then click the "name"
		// header cell (index 1 — index 0 is the row-number "#" column).
		const id = requestAnimationFrame(() => {
			const headers = document.querySelectorAll<HTMLTableCellElement>('thead th');
			// headers[0] is the row-number "#" column; headers[1] is the
			// first data column ("name"). Click it to land the asc sort
			// and surface the chevron-up SVG.
			if (headers[1]) {
				headers[1].click();
				clickedRef.current = true;
			}
		});
		return () => cancelAnimationFrame(id);
	}, []);

	return <CsvTableRenderer content={content} theme={theme} />;
}

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'csv-table-renderer-well-formed-csv-renders-header-and-data-rows':
			return <CsvTableRenderer content={'name,age\nAlice,30\nBob,25'} theme={theme} />;

		case 'csv-table-renderer-prepends-row-number-column-starting-at-one':
			return <CsvTableRenderer content={'fruit\napple\nbanana\ncherry'} theme={theme} />;

		case 'csv-table-renderer-tsv-delimiter-prop-parses-tab-separated-content':
			return (
				<CsvTableRenderer content={'city\tpopulation\nNYC\t8000000'} theme={theme} delimiter="\t" />
			);

		case 'csv-table-renderer-search-query-wraps-matching-substrings-in-mark-elements':
			return (
				<CsvTableRenderer content={'name\nAlice\nBob\nCarol'} theme={theme} searchQuery="al" />
			);

		case 'csv-table-renderer-header-click-sorts-column-ascending-and-shows-chevron-up':
			return <SortDriver content={'name\nCharlie\nAlice\nBob'} />;

		case 'csv-table-renderer-empty-content-renders-empty-state-copy-no-table':
			return <CsvTableRenderer content={''} theme={theme} />;

		case 'csv-table-renderer-search-with-no-matches-renders-zero-of-total-footer':
			return <CsvTableRenderer content={'name\nAlice\nBob'} theme={theme} searchQuery="zzzz" />;

		case 'csv-table-renderer-quoted-field-with-comma-stays-as-one-cell-not-split':
			return <CsvTableRenderer content={'name,note\n"Smith, Jr.",hello'} theme={theme} />;

		case 'csv-table-renderer-data-only-no-header-still-renders-without-crash':
			return <CsvTableRenderer content={'soloRow'} theme={theme} />;

		case 'csv-table-renderer-does-not-leak-ipc-or-electron-surface-at-module-load-or-runtime':
			// Backend-verb story (`wsFrameMatches`, `fsHas`, `processHas`) —
			// executor auto-skips. Provide a render for switch exhaustiveness.
			return <CsvTableRenderer content={'a,b\n1,2'} theme={theme} />;

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: csvTableRendererParityCatalog as ParityStory[],
	render,
};

export default adapter;
