/**
 * useModalGate — webFull modal/overlay state-management primitive.
 *
 * Audit #10 pivot — orphan-to-mounted wiring.
 * ============================================
 *
 * Per the audit #10 "pair every future lift with same-commit mount edit"
 * pattern, mobile/App.tsx needed gate state for several lifted-but-orphaned
 * overlay components (AppOverlays trio + ShortcutsHelp + AutoRunnerHelp +
 * HistoryHelp + QuitConfirm + FileSearch). Each modal's state shape is:
 *
 *   const [open, setOpen] = useState(false);
 *   const show = useCallback(() => setOpen(true), []);
 *   const hide = useCallback(() => setOpen(false), []);
 *
 * Inlining that pattern six times in mobile/App.tsx exceeded the brief's
 * ~30 LOC threshold for a factor-out. This hook collapses each gate to a
 * single `useModalGate()` call and surfaces a stable tuple of three values:
 *
 *   - `open`   : boolean — current open state
 *   - `show`   : () => void — opens the gate
 *   - `hide`   : () => void — closes the gate
 *
 * Scope intentionally narrow: no layer-stack interaction, no priority logic,
 * no Escape handling. The lifted modals that DO use the LayerStack
 * (QuitConfirm, ShortcutsHelp, StandingOvation, FileSearch) register
 * internally via `useLayerStack`. This hook is just the local "is this
 * overlay currently mounted?" boolean.
 *
 * Why not just inline `useState`: factoring captures the muscle memory once
 * and prevents `setOpen` callbacks from drifting in spelling (`onShow` vs
 * `openHandler` vs `handleOpen`) across the six callsites.
 *
 * Pure: zero IPC, zero browser-API touches, zero side effects at module
 * load.
 */

import { useCallback, useState } from 'react';

export interface ModalGate {
	open: boolean;
	show: () => void;
	hide: () => void;
}

/**
 * Returns a stable open/show/hide tuple for a boolean modal/overlay gate.
 *
 * @param initial - Optional initial open state (defaults to false).
 * @returns A stable ModalGate with open / show / hide.
 */
export function useModalGate(initial = false): ModalGate {
	const [open, setOpen] = useState<boolean>(initial);
	const show = useCallback(() => setOpen(true), []);
	const hide = useCallback(() => setOpen(false), []);
	return { open, show, hide };
}

export default useModalGate;
