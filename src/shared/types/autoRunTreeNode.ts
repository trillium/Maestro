/**
 * AutoRunTreeNode — file/folder tree node used by the Auto Run document
 * selector and batch store.
 *
 * Promoted from `src/renderer/hooks/batch/useAutoRunHandlers.ts` so
 * `batchStore` (now in `src/shared/stores/`) can reference it without an
 * inverted cross-fork import.
 */
export interface AutoRunTreeNode {
	name: string;
	type: 'file' | 'folder';
	path: string;
	children?: AutoRunTreeNode[];
}
