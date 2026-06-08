/**
 * SettingCheckbox — parity harness adapter
 *
 * Bridges each catalog story's prose `given`/`when` to a concrete React
 * element. The catalog file
 * (`src/webFull/components/SettingCheckbox.parity.test.ts`) is imported
 * verbatim; adding / removing / editing a story over there flows through
 * here via `story.name`.
 *
 * SettingCheckbox is a pure stateless presentational primitive — no
 * internal state, no lifecycle, no portals. Parent owns the `checked`
 * value and receives change events via `onChange(next: boolean)`. The
 * catalog stories are render-shape oriented (`hasElement` / `hasText`)
 * so every story is a single static mount with `onChange` as a no-op.
 *
 * The icon prop is `LucideIcon` — we use `Bell` as a representative icon
 * for every story since the catalog asserts `label svg` (any SVG child
 * inside the section label) rather than a specific icon.
 *
 * Theme is supplied from the shared `dracula` theme so the inline-style
 * driven `color`/`background-color` values resolve deterministically.
 * The catalog's assertions all target tag names, classes, ARIA, and text
 * — not inline-style values — so the picked theme is cosmetic.
 */

import type { ReactElement } from 'react';
import { Bell } from 'lucide-react';
import { SettingCheckbox } from '../../../../src/webFull/components/SettingCheckbox';
import { settingCheckboxParityCatalog } from '../../../../src/webFull/components/SettingCheckbox.parity.test';
import { THEMES } from '../../../../src/shared/themes';
import type { ParityStory } from '../registry';

const theme = THEMES['dracula'];
const noop = (): void => {};

function render(story: ParityStory): ReactElement | null {
	switch (story.name) {
		case 'setting-checkbox-renders-section-label-with-icon':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Appearance"
					title="Dark mode"
					checked={false}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-row-is-keyboard-reachable-button':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Notifications"
					title="Enable sounds"
					checked={true}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-renders-description-when-supplied':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Agents"
					title="Auto Run"
					description="Lets agents execute commands without confirmation"
					checked={false}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-switch-aria-checked-true-when-checked':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Privacy"
					title="Send telemetry"
					checked={true}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-description-absent-when-not-supplied':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Privacy"
					title="Telemetry"
					checked={false}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-switch-aria-checked-false-when-unchecked':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Privacy"
					title="Send telemetry"
					checked={false}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-no-ipc-or-ws-on-mount':
			// Lifecycle pin: primitive must fire 0 IPC / 0 WS / 0 DB / 0 FS.
			// The catalog asserts the rendered button row to anchor the
			// mount and rely on the executor's IPC-leak guard upstream.
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="General"
					title="A setting"
					checked={false}
					onChange={noop}
					theme={theme}
				/>
			);

		case 'setting-checkbox-empty-description-string-is-falsy-omit':
			return (
				<SettingCheckbox
					icon={Bell}
					sectionLabel="Beta"
					title="Beta"
					description=""
					checked={false}
					onChange={noop}
					theme={theme}
				/>
			);

		default:
			throw new Error(`No render mapping for story "${story.name}"`);
	}
}

const adapter = {
	catalog: settingCheckboxParityCatalog as ParityStory[],
	render,
};

export default adapter;
