/**
 * AppOverlays.tsx
 *
 * Layer 2.5 — leaf-parade lift of `src/renderer/components/AppOverlays.tsx`
 * (129 LOC) into `src/webFull/`. Renderer source is a small dispatcher
 * surface that gates rendering of three full-screen celebration / recognition
 * overlays based on the modal store's data presence:
 *
 *   - `StandingOvationOverlay`        (badge unlocks + Auto Run records)
 *   - `FirstRunCelebration`           (first Auto Run completion)
 *   - `KeyboardMasteryCelebration`    (keyboard shortcut mastery level-ups)
 *
 * Pre-flight `grep -E "window\.maestro\.|from ['\"]electron['\"]|shell\.openExternal|shell\.openPath|ipcRenderer" src/renderer/components/AppOverlays.tsx`
 * returned empty (exit 1). The dispatcher itself touches none of the banned
 * surface; all side-effecting actions are delivered through prop callbacks
 * (`onCloseStandingOvation`, `onOpenLeaderboardRegistration`, `onCloseFirstRun`,
 * `onCloseKeyboardMastery`).
 *
 * ## Two decisions worth naming
 *
 * ### 1. Store self-source stripped — promoted to props
 *
 * Renderer source self-sources from two stores under the "Tier 1A" pattern:
 *
 *   const standingOvationData       = useModalStore(selectModalData('standingOvation')) ?? null;
 *   const firstRunCelebrationData   = useModalStore(selectModalData('firstRunCelebration')) ?? null;
 *   const keyboardMasteryData       = useModalStore(selectModalData('keyboardMastery'));
 *   const shortcuts                 = useSettingsStore((s) => s.shortcuts);
 *   const disableConfetti           = useSettingsStore((s) => s.disableConfetti);
 *
 * Those two stores are renderer-only architecture as of this lift —
 * `src/renderer/stores/settingsStore.ts` carries 20+ `window.maestro.settings.set`
 * callsites and there is no `src/webFull/stores/` directory yet. Lifting the
 * stores would explode this leaf into a multi-file wave that pulls in the
 * entire IPC-persisted settings layer (and the modal-registry store with it).
 *
 * The matching webFull pattern: **promote the self-sourced values to props**.
 * The host (a downstream layer-wiring pass) decides whether those values come
 * from a future webFull-side modal store, from REST-backed `useSettings()`,
 * or from prop drilling at the App root. The component stays a pure dispatcher
 * with no implicit data dependencies. This matches the L4.1 `SessionList`
 * precedent of stripping renderer-specific store hooks at the lift boundary
 * and letting the consumer wire the data source.
 *
 * ### 2. Overlay children passed as render slots (not imported)
 *
 * The renderer dispatcher imports the three overlays directly:
 *
 *   import { StandingOvationOverlay } from './StandingOvationOverlay';
 *   import { FirstRunCelebration } from './FirstRunCelebration';
 *   import { KeyboardMasteryCelebration } from './KeyboardMasteryCelebration';
 *
 * Of those three, only `FirstRunCelebration` has been lifted to webFull (in
 * `leaf-first-run-celebration` @ `fd9bc3cf9`). `StandingOvationOverlay` and
 * `KeyboardMasteryCelebration` are not yet in webFull. Two paths considered:
 *
 *   (a) Import the unlifted overlays from `'../../renderer/components/...'`.
 *       Rejected — `StandingOvationOverlay.tsx` carries a
 *       `window.maestro.shell.openExternal` call (renderer line ~~177
 *       region — pre-flight grep confirmed 1 hit), which would drag an IPC
 *       site through the webFull bundle entry point even if it's lambda-
 *       deferred. Cross-fork import is also the audit-risk-A silent-drift
 *       surface this fork-hygiene rule exists to prevent (see Decisions
 *       2026-06-08 — "Drift fix: `MODAL_PRIORITIES` and `Layer` types").
 *
 *   (b) Accept the three overlays as render-prop slots — `ReactNode` props
 *       that the host renders once per dispatch and passes pre-bound. Chosen.
 *       The dispatcher then becomes a pure render-gate: when the data prop
 *       is non-null, render the matching slot; otherwise render nothing.
 *       The gate logic — the actual lift surface — is verbatim from the
 *       renderer source.
 *
 * When `StandingOvationOverlay` and `KeyboardMasteryCelebration` are lifted
 * in future leaf parades, the host wiring layer can either:
 *   - Keep the render-slot pattern (the dispatcher stays decoupled from the
 *     overlay surfaces), or
 *   - Inline the three component imports at the host call site and pass
 *     pre-rendered nodes.
 *
 * Either choice is host-local — the dispatcher contract is stable.
 *
 * ## Import-path adapts
 *
 * - `Theme` from `'../types'` → `'../../shared/theme-types'` (standard L2.5
 *   swap; the renderer aggregator routes through `src/renderer/types/index.ts`
 *   which itself re-exports from `src/shared/theme-types`; webFull pulls the
 *   type directly from the canonical source).
 * - `ConductorBadge` from `'../constants/conductorBadges'` →
 *   `'../../renderer/constants/conductorBadges'`. The constants module is
 *   pure data (zero IPC, zero Electron API surface — verified by pre-flight
 *   grep), matching the L2.5 `ShortcutsHelpModal` / `MarkdownRenderer`
 *   precedent of pulling non-divergent renderer modules directly by relative
 *   path rather than duplicating into `src/shared/` (which would create the
 *   audit-risk-A silent-drift surface).
 *
 * ## What this lift is NOT
 *
 * - Not a lift of `StandingOvationOverlay` (1 IPC, deferred to a future leaf).
 * - Not a lift of `KeyboardMasteryCelebration` (deferred to a future leaf).
 * - Not a lift of `useModalStore` / `useSettingsStore` (deferred to a future
 *   webFull-side modal-registry + settings-store wave).
 * - Not a feature-wiring change in `src/webFull/App.tsx` — the dispatcher
 *   has zero consumers in webFull yet, and feature wiring is a downstream-
 *   layer concern.
 *
 * 0 IPC, 0 Electron-only APIs, 0 `src/main/` touches, 0 `src/renderer/` edits,
 * 0 `src/web/` edits, 0 `src/server/` edits.
 */

import type { ReactNode } from 'react';
import type { Theme } from '../../shared/theme-types';
import type { ConductorBadge } from '../../renderer/constants/conductorBadges';

/**
 * Props for StandingOvationOverlay data — preserved verbatim from the
 * renderer source so a future host can pass the same shape it already
 * threads into the renderer dispatcher.
 */
export interface StandingOvationData {
	badge: ConductorBadge;
	isNewRecord: boolean;
	recordTimeMs?: number;
}

/**
 * Props for FirstRunCelebration data — preserved verbatim from the renderer
 * source for the same host-portability reason.
 */
export interface FirstRunCelebrationData {
	elapsedTimeMs: number;
	completedTasks: number;
	totalTasks: number;
}

/**
 * Props for AppOverlays component.
 *
 * Diverges from the renderer source in two ways (see file header):
 *
 *   1. The three data values that the renderer self-sources from
 *      `useModalStore` are now explicit props. `null` (or the matching
 *      "level is null" gate for keyboard mastery) means "do not render
 *      this overlay".
 *   2. The three overlay components that the renderer imports directly
 *      become render-prop slots. The host passes a pre-bound `ReactNode`
 *      (or `null`) per overlay; the dispatcher renders the slot iff its
 *      matching data prop is non-null.
 *
 * The renderer's prop callbacks (`onCloseStandingOvation`,
 * `onCloseFirstRun`, `onCloseKeyboardMastery`,
 * `onOpenLeaderboardRegistration`) are NOT part of the dispatcher's
 * surface in webFull — they are the responsibility of whoever renders
 * the slot. This preserves the rule that the dispatcher is a pure
 * visibility gate.
 *
 * `theme` is kept as a prop per the L2.1 / L2.3 / L2.4 / L2.5 convention,
 * even though the dispatcher itself does not render any theme-styled DOM.
 * Future host wiring may want to thread `theme` through to one of the
 * slots without repeating the `useTheme()` lookup; keeping the prop in
 * place preserves that affordance.
 */
export interface AppOverlaysProps {
	// Theme — preserved on the prop surface for host convenience (see header)
	theme: Theme;

	// Data gates (promoted from the renderer's store self-source)
	standingOvationData: StandingOvationData | null;
	firstRunCelebrationData: FirstRunCelebrationData | null;
	pendingKeyboardMasteryLevel: number | null;

	// Render slots (the renderer dispatcher imported these as components)
	standingOvationSlot?: ReactNode;
	firstRunCelebrationSlot?: ReactNode;
	keyboardMasterySlot?: ReactNode;
}

/**
 * AppOverlays — Renders celebration overlay slots based on current data.
 *
 * Render order mirrors the renderer source verbatim:
 *   1. FirstRunCelebration  (mounts first)
 *   2. KeyboardMastery      (mounts second)
 *   3. StandingOvation      (mounts third — top of the visual stack)
 *
 * The gating predicate mirrors the renderer verbatim:
 *   - FirstRunCelebration  : data !== null
 *   - KeyboardMastery      : pendingKeyboardMasteryLevel !== null
 *   - StandingOvation      : data !== null
 *
 * The `theme` parameter is intentionally accepted-but-unused — see the
 * AppOverlaysProps comment for why it stays on the surface.
 */

export function AppOverlays({
	theme: _theme,
	standingOvationData,
	firstRunCelebrationData,
	pendingKeyboardMasteryLevel,
	standingOvationSlot,
	firstRunCelebrationSlot,
	keyboardMasterySlot,
}: AppOverlaysProps): JSX.Element {
	return (
		<>
			{/* --- FIRST RUN CELEBRATION OVERLAY --- */}
			{firstRunCelebrationData !== null && firstRunCelebrationSlot}

			{/* --- KEYBOARD MASTERY CELEBRATION OVERLAY --- */}
			{pendingKeyboardMasteryLevel !== null && keyboardMasterySlot}

			{/* --- STANDING OVATION OVERLAY --- */}
			{standingOvationData !== null && standingOvationSlot}
		</>
	);
}

export default AppOverlays;
