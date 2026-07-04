# Liquid Clips Partner & Affiliate Agreement · v1.0

**Contract version:** `LC_AFFILIATE_v1.0`
**Effective Date:** Date of Click-Acceptance
**Platform Operator:** Liquidclips Ltd, a trading name of Company Number 15591903 (registered in England & Wales)
**Participant Profile:** Dynamically bound to **Whop User ID:** `{{whop_user_id}}` · **Verified Payout Address:** `{{payout_address}}`

---

## 1. Binding Electronic Consent & Identity Affirmation

By checking the box marked *"I agree to the Commercial Terms"* and clicking the *"Activate System Dashboard"* button, the individual or entity associated with **Whop User ID: `{{whop_user_id}}`** (hereafter referred to as the **"Participant"**) explicitly executes this legally binding B2B contract.

The Participant acknowledges that their identity has been fully verified via Whop's Know Your Customer (KYC) and Know Your Business (KYB) infrastructure. The Participant agrees that their unique Whop account credentials and click-action constitute an absolute, un-repudiable electronic signature under the Electronic Signatures in Global and National Commerce (ESIGN) Act, the Uniform Electronic Transactions Act (UETA), the UK Electronic Communications Act 2000, and equivalent global commerce law.

## 2. Immediate Commercial Access & Waiver of 14-Day Consumer Cooling-Off Rights

The Participant is entering into a commercial, business-to-business (B2B) partnership to utilise the Liquid Clips processing architecture for commercial revenue generation.

The Participant explicitly requests and demands immediate activation of the automated clipping engine and the Google People API ingestion sequence. The Participant explicitly acknowledges that by accessing the live dashboard and initiating cloud rendering or data extraction, **they are intentionally waiving and forfeiting any statutory 14-day consumer cooling-off periods or refund rights** provided under UK, European, US, or international consumer protection regulations, as the digital service is consumed instantly upon activation.

## 3. Conditional Commissions & Absolute Right of Set-Off

The distribution of the 50% lifetime recurring affiliate split to the Participant's Whop wallet is strictly conditional upon the Participant maintaining a primary subscription account in perfect financial standing.

In the event that the Participant initiates a chargeback, payment dispute, bank retrieval request, or clawback via their financial institution against the primary $99.99/mo subscription fee or any platform transaction:

* **A. Material Breach.** Such action shall instantly constitute an incurable, material breach of this Agreement.
* **B. Automated Payout Forfeiture.** Liquidclips Ltd reserves the absolute **Right of Set-Off** to instantly freeze, seize, and permanently liquidate any pending, accumulated, or future affiliate commissions, balances, or Whop wallet credits associated with **Whop User ID: `{{whop_user_id}}`**.
* **C. Debt Satisfaction & Fees.** Forfeited commercial balances will be applied programmatically by the platform to satisfy the disputed subscription balance, alongside a **$50.00 USD administrative processing fee** per dispute event.
* **D. Absolute Waiver of Claim.** The Participant explicitly waives all current and future legal claims, actions, or demands to any affiliate balances or referral payouts liquidated under this set-off provision.

## 4. Direct Operational Sanctions

Upon the detection of a payment dispute webhook associated with the Participant's profile, the platform architecture will automatically execute the following system protocols:

1. Immediate and permanent deletion of the Participant's custom affiliate tracking URLs.
2. Permanent blacklisting of the underlying verified Whop ID and associated device fingerprints from creating future platform nodes.
3. Automatic generation and submission of this signed digital ledger receipt, matched with the Participant's Whop KYC verification data, directly to the relevant card-issuing bank to contest the dispute.

---

## Consumer Capacity Acknowledgment (only if Participant self-identifies as a private individual)

*By participating in this commercial referral pool, you declare that you are utilising this platform for professional trade purposes and explicitly forfeit all personal consumer statutory refund rights.*

---

## Evidence Receipt Payload (persisted server-side on click-acceptance)

```json
{
  "contract_version": "LC_AFFILIATE_v1.0",
  "whop_user_id": "usr_xxxxxxxxxxxxxxxx",
  "kyc_status": "VERIFIED_BY_WHOP",
  "signing_capacity": "BUSINESS" | "INDIVIDUAL",
  "timestamp": "2026-07-04T21:05:32Z",
  "ip_address": "184.22.109.5",
  "user_agent": "Mozilla/5.0 (...)",
  "scroll_completed": true,
  "signature_action": "EXPLICIT_CLICK_TO_ACCEPT",
  "receipt_sha256": "<64-hex-char digest of the canonical JSON above>"
}
```

The `receipt_sha256` is computed after all other fields are frozen and provides a tamper-evident digest for downstream chargeback evidence submission.
