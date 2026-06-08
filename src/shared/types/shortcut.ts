/**
 * Shortcut — keyboard hotkey descriptor.
 *
 * Promoted from `src/renderer/types/index.ts` to `src/shared/types/` so it
 * can be consumed from both the Electron renderer and the web/webFull fork
 * without a cross-fork import.
 */
export interface Shortcut {
	id: string;
	label: string;
	keys: string[];
}
