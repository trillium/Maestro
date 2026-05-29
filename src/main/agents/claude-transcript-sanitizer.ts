/**
 * Claude Transcript Sanitizer
 *
 * Strips `thinking` / `redacted_thinking` blocks out of a Claude Code JSONL
 * transcript so it can be safely resumed under a *different token source* - the
 * Adaptive-mode (maestro-p) interactive->API fallback.
 *
 * Why this exists
 * ---------------
 * maestro-p's interactive turns persist thinking blocks as signature-only
 * shells: the `thinking` text is empty but a `signature` (bound to the
 * subscription account that produced it) is retained. When the wrapper exits
 * with code 2 mid-turn (Max-plan quota), the controller respawns the same
 * prompt under `claude --print --resume`, which re-sends those blocks to the
 * Anthropic API. The API rejects the request with:
 *
 *   400 messages.N.content.M: `thinking` or `redacted_thinking` blocks in the
 *   latest assistant message cannot be modified. These blocks must remain as
 *   they were in the original response.
 *
 * because the empty content no longer matches the signature. The blocks also
 * can't cross the subscription->API account boundary at all (signatures are
 * account-scoped), so the only safe action is to drop them. Once a poisoned
 * block is in history, every subsequent `--resume` re-hits the same 400, which
 * is what makes a conversation get permanently "stuck".
 *
 * Thinking blocks are ephemeral reasoning, not user-visible content. Removing
 * them leaves all text and tool-use blocks intact and keeps the conversation
 * fully resumable in either mode.
 *
 * Transform
 * ---------
 *   - For every assistant message, remove `thinking` / `redacted_thinking`
 *     content blocks.
 *   - If a message's content becomes empty, drop the whole row and re-link any
 *     descendants (`parentUuid`) to the dropped row's parent so the linked-list
 *     threading Claude Code relies on stays intact (transitively, in case of
 *     consecutive dropped rows).
 *   - Non-message rows (attachment, last-prompt, mode, ...) are preserved; only
 *     their `parentUuid` is re-linked when it pointed at a dropped row.
 *
 * The file is rewritten atomically (temp file + rename). A one-time `.bak`
 * sibling is written before the first mutation so the original is recoverable.
 *
 * Idempotent: a transcript with no thinking blocks is left byte-for-byte
 * unchanged and reports `sanitized: false`.
 */

import * as fs from 'fs';

const THINKING_BLOCK_TYPES = new Set(['thinking', 'redacted_thinking']);

export interface SanitizeResult {
	/** True when the transcript was rewritten (at least one block removed). */
	sanitized: boolean;
	/** Assistant rows dropped because their content became empty. */
	droppedRows: number;
	/** Thinking blocks removed from rows that retained other content. */
	strippedBlocks: number;
	/** Path of the `.bak` written before mutation, or null when untouched. */
	backupPath: string | null;
}

interface ParsedRow {
	raw: string;
	obj: Record<string, unknown> | null;
}

function isThinkingBlock(block: unknown): boolean {
	return (
		!!block &&
		typeof block === 'object' &&
		THINKING_BLOCK_TYPES.has((block as { type?: unknown }).type as string)
	);
}

function getMessage(obj: Record<string, unknown>): Record<string, unknown> | null {
	const msg = obj.message;
	return msg && typeof msg === 'object' ? (msg as Record<string, unknown>) : null;
}

/**
 * Strip thinking blocks from the transcript at `transcriptPath`.
 *
 * Returns a no-op result (and leaves the file untouched) when the path doesn't
 * exist or contains no thinking blocks. Throws only on unexpected I/O failures
 * the caller should surface; malformed individual lines are passed through
 * verbatim rather than dropped.
 */
export function stripThinkingFromTranscript(transcriptPath: string): SanitizeResult {
	const noop: SanitizeResult = {
		sanitized: false,
		droppedRows: 0,
		strippedBlocks: 0,
		backupPath: null,
	};

	if (!fs.existsSync(transcriptPath)) return noop;

	const original = fs.readFileSync(transcriptPath, 'utf8');
	// Preserve trailing-newline shape: split on \n, the final element is the
	// trailing-newline remainder (usually "") which we re-join unchanged.
	const lines = original.split('\n');

	const rows: ParsedRow[] = lines.map((raw: string) => {
		const trimmed = raw.trim();
		if (trimmed.length === 0) return { raw, obj: null };
		try {
			const obj = JSON.parse(trimmed) as Record<string, unknown>;
			return { raw, obj };
		} catch {
			return { raw, obj: null };
		}
	});

	// Pass 1: decide which rows to drop and which to rewrite, and remember each
	// dropped row's parentUuid so descendants can be re-linked.
	const droppedParentByUuid = new Map<string, string | null>();
	let droppedRows = 0;
	let strippedBlocks = 0;

	for (const row of rows) {
		if (!row.obj) continue;
		const msg = getMessage(row.obj);
		const content = msg?.content;
		if (!Array.isArray(content)) continue;

		const thinkingCount = content.filter(isThinkingBlock).length;
		if (thinkingCount === 0) continue;

		const remaining = content.filter((b) => !isThinkingBlock(b));
		if (remaining.length === 0) {
			const uuid = typeof row.obj.uuid === 'string' ? row.obj.uuid : null;
			const parentUuid =
				typeof row.obj.parentUuid === 'string' ? (row.obj.parentUuid as string) : null;
			if (uuid) droppedParentByUuid.set(uuid, parentUuid);
			droppedRows += 1;
		} else {
			strippedBlocks += thinkingCount;
		}
	}

	if (droppedRows === 0 && strippedBlocks === 0) return noop;

	// Resolve a parentUuid past any chain of dropped rows.
	const resolveParent = (parentUuid: string | null): string | null => {
		let current = parentUuid;
		const seen = new Set<string>();
		while (current && droppedParentByUuid.has(current)) {
			if (seen.has(current)) break; // cycle guard
			seen.add(current);
			current = droppedParentByUuid.get(current) ?? null;
		}
		return current;
	};

	// Pass 2: emit the rewritten transcript.
	const outLines: string[] = [];
	for (const row of rows) {
		if (!row.obj) {
			outLines.push(row.raw);
			continue;
		}

		const uuid = typeof row.obj.uuid === 'string' ? row.obj.uuid : null;
		if (uuid && droppedParentByUuid.has(uuid)) {
			// This row was dropped.
			continue;
		}

		let mutated = false;
		const obj = row.obj;

		// Re-link parentUuid if it pointed at a dropped row.
		const parentUuid = typeof obj.parentUuid === 'string' ? (obj.parentUuid as string) : null;
		if (parentUuid && droppedParentByUuid.has(parentUuid)) {
			obj.parentUuid = resolveParent(parentUuid);
			mutated = true;
		}

		// Strip thinking blocks from a surviving (mixed-content) message.
		const msg = getMessage(obj);
		const content = msg?.content;
		if (Array.isArray(content) && content.some(isThinkingBlock)) {
			msg!.content = content.filter((b) => !isThinkingBlock(b));
			mutated = true;
		}

		outLines.push(mutated ? JSON.stringify(obj) : row.raw);
	}

	const output = outLines.join('\n');

	// Back up the original once, then rewrite atomically.
	const backupPath = `${transcriptPath}.maestro-presanitize.bak`;
	if (!fs.existsSync(backupPath)) {
		fs.writeFileSync(backupPath, original, 'utf8');
	}

	const tmpPath = `${transcriptPath}.maestro-sanitize.tmp`;
	fs.writeFileSync(tmpPath, output, 'utf8');
	fs.renameSync(tmpPath, transcriptPath);

	return { sanitized: true, droppedRows, strippedBlocks, backupPath };
}
