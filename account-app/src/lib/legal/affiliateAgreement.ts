// Liquid Clips Partner & Affiliate Agreement · v1.0
//
// Contract text is rendered verbatim in `AffiliateAgreementModal.tsx`.
// The IntersectionObserver sentinel that unlocks the "Activate System
// Dashboard" button lives at the bottom of the scroll region.
//
// KEEP THIS FILE IN LOCKSTEP with `junior-backend/docs/legal/
// affiliate-agreement-v1.0.md`. The backend uses the ID string as the
// contract_version; the two must match byte-for-byte on the identifier
// or the click-wrap gate rejects the sign attempt.

export const CURRENT_CONTRACT_VERSION = "LC_AFFILIATE_v1.0" as const;

export type SigningCapacity = "BUSINESS" | "INDIVIDUAL";

export interface AgreementContext {
  whopUserId: string | null;
  payoutAddress: string | null;
}

// Section 2 injects an extra paragraph when the user self-identifies
// as a private individual. This string is shown IN ADDITION TO the
// full agreement text, not in place of any paragraph.
export const INDIVIDUAL_CAPACITY_ACKNOWLEDGMENT =
  "By participating in this commercial referral pool, you declare that you are utilising this platform for professional trade purposes and explicitly forfeit all personal consumer statutory refund rights.";

export interface AgreementSection {
  heading: string;
  paragraphs: string[];
  // Nested lettered clauses (Section 3 uses A/B/C/D). Rendered as an
  // ordered list under the paragraphs.
  clauses?: { marker: string; body: string }[];
}

export function buildAgreementSections(ctx: AgreementContext): AgreementSection[] {
  const whop = ctx.whopUserId ?? "(unbound — sign in via Whop to bind this receipt)";
  const payout = ctx.payoutAddress ?? "(no payout address on file yet)";

  return [
    {
      heading: "1. Binding Electronic Consent & Identity Affirmation",
      paragraphs: [
        `By checking the box marked "I agree to the Commercial Terms" and clicking the "Activate System Dashboard" button, the individual or entity associated with Whop User ID: ${whop} (hereafter referred to as the "Participant") explicitly executes this legally binding B2B contract.`,
        `The Participant acknowledges that their identity has been fully verified via Whop's Know Your Customer (KYC) and Know Your Business (KYB) infrastructure. The Participant agrees that their unique Whop account credentials and click-action constitute an absolute, un-repudiable electronic signature under the Electronic Signatures in Global and National Commerce (ESIGN) Act, the Uniform Electronic Transactions Act (UETA), the UK Electronic Communications Act 2000, and equivalent global commerce law.`,
      ],
    },
    {
      heading: "2. Immediate Commercial Access & Waiver of 14-Day Consumer Cooling-Off Rights",
      paragraphs: [
        "The Participant is entering into a commercial, business-to-business (B2B) partnership to utilise the Liquid Clips processing architecture for commercial revenue generation.",
        "The Participant explicitly requests and demands immediate activation of the automated clipping engine and the Google People API ingestion sequence. The Participant explicitly acknowledges that by accessing the live dashboard and initiating cloud rendering or data extraction, they are intentionally waiving and forfeiting any statutory 14-day consumer cooling-off periods or refund rights provided under UK, European, US, or international consumer protection regulations, as the digital service is consumed instantly upon activation.",
      ],
    },
    {
      heading: "3. Conditional Commissions & Absolute Right of Set-Off",
      paragraphs: [
        "The distribution of the 50% lifetime recurring affiliate split to the Participant's Whop wallet is strictly conditional upon the Participant maintaining a primary subscription account in perfect financial standing.",
        "In the event that the Participant initiates a chargeback, payment dispute, bank retrieval request, or clawback via their financial institution against the primary $99.99/mo subscription fee or any platform transaction:",
      ],
      clauses: [
        {
          marker: "A. Material Breach.",
          body: "Such action shall instantly constitute an incurable, material breach of this Agreement.",
        },
        {
          marker: "B. Automated Payout Forfeiture.",
          body: `Liquidclips Ltd reserves the absolute Right of Set-Off to instantly freeze, seize, and permanently liquidate any pending, accumulated, or future affiliate commissions, balances, or Whop wallet credits associated with Whop User ID: ${whop}.`,
        },
        {
          marker: "C. Debt Satisfaction & Fees.",
          body: "Forfeited commercial balances will be applied programmatically by the platform to satisfy the disputed subscription balance, alongside a $50.00 USD administrative processing fee per dispute event.",
        },
        {
          marker: "D. Absolute Waiver of Claim.",
          body: "The Participant explicitly waives all current and future legal claims, actions, or demands to any affiliate balances or referral payouts liquidated under this set-off provision.",
        },
      ],
    },
    {
      heading: "4. Direct Operational Sanctions",
      paragraphs: [
        "Upon the detection of a payment dispute webhook associated with the Participant's profile, the platform architecture will automatically execute the following system protocols:",
        "(1) Immediate and permanent deletion of the Participant's custom affiliate tracking URLs.",
        "(2) Permanent blacklisting of the underlying verified Whop ID and associated device fingerprints from creating future platform nodes.",
        "(3) Automatic generation and submission of this signed digital ledger receipt, matched with the Participant's Whop KYC verification data, directly to the relevant card-issuing bank to contest the dispute.",
      ],
    },
    {
      heading: "Participant Payout Binding",
      paragraphs: [
        `Verified Payout Address: ${payout}`,
        "Any future modification to the payout address requires re-signature of this Agreement under a new receipt hash.",
      ],
    },
    {
      heading: "Platform Operator",
      paragraphs: [
        "Liquidclips Ltd, a trading name of Company Number 15591903 (registered in England & Wales).",
        "This Agreement is governed by the laws of England & Wales. The Participant submits to the non-exclusive jurisdiction of the English courts for any dispute arising from or relating to this Agreement, without prejudice to Liquidclips Ltd's right to pursue enforcement in the Participant's home jurisdiction.",
      ],
    },
  ];
}
