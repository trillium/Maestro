/**
 * History constants — re-export shim.
 *
 * Lifted into webFull as a re-export rather than a verbatim copy because
 * these are non-divergent constants (lookback period definitions, row-height
 * estimates, the DoubleCheck SVG component) shared between the Electron
 * renderer and webFull. The renderer is the single source of truth; webFull
 * consumers reach them via this shim.
 *
 * Drift-prevention rationale: per Architect 2026-06-08 audit risk A —
 * "verbatim duplication of stable constants creates silent drift surfaces."
 * If a future divergence emerges (e.g. webFull wants different lookback
 * defaults for mobile), fork this file at that point. Up-front forking is
 * hard to walk back; re-exports are cheap to specialize later.
 *
 * 0 IPC namespaces touched. 0 Electron-only APIs touched.
 */

export * from '../../../renderer/components/History/historyConstants';
