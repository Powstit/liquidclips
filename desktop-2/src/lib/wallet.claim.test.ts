/**
 * Task D · desktop-2 wallet Claim button wire · unit tests.
 *
 * Covers the pure predicates + shape helpers exported from
 * `desktop-2/src/lib/wallet.ts`. The `postWalletClaim` fetcher +
 * `postMessage` bridge live inside a React component + rely on
 * `getJwt()` from authStorage; those are exercised in an
 * end-to-end `tauri dev` walk (see the D receipt). This file
 * pins the contract shape so a Rust / backend renaming can't
 * silently break the wire.
 */

import { describe, it, expect } from "vitest";
import {
  AGREEMENT_SIGNED_EVENT,
  CLAIM_BLOCKED_HEADING,
  isAgreementSignedMessage,
} from "./wallet";

describe("wallet.ts · Task D · claim wire helpers", () => {
  it("exposes stable copy for both blocked codes", () => {
    // The backend can return either code; the UI must have
    // a heading for both. If the backend introduces a new code,
    // the fallback path in WalletDetail uses blocked_reason.message
    // directly.
    expect(CLAIM_BLOCKED_HEADING.signature_required).toMatch(
      /sign your Partner Agreement/i,
    );
    expect(CLAIM_BLOCKED_HEADING.signature_required).toMatch(
      /takes about a minute/i,
    );
    expect(CLAIM_BLOCKED_HEADING.signature_frozen).toMatch(
      /frozen following a payment dispute/i,
    );
    expect(CLAIM_BLOCKED_HEADING.signature_frozen).toMatch(
      /contact support/i,
    );
  });

  it("AGREEMENT_SIGNED_EVENT constant matches the account-app contract", () => {
    // The account-app signature page emits this exact string. If
    // either side renames the event, the auto-retry-after-signing
    // path stops working silently.
    expect(AGREEMENT_SIGNED_EVENT).toBe("affiliate_agreement_signed");
  });

  it("isAgreementSignedMessage accepts a valid payload", () => {
    expect(
      isAgreementSignedMessage({
        type: "affiliate_agreement_signed",
        receipt_sha256: "abcdef1234567890",
      }),
    ).toBe(true);
  });

  it("isAgreementSignedMessage rejects payloads with the wrong event type", () => {
    expect(
      isAgreementSignedMessage({
        type: "affiliate_agreement_declined",
        receipt_sha256: "abcdef",
      }),
    ).toBe(false);
    expect(
      isAgreementSignedMessage({ type: "signed", receipt_sha256: "abcdef" }),
    ).toBe(false);
  });

  it("isAgreementSignedMessage rejects payloads missing receipt_sha256", () => {
    expect(
      isAgreementSignedMessage({
        type: "affiliate_agreement_signed",
      }),
    ).toBe(false);
    expect(
      isAgreementSignedMessage({
        type: "affiliate_agreement_signed",
        receipt_sha256: "",
      }),
    ).toBe(false);
  });

  it("isAgreementSignedMessage rejects null / primitives / arrays", () => {
    expect(isAgreementSignedMessage(null)).toBe(false);
    expect(isAgreementSignedMessage(undefined)).toBe(false);
    expect(isAgreementSignedMessage("affiliate_agreement_signed")).toBe(false);
    expect(isAgreementSignedMessage(42)).toBe(false);
    expect(isAgreementSignedMessage([])).toBe(false);
  });
});
