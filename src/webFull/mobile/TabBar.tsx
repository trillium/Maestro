/**
 * TabBar (mobile re-export shim) — Layer 4.2
 *
 * The TabBar lift was promoted from `src/webFull/mobile/TabBar.tsx` to
 * `src/webFull/components/TabBar.tsx` in Layer 4.2 so the desktop layout
 * can mount the same component without crossing the mobile/ subtree. This
 * file remains as a verbatim re-export so existing imports (in
 * `mobile/App.tsx` and any future mobile-only consumers) keep working
 * without a flag-day rename.
 *
 * New code should import directly from `src/webFull/components/TabBar` or
 * via `src/webFull/components/index.ts`.
 */
export { TabBar, default } from '../components/TabBar';
export type { TabBarProps } from '../components/TabBar';
