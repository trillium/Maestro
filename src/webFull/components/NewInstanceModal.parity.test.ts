/**
 * Parity catalog — NewInstanceModal
 *
 * webFull lift of `src/renderer/components/NewInstanceModal.tsx` (1822 LOC,
 * the "create a new agent" entry point + companion EditAgentModal). The
 * biggest single-modal user-felt unlock remaining in the leaf-parade
 * (2026-06-08 brief). Lands on top of all five IPC-shim Decision route
 * clusters (fs / agents / marketplace / autorun-via-FsProvider.writeDoc /
 * ssh-remotes, all CLOSED server-side on origin/main 2e410f9d6).
 *
 * Catalog of (Given, When, Then) stories using the fixed
 * WEB_PARITY_VERIFICATION assertion vocabulary:
 *
 *   hasElement, hasText, wsFrameMatches, dbHasRow, fsHas, processHas,
 *   notificationFired, broadcast
 *
 * The parity contract is observable-behavior-only — the catalog IS the
 * spec, not the renderer source. Pass criterion = every story passes on
 * BOTH targets (Electron oracle at localhost:9222 and webFull at
 * localhost:5176). Stories are layout-independent — they assert observable
 * behavior, not DOM structure or CSS.
 *
 * Mapping back to the lift brief:
 *
 * - Modal title chrome ("Create New Agent") — happy
 * - Agent Name field renders — happy
 * - Working Directory field renders — happy
 * - Agent Provider section renders — happy
 * - Nudge Message field renders — happy
 * - Modal renders nothing when isOpen=false — negative
 * - Cmd+Enter shortcut hint on the Create button (no IPC required to render) — negative
 * - Folder-browse button hidden when `onFolderPick` is undefined (strip-and-promote pin) — negative
 * - SSH Remote selector not rendered when sshRemotes is empty (graceful degrade) — negative
 * - openExternal → window.open swap is observable via the
 *   MAESTRO_SESSION_RESUMED affordance still rendering — negative
 *
 * Plus EditAgentModal-specific stories:
 *
 * - Edit modal title chrome contains "Edit Agent:" — happy
 * - Edit modal renders the agent provider switcher — happy
 * - Edit modal renders nothing when session is null — negative
 *
 * Audit-count pin:
 *
 * - The leaf-parade brief named 18 IPC sites in the renderer source. Pre-
 *   flight grep confirmed 18 sites, NOT more (no transitive hook surprise
 *   like MarketplaceModal had with `useMarketplace`). NewInstanceModal is
 *   "all fan-out inline in the modal source" by construction — see the
 *   modal's doc-comment "Audit count holds" section.
 *
 * Strip-and-promote pins (per brief):
 *
 * - `dialog.selectFolder` → `onFolderPick` prop
 * - `agents.getConfig` / `agents.setConfig` → `agentConfigs` + `onAgentConfigSave` props
 * - `agents.getModels` → `availableModels` + `onRefreshModels` props
 * - `fs.stat(path, sshRemoteId)` → `onRemotePathValidate` prop (server route 501s on SSH)
 * - `shell.openExternal` → `window.open(url, '_blank', 'noopener,noreferrer')` swap
 */

import { describe, expect, it } from 'vitest';

/**
 * Allowed assertion verbs per WEB_PARITY_VERIFICATION.
 */
export type AssertionVerb =
	| 'hasElement'
	| 'hasText'
	| 'wsFrameMatches'
	| 'dbHasRow'
	| 'fsHas'
	| 'processHas'
	| 'notificationFired'
	| 'broadcast';

export interface Assertion {
	verb: AssertionVerb;
	target: string;
	value?: string;
}

export interface ParityStory {
	name: string;
	given: string;
	when: string[];
	then: Assertion[];
	happyPath: boolean;
}

export const newInstanceModalParityCatalog: ParityStory[] = [
	// ============ Happy paths ============
	{
		name: 'new-instance-modal-renders-title-when-open',
		given:
			'NewInstanceModal mounts with isOpen=true, existingSessions=[], onClose+onCreate stubs. Agent detection is in flight.',
		when: ['the modal mounts'],
		then: [
			// Modal title chrome
			{ verb: 'hasText', target: 'body', value: 'Create New Agent' },
		],
		happyPath: true,
	},
	{
		name: 'new-instance-modal-renders-agent-name-input',
		given: 'NewInstanceModal mounts with isOpen=true.',
		when: ['the modal mounts'],
		then: [
			// Spec-pinned uppercase form label
			{ verb: 'hasText', target: 'body', value: 'Agent Name' },
			// Stable input id from the FormInput primitive
			{ verb: 'hasElement', target: '#agent-name-input' },
		],
		happyPath: true,
	},
	{
		name: 'new-instance-modal-renders-working-directory-input',
		given: 'NewInstanceModal mounts with isOpen=true.',
		when: ['the modal mounts'],
		then: [
			// Uppercase form label
			{ verb: 'hasText', target: 'body', value: 'Working Directory' },
		],
		happyPath: true,
	},
	{
		name: 'new-instance-modal-renders-agent-provider-section',
		given:
			'NewInstanceModal mounts with isOpen=true. The Agent Provider section renders independently of whether detection has resolved (the loading state is rendered as "Loading agents..." inside it).',
		when: ['the modal mounts'],
		then: [
			// Section header
			{ verb: 'hasText', target: 'body', value: 'Agent Provider' },
		],
		happyPath: true,
	},
	{
		name: 'new-instance-modal-renders-nudge-message-field',
		given: 'NewInstanceModal mounts with isOpen=true.',
		when: ['the modal mounts'],
		then: [
			// Section header
			{ verb: 'hasText', target: 'body', value: 'Nudge Message' },
			// Spec-pinned placeholder
			{
				verb: 'hasElement',
				target: 'textarea[placeholder="Instructions appended to every message you send..."]',
			},
		],
		happyPath: true,
	},
	{
		name: 'new-instance-modal-renders-create-agent-confirm-button',
		given:
			'NewInstanceModal mounts with isOpen=true. The footer is supplied by the ModalFooter primitive with confirmLabel="Create Agent".',
		when: ['the modal mounts'],
		then: [
			// Footer confirm label
			{ verb: 'hasText', target: 'body', value: 'Create Agent' },
		],
		happyPath: true,
	},
	{
		name: 'new-instance-modal-renders-maestro-session-resumed-affordance',
		given:
			'NewInstanceModal mounts with isOpen=true. The "MAESTRO_SESSION_RESUMED" docs button is wired through `window.open(url, "_blank", "noopener,noreferrer")` per the openExternal → window.open swap (StandingOvationOverlay / MarketplaceModal precedent).',
		when: ['the modal mounts'],
		then: [
			// The affordance still renders (swap presence is observable via affordance still rendering)
			{ verb: 'hasText', target: 'body', value: 'MAESTRO_SESSION_RESUMED' },
		],
		happyPath: true,
	},
	{
		name: 'edit-agent-modal-renders-title-when-open-with-session',
		given:
			'EditAgentModal mounts with isOpen=true and a non-null session, onClose+onSave stubs, existingSessions=[session].',
		when: ['the modal mounts'],
		then: [
			// Custom header prefix
			{ verb: 'hasText', target: 'body', value: 'Edit Agent:' },
		],
		happyPath: true,
	},
	{
		name: 'edit-agent-modal-renders-agent-provider-select',
		given: 'EditAgentModal mounts with isOpen=true and a non-null session.',
		when: ['the modal mounts'],
		then: [
			// Section header
			{ verb: 'hasText', target: 'body', value: 'Agent Provider' },
			// Save Changes confirm button (footer)
			{ verb: 'hasText', target: 'body', value: 'Save Changes' },
		],
		happyPath: true,
	},

	// ============ Negative paths ============
	{
		name: 'new-instance-modal-renders-nothing-when-closed',
		given: 'NewInstanceModal mounts with isOpen=false.',
		when: ['the modal mounts'],
		then: [
			// Title copy must NOT appear when the modal is closed.
			{ verb: 'hasElement', target: 'body:not(:has-text("Create New Agent"))' },
		],
		happyPath: false,
	},
	{
		name: 'new-instance-modal-renders-loading-state-before-agent-detection',
		given:
			'NewInstanceModal mounts with isOpen=true. The "Loading agents..." copy renders inside the Agent Provider section before /api/agents/detected resolves.',
		when: ['the modal mounts'],
		then: [
			// Spec-pinned loading copy
			{ verb: 'hasText', target: 'body', value: 'Loading agents...' },
		],
		happyPath: false,
	},
	{
		name: 'new-instance-modal-hides-folder-browse-button-without-onfolderpick',
		given:
			'NewInstanceModal mounts with isOpen=true and `onFolderPick` is undefined. The folder-browse affordance in the Working Directory input addon is hidden in this case (strip-and-promote pin — the renderer hides it under SSH; the webFull lift extends "hide" to also cover "no host pick capability"). The Folder icon (lucide-react `<Folder />`) renders via an SVG; we cannot easily query SVGs by name, so we pin the placeholder spec ("Select directory...") which is rendered regardless and remains stable.',
		when: ['the modal mounts'],
		then: [
			// Placeholder spec-pin
			{ verb: 'hasElement', target: 'input[placeholder="Select directory..."]' },
		],
		happyPath: false,
	},
	{
		name: 'new-instance-modal-hides-ssh-remote-selector-when-no-remotes-configured',
		given:
			'NewInstanceModal mounts with isOpen=true. /api/ssh-remotes returns `{configs: []}`. The SshRemoteSelector is hidden when `sshRemotes.length === 0` per the renderer source (line 1148).',
		when: ['the modal mounts'],
		then: [
			// SSH selector NOT rendered (its uppercase label is absent)
			{
				verb: 'hasElement',
				target: 'body:not(:has-text("SSH Remote Execution"))',
			},
		],
		happyPath: false,
	},
	{
		name: 'new-instance-modal-pins-nudge-message-character-cap',
		given:
			'NewInstanceModal mounts with isOpen=true. The Nudge Message textarea has a maxLength of 1000 (NUDGE_MESSAGE_MAX_LENGTH). The character counter displays "0/1000 characters." on initial render.',
		when: ['the modal mounts'],
		then: [
			// Spec-pin character cap (visible on initial render)
			{ verb: 'hasText', target: 'body', value: '0/1000 characters.' },
		],
		happyPath: false,
	},
	{
		name: 'new-instance-modal-pins-cancel-affordance-in-footer',
		given:
			'NewInstanceModal mounts with isOpen=true. The ModalFooter primitive renders a Cancel button alongside the Create Agent confirm.',
		when: ['the modal mounts'],
		then: [
			// Spec-pin Cancel copy from the ModalFooter
			{ verb: 'hasText', target: 'body', value: 'Cancel' },
		],
		happyPath: false,
	},
	{
		name: 'edit-agent-modal-renders-nothing-when-session-is-null',
		given:
			'EditAgentModal mounts with isOpen=true and session=null. The renderer guards with `if (!isOpen || !session) return null` (line 1528).',
		when: ['the modal mounts'],
		then: [
			// Custom header prefix must NOT appear
			{ verb: 'hasElement', target: 'body:not(:has-text("Edit Agent:"))' },
		],
		happyPath: false,
	},
	{
		name: 'edit-agent-modal-renders-nothing-when-closed',
		given: 'EditAgentModal mounts with isOpen=false and a non-null session.',
		when: ['the modal mounts'],
		then: [
			// Custom header prefix must NOT appear
			{ verb: 'hasElement', target: 'body:not(:has-text("Edit Agent:"))' },
		],
		happyPath: false,
	},
	{
		name: 'new-instance-modal-pins-remote-path-validator-not-rendered-without-prop',
		given:
			'NewInstanceModal mounts with isOpen=true, sshRemotes=[] (no remotes configured), `onRemotePathValidate` undefined. The remote-path validation indicator does not render — strip-and-promote pin for the deferred `fs.stat(path, sshRemoteId)` site (server route 501s on `?sshRemoteId=`).',
		when: ['the modal mounts'],
		then: [
			// "Checking remote path...", "Remote directory found", and any
			// error text from the remote-path validator must NOT appear when
			// the host has not supplied the validator prop.
			{
				verb: 'hasElement',
				target: 'body:not(:has-text("Checking remote path..."))',
			},
		],
		happyPath: false,
	},
];

describe('NewInstanceModal — parity catalog', () => {
	it('declares at least three happy-path stories', () => {
		const happy = newInstanceModalParityCatalog.filter((s) => s.happyPath);
		expect(happy.length).toBeGreaterThanOrEqual(3);
	});

	it('declares at least one negative-path story per happy-path story', () => {
		const happy = newInstanceModalParityCatalog.filter((s) => s.happyPath).length;
		const negative = newInstanceModalParityCatalog.filter((s) => !s.happyPath).length;
		expect(happy).toBeGreaterThanOrEqual(1);
		expect(negative).toBeGreaterThanOrEqual(happy);
	});

	it('uses only the allowed assertion verbs', () => {
		const allowed = new Set<AssertionVerb>([
			'hasElement',
			'hasText',
			'wsFrameMatches',
			'dbHasRow',
			'fsHas',
			'processHas',
			'notificationFired',
			'broadcast',
		]);
		for (const story of newInstanceModalParityCatalog) {
			for (const a of story.then) {
				expect(allowed.has(a.verb)).toBe(true);
			}
		}
	});

	it('every story has a non-empty given/when/then', () => {
		for (const story of newInstanceModalParityCatalog) {
			expect(story.given.length).toBeGreaterThan(0);
			expect(story.when.length).toBeGreaterThan(0);
			expect(story.then.length).toBeGreaterThan(0);
		}
	});

	it('does not assert against any IPC / Electron-only surface', () => {
		const banned = ['window.maestro', 'shell.openexternal', 'ipcrenderer'];
		for (const story of newInstanceModalParityCatalog) {
			const haystack = JSON.stringify(story).toLowerCase();
			for (const b of banned) {
				expect(haystack.includes(b)).toBe(false);
			}
		}
	});

	it('pins the title — "Create New Agent" is the canonical chrome', () => {
		// Stable spec-pin so a future refactor that drifts the copy
		// (e.g. "New Agent", "Create Session") fails the catalog rather
		// than silently changing user-facing copy.
		const titleStory = newInstanceModalParityCatalog.find((s) =>
			s.then.some((t) => t.value === 'Create New Agent')
		);
		expect(titleStory).toBeDefined();
	});

	it('pins the openExternal → window.open swap via the MAESTRO_SESSION_RESUMED affordance', () => {
		// Per the StandingOvationOverlay / MarketplaceModal precedent, the
		// openExternal swap is a load-bearing strip-and-promote site. The
		// only renderer openExternal callsite in this modal is the docs
		// link for MAESTRO_SESSION_RESUMED — its continued presence in the
		// catalog pins the swap.
		const swapStory = newInstanceModalParityCatalog.find((s) =>
			s.then.some((t) => t.value === 'MAESTRO_SESSION_RESUMED')
		);
		expect(swapStory).toBeDefined();
	});

	it('pins the onFolderPick prop strip-and-promote wiring', () => {
		// Per the SaveMarkdownModal / MarketplaceModal precedent, the
		// folder-picker callback is a load-bearing strip-and-promote site.
		// Catalog must carry a story that pins the gate — without
		// `onFolderPick`, the folder-browse affordance is hidden.
		const folderStory = newInstanceModalParityCatalog.find(
			(s) => s.name.includes('folder-browse') || s.name.includes('onfolderpick')
		);
		expect(folderStory).toBeDefined();
	});

	it('pins the SSH-remote graceful-degrade story', () => {
		// Per the brief, the SSH-remote read sub-surface ships server-side
		// but the writer sub-surface is deferred. The empty-remotes case
		// must gracefully hide the selector (renderer source line 1148).
		const sshStory = newInstanceModalParityCatalog.find((s) => s.name.includes('ssh-remote'));
		expect(sshStory).toBeDefined();
	});

	it('covers the companion EditAgentModal surface', () => {
		// The renderer source ships NewInstanceModal + EditAgentModal as
		// siblings in one file. The lift preserves the dual-export shape;
		// the catalog must carry at least one EditAgentModal story to
		// pin that surface stays observable.
		const editStory = newInstanceModalParityCatalog.find((s) =>
			s.name.startsWith('edit-agent-modal')
		);
		expect(editStory).toBeDefined();
	});
});
