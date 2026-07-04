"use client";

import { useCallback, useState } from "react";
import { AffiliateAgreementModal } from "@/components/legal/AffiliateAgreementModal";
import type { AgreementContext } from "@/lib/legal/affiliateAgreement";

interface Props {
  alreadySigned: boolean;
  frozen: boolean;
  frozenReason: string | null;
  requireResign: boolean;
  context: AgreementContext;
  email: string | null;
  returnTo: string | null;
}

export function AffiliateAgreementPageClient({
  alreadySigned,
  frozen,
  frozenReason,
  requireResign,
  context,
  email,
  returnTo,
}: Props): React.ReactElement {
  const [signedNow, setSignedNow] = useState(false);
  const [receipt, setReceipt] = useState<string | null>(null);

  const handleSigned = useCallback(
    (receiptSha256: string) => {
      setSignedNow(true);
      setReceipt(receiptSha256);
      // Two paths for closing the modal:
      //  · Tauri browse panel — the desktop shell listens for
      //    `postMessage` and closes itself on `affiliate_agreement_signed`.
      //  · Standalone browser — nav to returnTo (from query string) or /wallet.
      try {
        window.opener?.postMessage(
          { type: "affiliate_agreement_signed", receipt_sha256: receiptSha256 },
          "*",
        );
        window.parent?.postMessage(
          { type: "affiliate_agreement_signed", receipt_sha256: receiptSha256 },
          "*",
        );
      } catch {
        /* noop — cross-origin restrictions on postMessage */
      }
      if (returnTo && /^\//.test(returnTo)) {
        setTimeout(() => {
          window.location.href = returnTo;
        }, 1200);
      }
    },
    [returnTo],
  );

  if (alreadySigned && !requireResign && !signedNow) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center text-white">
        <h1 className="text-xl font-semibold">Agreement already signed</h1>
        <p className="text-sm text-white/60">
          {email ? `Signed by ${email}.` : "Signed on file."} You can close this window and continue with
          your payout.
        </p>
        {returnTo ? (
          <a
            href={returnTo}
            className="rounded-xl bg-yellow-400 px-4 py-3 text-sm font-semibold text-black"
          >
            Return to wallet
          </a>
        ) : null}
      </main>
    );
  }

  if (frozen) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center text-white">
        <h1 className="text-xl font-semibold text-red-300">Agreement frozen</h1>
        <p className="text-sm text-white/70">
          A payment dispute on your subscription has automatically frozen your affiliate agreement per
          Section 3.B of the Partner &amp; Affiliate Agreement. No further payouts can be released until the
          dispute is resolved.
        </p>
        {frozenReason ? (
          <p className="rounded-lg bg-white/5 px-3 py-2 font-mono text-[11px] text-white/50">
            Freeze reason: {frozenReason}
          </p>
        ) : null}
        <p className="text-sm text-white/60">
          Contact support to resolve the dispute. Once cleared, sign a new agreement to resume payouts.
        </p>
      </main>
    );
  }

  if (signedNow) {
    return (
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-4 p-6 text-center text-white">
        <h1 className="text-xl font-semibold text-green-300">Signed</h1>
        <p className="text-sm text-white/70">
          Receipt hash <code className="font-mono text-[11px]">{receipt}</code> stored. Your payout gate is
          now open.
        </p>
        <p className="text-xs text-white/50">
          You can close this window.{returnTo ? " We&apos;ll bounce you back to the wallet in a moment." : ""}
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-4xl flex-col gap-6 p-6 text-white">
      <AffiliateAgreementModal context={context} onSigned={handleSigned} />
    </main>
  );
}
