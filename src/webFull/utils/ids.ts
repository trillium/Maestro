/**
 * ids — re-export of generate id helper from renderer.
 *
 * Per Architect 2026-06-08 audit risk A (silent drift surface): non-divergent
 * helpers stay re-exported from `src/renderer/` rather than being copied. This
 * file exposes the renderer `generateId` so webFull components (e.g.
 * CreateGroupModal lifted in Layer 2.4) can import it without forking a
 * parallel copy. `generateId` is a one-liner over `crypto.randomUUID()` —
 * zero IPC, zero Electron-only APIs — and has no reason to diverge.
 */
export { generateId } from '../../renderer/utils/ids';
