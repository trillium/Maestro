/**
 * Utility functions for batch processing of markdown task documents.
 * Extracted from useBatchProcessor.ts for reusability.
 */

import type { TaskSelectionMode } from '../../types';

let cachedAutorunDefaultPrompt: string = '';
let cachedAutorunPerTaskBlock: string = '';
let cachedAutorunPerDocumentBlock: string = '';
let batchUtilsPromptsLoaded = false;

export async function loadBatchUtilsPrompts(force = false): Promise<void> {
	if (batchUtilsPromptsLoaded && !force) return;

	const [defaultResult, perTaskResult, perDocResult] = await Promise.all([
		window.maestro.prompts.get('autorun-default'),
		window.maestro.prompts.get('autorun-per-task'),
		window.maestro.prompts.get('autorun-per-document'),
	]);
	if (!defaultResult.success) {
		throw new Error(`Failed to load autorun-default prompt: ${defaultResult.error}`);
	}
	if (!perTaskResult.success) {
		throw new Error(`Failed to load autorun-per-task prompt: ${perTaskResult.error}`);
	}
	if (!perDocResult.success) {
		throw new Error(`Failed to load autorun-per-document prompt: ${perDocResult.error}`);
	}
	cachedAutorunDefaultPrompt = defaultResult.content!;
	cachedAutorunPerTaskBlock = perTaskResult.content!;
	cachedAutorunPerDocumentBlock = perDocResult.content!;
	batchUtilsPromptsLoaded = true;
	// Update the exported binding so consumers see the loaded value
	DEFAULT_BATCH_PROMPT = cachedAutorunDefaultPrompt;
}

function getAutorunDefaultPrompt(): string {
	return cachedAutorunDefaultPrompt;
}

/**
 * Return the cached task-selection block content for the requested mode. Strips
 * trailing newlines so substituting into the prompt doesn't introduce extra
 * blank lines around the swapped block. Falls back to the per-task block if a
 * caller passes an unrecognized value.
 */
export function getTaskSelectionBlock(mode: TaskSelectionMode | undefined): string {
	const content = mode === 'document' ? cachedAutorunPerDocumentBlock : cachedAutorunPerTaskBlock;
	return content.replace(/\s+$/, '');
}

// Default batch processing prompt (exported for use by BatchRunnerModal and playbook management)
// Uses `let` so the binding can be updated after async IPC load completes
export let DEFAULT_BATCH_PROMPT: string = getAutorunDefaultPrompt();

// Regex to count unchecked markdown checkboxes: - [ ] task (also * [ ] or + [ ])
const UNCHECKED_TASK_REGEX = /^[\s]*[-*+]\s*\[\s*\]\s*.+$/;

// Regex to count checked markdown checkboxes: - [x] task (also * [x] or + [x])
const CHECKED_TASK_COUNT_REGEX = /^[\s]*[-*+]\s*\[[xX✓✔]\]\s*.+$/;

// Regex to match checked markdown checkboxes for reset-on-completion
// Matches both [x] and [X] with various checkbox formats (standard and GitHub-style)
const CHECKED_TASK_REGEX = /^(\s*[-*+]\s*)\[[xX✓✔]\]/gm;

export interface MarkdownTaskCounts {
	checked: number;
	unchecked: number;
	total: number;
}

/**
 * Count markdown checkbox tasks while ignoring fenced code blocks.
 * This prevents example snippets from affecting Auto Run progress.
 */
export function countMarkdownTasks(content: string): MarkdownTaskCounts {
	const normalizedContent = content.replace(/\r\n?/g, '\n');
	let checked = 0;
	let unchecked = 0;
	let inFencedCode = false;
	let fenceChar: '`' | '~' | null = null;
	let openFenceLength = 0;

	for (const line of normalizedContent.split('\n')) {
		const trimmed = line.trimStart();
		const fenceMatch = trimmed.match(/^([`~]{3,})/);
		if (fenceMatch) {
			const currentFenceChar = fenceMatch[1][0] as '`' | '~';
			if (!inFencedCode) {
				inFencedCode = true;
				fenceChar = currentFenceChar;
				openFenceLength = fenceMatch[1].length;
				continue;
			}
			if (fenceChar === currentFenceChar && fenceMatch[1].length >= openFenceLength) {
				inFencedCode = false;
				fenceChar = null;
				openFenceLength = 0;
				continue;
			}
		}

		if (inFencedCode) continue;

		if (CHECKED_TASK_COUNT_REGEX.test(line)) {
			checked++;
		} else if (UNCHECKED_TASK_REGEX.test(line)) {
			unchecked++;
		}
	}

	return {
		checked,
		unchecked,
		total: checked + unchecked,
	};
}

/**
 * Count unchecked tasks in markdown content
 * Matches lines like: - [ ] task description
 */
export function countUnfinishedTasks(content: string): number {
	return countMarkdownTasks(content).unchecked;
}

/**
 * Count checked tasks in markdown content
 * Matches lines like: - [x] task description
 */
export function countCheckedTasks(content: string): number {
	return countMarkdownTasks(content).checked;
}

/**
 * Uncheck all markdown checkboxes in content (for reset-on-completion)
 * Converts all - [x] to - [ ] (case insensitive)
 */
export function uncheckAllTasks(content: string): string {
	return content.replace(CHECKED_TASK_REGEX, '$1[ ]');
}

/**
 * Validates that an agent prompt contains references to Markdown tasks.
 * Uses regex heuristics to check for common patterns indicating the prompt
 * instructs the agent to process checkbox-style Markdown tasks.
 *
 * Returns true if the prompt is valid (contains task references).
 */
export function validateAgentPromptHasTaskReference(prompt: string): boolean {
	if (!prompt || !prompt.trim()) return false;

	const patterns = [
		/markdown\s+task/i, // "markdown task", "Markdown Tasks", etc.
		/- \[ \]/, // literal checkbox syntax
		/- \[x\]/i, // checked checkbox syntax
		/unchecked\s+task/i, // "unchecked task"
		/checkbox/i, // "checkbox"
		/check\s*off\s+task/i, // "check off task"
		/task.*\bcompleted?\b.*\[/i, // "task completed [" or "task complete ["
		/\btask.*- \[/i, // "task ... - [" (task followed by checkbox)
	];

	return patterns.some((pattern) => pattern.test(prompt));
}
