"use client";

// Agency invite-accept landing · Sprint B (2026-07-02).
//
// The invitee opens this page from the roster-invite email
// (account.liquidclips.app/invites/<token>) and one of four states renders:
//
//   1. Loading      · while the public preview endpoint resolves
//   2. Invalid      · 404 from preview (bad/revoked token) OR expired flag
//   3. Signed out   · CTA → /sign-up?redirect_url=/invites/<token>&prefill=<email>
//                     so Clerk drops them back here post-signup for auto-accept
//   4. Signed in    · auto-POST /api/invites/<token>/accept → success screen
//                     with a "download the desktop app" CTA
//
// The Phase 1 attribution stamp lives in the backend `accept_invite` and is
// the source of truth — we do NOT stamp any affiliate cookie from this page.
// Backend guards `if user.affiliate_id is None` so an existing first-touch
// referral is never overwritten by an invite accept.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useUser } from "@clerk/nextjs";
import { useParams } from "next/navigation";
import { track } from "@/lib/analytics";

const BACKEND_URL =
  process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "http://localhost:8000";
const DOWNLOAD_URL = "/download";
const DASHBOARD_URL = "/dashboard";

type PreviewOk = {
  email: string;
  role: "member" | "mod" | string;
  status: "pending" | "accepted" | "expired" | "revoked" | string;
  expires_at: string;
  expired: boolean;
};

type PreviewState =
  | { kind: "loading" }
  | { kind: "ok"; preview: PreviewOk }
  | { kind: "not_found" }
  | { kind: "error"; message: string };

type AcceptState =
  | { kind: "idle" }
  | { kind: "accepting" }
  | { kind: "accepted"; agencyId: string; role: string }
  | { kind: "email_mismatch"; expected: string; got: string }
  | { kind: "already_member" }
  | { kind: "failed"; message: string };

export default function InviteAcceptPage() {
  const params = useParams<{ token: string }>();
  const token = (params?.token ?? "").toString();
  const { isLoaded, isSignedIn, user } = useUser();

  const [preview, setPreview] = useState<PreviewState>({ kind: "loading" });
  const [accept, setAccept] = useState<AcceptState>({ kind: "idle" });

  // Fetch public preview once on mount (no auth required).
  useEffect(() => {
    if (!token) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizes React state with an external system — legitimate useEffect
      setPreview({ kind: "error", message: "Missing invite token." });
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(
          `${BACKEND_URL}/agency/invites/${encodeURIComponent(token)}/preview`,
          { cache: "no-store" },
        );
        if (cancelled) return;
        if (res.status === 404) {
          setPreview({ kind: "not_found" });
          track("agency_invite_viewed", { state: "not_found" });
          return;
        }
        if (!res.ok) {
          setPreview({ kind: "error", message: `HTTP ${res.status}` });
          track("agency_invite_viewed", { state: "error" });
          return;
        }
        const data = (await res.json()) as PreviewOk;
        setPreview({ kind: "ok", preview: data });
        track("agency_invite_viewed", {
          state: data.expired ? "expired" : data.status,
          role: data.role,
        });
      } catch {
        if (!cancelled) {
          setPreview({ kind: "error", message: "Network error." });
          track("agency_invite_viewed", { state: "network_error" });
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const preview_ok = preview.kind === "ok" ? preview.preview : null;
  const expectedEmail = preview_ok?.email ?? "";
  const signedInEmail = user?.primaryEmailAddress?.emailAddress ?? "";

  // Guard fires only when we have both sides — avoids a false mismatch during
  // Clerk hydration.
  const emailMismatch = useMemo(() => {
    if (!isLoaded || !isSignedIn) return false;
    if (!expectedEmail || !signedInEmail) return false;
    return expectedEmail.toLowerCase() !== signedInEmail.toLowerCase();
  }, [isLoaded, isSignedIn, expectedEmail, signedInEmail]);

  const canAutoAccept =
    preview_ok
    && !preview_ok.expired
    && preview_ok.status === "pending"
    && isLoaded
    && isSignedIn
    && !emailMismatch
    && accept.kind === "idle";

  const doAccept = useCallback(async () => {
    if (!token) return;
    setAccept({ kind: "accepting" });
    track("agency_invite_accept_started", { role: preview_ok?.role });
    try {
      const res = await fetch(`/api/invites/${encodeURIComponent(token)}/accept`, {
        method: "POST",
        cache: "no-store",
      });
      const text = await res.text();
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(text) as Record<string, unknown>;
      } catch {
        /* non-JSON — surface as generic failure below */
      }

      if (res.ok && body.ok) {
        const agencyId = (body.agency_id as string) ?? "";
        const role = (body.role as string) ?? "member";
        setAccept({ kind: "accepted", agencyId, role });
        track("agency_invite_accept_succeeded", { role });
        return;
      }
      if (res.status === 403 && typeof body.detail === "string" && /email/i.test(body.detail)) {
        setAccept({
          kind: "email_mismatch",
          expected: expectedEmail,
          got: signedInEmail,
        });
        track("agency_invite_accept_failed", { reason: "email_mismatch" });
        return;
      }
      if (res.status === 409 && typeof body.detail === "string" && /already/i.test(body.detail)) {
        setAccept({ kind: "already_member" });
        track("agency_invite_accept_failed", { reason: "already_member" });
        return;
      }
      setAccept({
        kind: "failed",
        message:
          (typeof body.detail === "string" && body.detail)
          || (typeof body.message === "string" && body.message)
          || `Accept failed (HTTP ${res.status}).`,
      });
      track("agency_invite_accept_failed", { reason: `http_${res.status}` });
    } catch {
      setAccept({ kind: "failed", message: "Network error. Try again." });
      track("agency_invite_accept_failed", { reason: "network" });
    }
  }, [token, preview_ok?.role, expectedEmail, signedInEmail]);

  // Auto-accept the moment the four preconditions align (preview ok + signed
  // in + email matches + no prior attempt).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- triggers async fetch that hydrates React state from backend — canonical external-sync use of useEffect
    if (canAutoAccept) void doAccept();
  }, [canAutoAccept, doAccept]);

  const signUpHref = useMemo(() => {
    if (!token) return "/sign-up";
    const returnTo = `/invites/${encodeURIComponent(token)}`;
    // Prefill the email so the invitee doesn't accidentally sign up with a
    // different address (which would trigger the email_mismatch branch on
    // return). Clerk reads `email_address_hint` on the hosted form.
    const params = new URLSearchParams({ redirect_url: returnTo });
    if (expectedEmail) params.set("email_address_hint", expectedEmail);
    return `/sign-up?${params.toString()}`;
  }, [token, expectedEmail]);

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "48px 24px",
        background: "var(--paper, #FAF7F2)",
      }}
    >
      <div
        style={{
          width: "100%",
          maxWidth: 560,
          background: "var(--paper-elev, #ffffff)",
          border: "1px solid var(--line, #E5E1D8)",
          borderRadius: 16,
          padding: "32px 32px 28px",
          boxShadow: "0 20px 60px -24px rgba(15, 15, 20, 0.20)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--font-geist-mono, ui-monospace, monospace)",
            fontSize: 11,
            letterSpacing: "0.16em",
            textTransform: "uppercase",
            color: "var(--fuchsia, #FF1A8C)",
            marginBottom: 12,
          }}
        >
          agency invite
        </div>

        {preview.kind === "loading" && (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Checking your invite…</h1>
            <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
              This takes a second.
            </p>
          </>
        )}

        {preview.kind === "not_found" && (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
              This invite link isn&rsquo;t valid.
            </h1>
            <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
              The token may have been revoked or never existed. Ask your agency owner
              to send a new invite.
            </p>
          </>
        )}

        {preview.kind === "error" && (
          <>
            <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Something went wrong.</h1>
            <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
              {preview.message} Refresh to try again.
            </p>
          </>
        )}

        {preview.kind === "ok" && preview_ok && (
          <>
            {preview_ok.expired || preview_ok.status === "expired" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  This invite has expired.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  Invites live for 14 days. Ask your agency owner to send a fresh one.
                </p>
              </>
            ) : preview_ok.status === "revoked" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  This invite was revoked.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  Reach out to the agency owner if you think this is wrong.
                </p>
              </>
            ) : preview_ok.status === "accepted" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  You&rsquo;re already in.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  This invite has already been accepted. Head to your dashboard.
                </p>
                <div style={{ marginTop: 24 }}>
                  <Link
                    href={DASHBOARD_URL}
                    style={{
                      display: "inline-block",
                      padding: "12px 22px",
                      borderRadius: 999,
                      background: "var(--fuchsia, #FF1A8C)",
                      color: "white",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Open dashboard →
                  </Link>
                </div>
              </>
            ) : !isLoaded ? (
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Loading…</h1>
            ) : !isSignedIn ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  You&rsquo;re invited to a Liquid Clips agency.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  Sign in with{" "}
                  <strong style={{ color: "var(--ink, #0A0A0F)" }}>{expectedEmail}</strong>{" "}
                  to accept. If you don&rsquo;t have an account yet, sign-up takes a minute.
                </p>
                <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Link
                    href={signUpHref}
                    style={{
                      display: "inline-block",
                      padding: "12px 22px",
                      borderRadius: 999,
                      background: "var(--fuchsia, #FF1A8C)",
                      color: "white",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Sign up + accept →
                  </Link>
                  <Link
                    href={`/sign-in?redirect_url=${encodeURIComponent(`/invites/${token}`)}`}
                    style={{
                      display: "inline-block",
                      padding: "12px 22px",
                      borderRadius: 999,
                      background: "transparent",
                      color: "var(--ink, #0A0A0F)",
                      border: "1px solid var(--line, #E5E1D8)",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    I already have an account
                  </Link>
                </div>
              </>
            ) : emailMismatch ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  Signed in as the wrong account.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  This invite was sent to{" "}
                  <strong style={{ color: "var(--ink, #0A0A0F)" }}>{expectedEmail}</strong>{" "}
                  but you&rsquo;re signed in as{" "}
                  <strong style={{ color: "var(--ink, #0A0A0F)" }}>{signedInEmail}</strong>.
                  Sign out and sign back in with the invited email.
                </p>
              </>
            ) : accept.kind === "accepting" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Accepting…</h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  Adding you to the roster.
                </p>
              </>
            ) : accept.kind === "accepted" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  You&rsquo;re on the roster.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  Download the Liquid Clips desktop app to start clipping for this
                  agency&rsquo;s campaigns.
                </p>
                <div style={{ marginTop: 24, display: "flex", gap: 12, flexWrap: "wrap" }}>
                  <Link
                    href={DOWNLOAD_URL}
                    style={{
                      display: "inline-block",
                      padding: "12px 22px",
                      borderRadius: 999,
                      background: "var(--fuchsia, #FF1A8C)",
                      color: "white",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Download for Mac →
                  </Link>
                  <Link
                    href={DASHBOARD_URL}
                    style={{
                      display: "inline-block",
                      padding: "12px 22px",
                      borderRadius: 999,
                      background: "transparent",
                      color: "var(--ink, #0A0A0F)",
                      border: "1px solid var(--line, #E5E1D8)",
                      textDecoration: "none",
                      fontWeight: 500,
                    }}
                  >
                    Open dashboard
                  </Link>
                </div>
              </>
            ) : accept.kind === "already_member" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>You&rsquo;re already in.</h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  This account is already on the agency roster. Head to your dashboard.
                </p>
                <div style={{ marginTop: 24 }}>
                  <Link
                    href={DASHBOARD_URL}
                    style={{
                      display: "inline-block",
                      padding: "12px 22px",
                      borderRadius: 999,
                      background: "var(--fuchsia, #FF1A8C)",
                      color: "white",
                      textDecoration: "none",
                      fontWeight: 600,
                    }}
                  >
                    Open dashboard →
                  </Link>
                </div>
              </>
            ) : accept.kind === "email_mismatch" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  Signed in as the wrong account.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  This invite was sent to{" "}
                  <strong style={{ color: "var(--ink, #0A0A0F)" }}>{accept.expected}</strong>{" "}
                  but you&rsquo;re signed in as{" "}
                  <strong style={{ color: "var(--ink, #0A0A0F)" }}>{accept.got}</strong>.
                  Sign out and try again with the invited email.
                </p>
              </>
            ) : accept.kind === "failed" ? (
              <>
                <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>
                  Accept failed.
                </h1>
                <p style={{ marginTop: 16, color: "var(--text-secondary, #666)" }}>
                  {accept.message} Refresh to try again, or ask the agency owner to
                  re-issue the invite.
                </p>
              </>
            ) : (
              <h1 style={{ margin: 0, fontSize: 24, fontWeight: 600 }}>Preparing to accept…</h1>
            )}
          </>
        )}
      </div>
    </main>
  );
}
