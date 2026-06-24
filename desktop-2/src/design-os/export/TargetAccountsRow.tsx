/**
 * TargetAccountsRow · Phase 6H H-11
 *
 * Horizontal row of account chips that are currently TARGETED for this
 * clip's export. Each chip uses AccountChipState so the visual state map
 * is canonical. Trailing "+ Add account" chip opens AddAccountPopover.
 *
 * Per §12.4: chip count is capped by tier (Clipper=1 · Pro=3 · Agency=10).
 * The cap is enforced by hiding the Add chip + showing an inline upgrade
 * pill once the cap is hit.
 */

import { AccountChipState } from "./AccountChipState";
import { useTierCaps } from "../state/useTierCaps";
import type { TargetAccount } from "./types";
import "./TargetAccountsRow.css";

export interface TargetAccountsRowProps {
  targets: ReadonlyArray<TargetAccount>;
  onRemove?: (id: string) => void;
  onAddAccount?: () => void;
  onChipClick?: (a: TargetAccount) => void;
  /** When true (Clipper UI), suppress brand badges on chips. */
  hideBrand?: boolean;
}

export function TargetAccountsRow({
  targets, onRemove, onAddAccount, onChipClick, hideBrand,
}: TargetAccountsRowProps) {
  const tier = useTierCaps();
  const cap = tier.caps.accountsPerClip;
  const atCap = targets.length >= cap;

  return (
    <div className="lc-tar">
      <header className="lc-tar-head">
        <span className="lc-tar-eb">Target accounts</span>
        <span className="lc-tar-count">
          {targets.length} of {cap === Infinity ? "∞" : cap}
        </span>
      </header>

      <div className="lc-tar-row">
        {targets.length === 0 && (
          <div className="lc-tar-empty">
            <span>No accounts targeted yet.</span>
          </div>
        )}

        {targets.map((a) => (
          <AccountChipState
            key={a.id}
            account={a}
            variant="chip"
            removable
            onRemove={() => onRemove?.(a.id)}
            onClick={() => onChipClick?.(a)}
            hideBrand={hideBrand}
          />
        ))}

        {!atCap && (
          <button
            type="button"
            className="lc-tar-add"
            onClick={onAddAccount}
            aria-label="Add account to this clip"
          >
            <span className="lc-tar-add-plus">+</span>
            <span className="lc-tar-add-body">Add account</span>
          </button>
        )}

        {atCap && (
          <div className="lc-tar-cap" role="status" aria-live="polite">
            <span className="lc-tar-cap-eb">Tier cap reached</span>
            <span className="lc-tar-cap-sub">
              {tier.tier === "agency"
                ? "Agency caps at 10 accounts per clip."
                : `Upgrade for more · ${tier.tier === "clipper" ? "Pro = 3" : "Agency = 10"} accounts.`}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
