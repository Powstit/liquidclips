// Phase 8 · Mount #3 (2026-07-04) · WalletDetail is now the canonical
// AccountSection surface. The Section B port rendered the full account
// view — populated CLIPPERS roster · streak / paid / grace / cancelled
// row states · hover detail cards · drop ledger with fictional names
// (Marcus B., Chris N., Ella C., Alex R., Amy A., Jax H., Clara A.,
// Cole & Sam, Sasha G., Maya K. — guard rail 5). Prior AccountSection
// stub HUD cards read from `fixtures/fakeAccount.preview` and did not
// carry any user state (guard rail 11).
//
// IG-011 (webview room height cascade) is not applicable here —
// AccountSection is not a native-webview room. WalletDetail owns its
// own layout with the `.wd-root` full-viewport container.
//
// Kade decoupling: WalletDetail already computes its per-state kade
// pose internally via `stageDataState` and never imports the shared
// Kade anchor. `scripts/lint-kade-decoupling.sh` + `assert-kade-anchor.sh`
// stay green after this mount.
import { WalletDetail } from "../../routes/wallet-detail/WalletDetail";

export function AccountSection() {
  return <WalletDetail />;
}
