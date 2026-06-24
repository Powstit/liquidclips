"use client";

// HQ Agent 5 · Recovery success panel.
//
// Rendered ONCE on a successful /verify response. Shows the freshly minted
// TOTP seed (text + provisioning URI for QR rendering) and ten backup codes.
// The backend will never echo these again — navigating away from this page
// loses them forever.
//
// All copy hammers that point so a panicking Daniel doesn't close the tab
// without saving. Defensive Copy-to-clipboard + a "I've saved everything"
// confirmation are deliberately separate actions so the user has to actively
// move past each block.

import { useEffect, useState } from "react";

type Props = {
  totpSeed: string;
  totpProvisioningUri: string;
  backupCodes: string[];
};

// Tiny in-page QR-code generator using the chart.googleapis fallback would
// ping a 3rd party; instead we render the otpauth:// URI as text and let the
// authenticator app accept the seed directly. Daniel can also paste the
// seed into 1Password / Bitwarden / Google Authenticator manually.
export function SuccessPanel({
  totpSeed,
  totpProvisioningUri,
  backupCodes,
}: Props) {
  const [confirmed, setConfirmed] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  // After 10 minutes blank everything client-side as a last-resort defence
  // against a screen left unattended. The user is told this up-front.
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    const t = window.setTimeout(() => setExpired(true), 10 * 60 * 1000);
    return () => window.clearTimeout(t);
  }, []);

  async function copy(value: string, field: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField(null), 1500);
    } catch {
      // Clipboard API blocked — fall back to a noop; the user can still
      // select the text manually.
    }
  }

  if (expired) {
    return (
      <div className="rounded-xl border border-fuchsia/40 bg-paper-elev p-6 text-center">
        <h2 className="text-xl font-semibold text-fuchsia-deep">
          Session expired
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          For your safety, the recovery secrets were blanked from this page
          after 10 minutes. If you didn&apos;t save them, run the recovery
          flow again — your old TOTP seed has already been replaced and is
          gone too. Each run consumes one of your 3 daily attempts.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-fuchsia/60 bg-fuchsia-soft p-5">
        <p className="text-sm font-semibold uppercase tracking-wide text-fuchsia-deep">
          Save these now — you will not see them again
        </p>
        <p className="mt-2 text-sm text-ink">
          Your old TOTP seed has been replaced. The new seed below is the only
          way back into your account. Backup codes are single-use; tear them
          off after each use.
        </p>
      </div>

      {/* TOTP seed */}
      <section className="rounded-xl border border-line bg-paper-elev p-5">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">
            New TOTP seed
          </h3>
          <button
            type="button"
            onClick={() => copy(totpSeed, "seed")}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          >
            {copiedField === "seed" ? "Copied" : "Copy"}
          </button>
        </header>
        <code className="block break-all rounded-md border border-line bg-paper p-3 font-mono text-sm text-ink">
          {totpSeed}
        </code>
        <p className="mt-3 text-xs text-text-tertiary">
          Add to an authenticator app (1Password, Authy, Google Authenticator,
          Bitwarden). The provisioning URI below also works — most apps accept
          it as a manual entry.
        </p>
        <div className="mt-3 flex items-center justify-between gap-3">
          <code className="flex-1 break-all rounded-md border border-line bg-paper p-2 font-mono text-[11px] text-text-secondary">
            {totpProvisioningUri}
          </code>
          <button
            type="button"
            onClick={() => copy(totpProvisioningUri, "uri")}
            className="shrink-0 rounded-md border border-line px-2.5 py-1 text-xs text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          >
            {copiedField === "uri" ? "Copied" : "Copy URI"}
          </button>
        </div>
      </section>

      {/* Backup codes */}
      <section className="rounded-xl border border-line bg-paper-elev p-5">
        <header className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-ink">
            Backup codes ({backupCodes.length})
          </h3>
          <button
            type="button"
            onClick={() => copy(backupCodes.join("\n"), "backup")}
            className="rounded-md border border-line px-2.5 py-1 text-xs text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          >
            {copiedField === "backup" ? "Copied" : "Copy all"}
          </button>
        </header>
        <ul className="grid grid-cols-1 gap-1 sm:grid-cols-2">
          {backupCodes.map((code) => (
            <li
              key={code}
              className="rounded-md border border-line bg-paper p-2 font-mono text-sm text-ink"
            >
              {code}
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-text-tertiary">
          Each code works once. Cross them off as you spend them. When you
          have fewer than three remaining, run this flow again to regenerate.
        </p>
      </section>

      {/* Confirmation gate */}
      <section className="rounded-xl border border-line bg-paper-elev p-5">
        <label className="flex items-start gap-3 text-sm text-ink">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1 size-4 accent-[color:var(--fuchsia)]"
          />
          <span>
            I&apos;ve saved the TOTP seed and backup codes somewhere safe
            (password manager, encrypted note, printed and locked away).
          </span>
        </label>
        <a
          href="/admin"
          aria-disabled={!confirmed}
          tabIndex={confirmed ? 0 : -1}
          onClick={(e) => {
            if (!confirmed) e.preventDefault();
          }}
          className={`mt-4 inline-flex w-full items-center justify-center rounded-md px-4 py-2 text-sm font-semibold transition ${
            confirmed
              ? "bg-fuchsia text-paper hover:brightness-110"
              : "cursor-not-allowed bg-paper-warm text-text-tertiary"
          }`}
        >
          Continue to HQ
        </a>
      </section>
    </div>
  );
}
