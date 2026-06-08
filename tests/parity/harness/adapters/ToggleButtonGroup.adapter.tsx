/**
 * ToggleButtonGroup — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/ToggleButtonGroup.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * ToggleButtonGroup is a pure stateless UI primitive — no internal state,
 * no lifecycle, no portals. The catalog stories are render-shape oriented
 * (`hasElement` / `hasText`) so every story is a single static mount with
 * `onChange` as a no-op (the catalog explicitly drops click semantics —
 * those belong to the future feature-consumer's catalog, not the
 * primitive's).
 *
 * Theme is supplied from the shared `dracula` theme so the inline-style
 * driven `color`/`background-color` values resolve deterministically.
 * The catalog's assertions all target tag names, classes, and text — not
 * inline-style values — so the picked theme is cosmetic.
 *
 * `ToggleButtonGroup` is generic over the option value type (`string` |
 * `number`). The numeric-values story uses the number-typed instance; the
 * other stories use the string-typed instance.
 */

import type { ReactElement } from 'react';
import { ToggleButtonGroup } from '../../../../src/webFull/components/ToggleButtonGroup';
import { toggleButtonGroupParityCatalog } from '../../../../src/webFull/components/ToggleButtonGroup.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];
const noop = (): void => {};

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'toggle-button-group-renders-one-button-per-option':
			return (
				<ToggleButtonGroup
					options={['small', 'medium', 'large']}
					value="medium"
					onChange={noop}
					theme={theme}
				/>
			);

		case 'toggle-button-group-active-option-has-ring-class':
			return (
				<ToggleButtonGroup options={['a', 'b', 'c']} value="b" onChange={noop} theme={theme} />
			);

		case 'toggle-button-group-label-precedence-option-label-wins':
			return (
				<ToggleButtonGroup
					options={[
						{ value: 'sm', label: 'Small' },
						{ value: 'md', label: 'Medium' },
					]}
					value="sm"
					labels={{ sm: 'FALLBACK' }}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'toggle-button-group-label-precedence-labels-map-second':
			return (
				<ToggleButtonGroup
					options={['sm', 'md']}
					value="md"
					labels={{ sm: 'Small', md: 'Medium' }}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'toggle-button-group-supports-numeric-values':
			return <ToggleButtonGroup options={[1, 2, 3]} value={2} onChange={noop} theme={theme} />;

		case 'toggle-button-group-inactive-options-have-no-ring-class':
			return (
				<ToggleButtonGroup options={['a', 'b', 'c']} value="a" onChange={noop} theme={theme} />
			);

		case 'toggle-button-group-falsy-label-falls-back-to-string-value':
			return (
				<ToggleButtonGroup
					options={[{ value: 'x', label: '' }, { value: 'y' }]}
					value="x"
					onChange={noop}
					theme={theme}
				/>
			);

		case 'toggle-button-group-no-matching-value-leaves-all-inactive':
			return (
				<ToggleButtonGroup
					options={['a', 'b', 'c']}
					value={'z' as 'a' | 'b' | 'c'}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'toggle-button-group-empty-options-renders-empty-row':
			return <ToggleButtonGroup options={[]} value={'' as never} onChange={noop} theme={theme} />;

		case 'toggle-button-group-custom-activeColor-does-not-break-label':
			return (
				<ToggleButtonGroup
					options={[
						{ value: 'red', label: 'Red', activeColor: '#ff0000' },
						{ value: 'blue', label: 'Blue' },
					]}
					value="red"
					onChange={noop}
					theme={theme}
				/>
			);

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: toggleButtonGroupParityCatalog as ParityStory[],
	render,
};

export default adapter;
