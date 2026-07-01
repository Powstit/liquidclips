/**
 * AffiliateWidget · v2.2.14 · unified handle + share URL surface.
 *
 * Renders inside the Earn route as the top card. Shows:
 *   · @handle (editable · one-click rename)
 *   · liquidclips.app/join/<handle> share URL with copy button
 *   · QR code (SVG · copy-image + download-PNG)
 *   · Live stats from /affiliate/me · paid referrals · MRR · earnings
 *
 * Handle rename hits POST /me/handle · client validates first for
 * fast feedback · backend re-validates + enforces uniqueness. Reserved
 * handles + duplicates surface as inline errors, not toast noise.
 *
 * QR: qrcode.react renders as SVG so it stays sharp at any size. Copy
 * button uses navigator.clipboard.write with an ImageBlob (falls back
 * to selecting the SVG DOM for older clients).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { getJwt } from "../../lib/authStorage";

// Mirror backend rules from routes/handle.py so the client rejects
// obvious mistakes BEFORE round-tripping.
const HANDLE_SHAPE = /^[a-z0-9._-]{3,30}$/;

interface MeSnapshot {
  user: { id: string; email: string | null; handle: string | null } | null;
}

interface AffiliateBlock {
  connected: boolean;
  affiliate_code: string | null;
  referral_url: string | null;
  active_members_count: number | null;
  total_referrals_count: number | null;
  monthly_recurring_revenue_usd: string | null;
  total_referral_earnings_usd: string | null;
}

function backendUrl(): string {
  try {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const v = (import.meta as any).env?.VITE_BACKEND_URL as string | undefined;
    if (typeof v === "string" && v.length > 0) return v;
  } catch { /* noop */ }
  return "https://api.liquidclips.app";
}

async function fetchMe(): Promise<MeSnapshot | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const r = await fetch(`${backendUrl()}/me`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    return (await r.json()) as MeSnapshot;
  } catch { return null; }
}

async function fetchAffiliate(): Promise<AffiliateBlock | null> {
  const jwt = getJwt();
  if (!jwt) return null;
  try {
    const r = await fetch(`${backendUrl()}/affiliate/me`, {
      cache: "no-store",
      headers: { authorization: `Bearer ${jwt}` },
    });
    if (!r.ok) return null;
    const data = await r.json();
    return (data?.affiliate as AffiliateBlock) ?? null;
  } catch { return null; }
}

interface SetHandleResult {
  ok: boolean;
  handle?: string;
  share_url?: string;
  error?: string;
}

async function setHandle(next: string): Promise<SetHandleResult> {
  const jwt = getJwt();
  if (!jwt) return { ok: false, error: "sign_in_required" };
  try {
    const r = await fetch(`${backendUrl()}/me/handle`, {
      method: "POST",
      cache: "no-store",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${jwt}`,
      },
      body: JSON.stringify({ handle: next }),
    });
    if (r.ok) {
      const data = await r.json();
      return { ok: true, handle: data.handle, share_url: data.share_url };
    }
    const body = await r.json().catch(() => ({}));
    const detail = typeof body?.detail === "string" ? body.detail : "handle_error";
    return { ok: false, error: detail };
  } catch {
    return { ok: false, error: "network" };
  }
}

export function AffiliateWidget(): JSX.Element {
  const [handle, setHandleState] = useState<string | null>(null);
  const [shareUrl, setShareUrl] = useState<string>("");
  const [affiliate, setAffiliate] = useState<AffiliateBlock | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<"idle" | "url" | "qr">("idle");
  const qrRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const [me, aff] = await Promise.all([fetchMe(), fetchAffiliate()]);
      if (cancelled) return;
      const h = me?.user?.handle ?? null;
      setHandleState(h);
      setShareUrl(h ? `https://liquidclips.app/join/${h}` : "");
      setAffiliate(aff);
    })();
    return () => { cancelled = true; };
  }, []);

  const canPersist = useMemo(() => HANDLE_SHAPE.test(draft.trim().toLowerCase()), [draft]);

  const onSubmit = async () => {
    const next = draft.trim().toLowerCase();
    if (!next || saving) return;
    if (!HANDLE_SHAPE.test(next)) {
      setError("Use 3-30 lowercase letters, numbers, dash, dot, or underscore.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await setHandle(next);
    setSaving(false);
    if (res.ok && res.handle) {
      setHandleState(res.handle);
      setShareUrl(res.share_url ?? `https://liquidclips.app/join/${res.handle}`);
      setEditing(false);
      setDraft("");
    } else {
      const map: Record<string, string> = {
        handle_taken: "That handle is already taken.",
        handle_reserved: "That handle is reserved.",
        handle_too_short: "Handle is too short after cleanup.",
        handle_too_long: "Handle is too long.",
        sign_in_required: "Sign in to rename your handle.",
        network: "Couldn't reach the server. Try again.",
      };
      setError(map[res.error ?? ""] ?? "Couldn't rename right now.");
    }
  };

  const copyUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState("url");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch { /* noop */ }
  };

  const copyQr = async () => {
    if (!qrRef.current) return;
    const svg = qrRef.current.querySelector("svg");
    if (!svg) return;
    // Rasterise the SVG to a PNG blob so the clipboard receives an
    // image (native paste as image works in Slack, Discord, Notes).
    try {
      const svgStr = new XMLSerializer().serializeToString(svg);
      const svgBlob = new Blob([svgStr], { type: "image/svg+xml" });
      const url = URL.createObjectURL(svgBlob);
      const img = new Image();
      img.crossOrigin = "anonymous";
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error("qr img load"));
        img.src = url;
      });
      const canvas = document.createElement("canvas");
      canvas.width = 320; canvas.height = 320;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("no canvas ctx");
      ctx.fillStyle = "#0b0b10";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 20, 20, 280, 280);
      URL.revokeObjectURL(url);
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        try {
          const item = new ClipboardItem({ "image/png": blob });
          await navigator.clipboard.write([item]);
          setCopyState("qr");
          window.setTimeout(() => setCopyState("idle"), 1800);
        } catch { /* older browsers · silent */ }
      }, "image/png");
    } catch { /* noop */ }
  };

  return (
    <section className="lc-affiliate-widget" data-testid="lc-affiliate-widget">
      <div className="lc-affiliate-widget-head">
        <span className="lc-affiliate-widget-eyebrow">Your affiliate link</span>
        <span className="lc-affiliate-widget-status" data-connected={affiliate?.connected ?? false}>
          {affiliate?.connected ? "50% recurring · active" : "Connect Whop to activate"}
        </span>
      </div>

      <div className="lc-affiliate-widget-body">
        <div className="lc-affiliate-widget-left">
          <span className="lc-affiliate-widget-label">Handle</span>
          {!editing ? (
            <div className="lc-affiliate-widget-handle-row">
              <span className="lc-affiliate-widget-handle">
                {handle ? `@${handle}` : "@—"}
              </span>
              <button
                type="button"
                className="lc-affiliate-widget-btn-quiet"
                onClick={() => { setEditing(true); setDraft(handle ?? ""); setError(null); }}
              >
                Rename
              </button>
            </div>
          ) : (
            <div className="lc-affiliate-widget-edit-row">
              <span className="lc-affiliate-widget-prefix">@</span>
              <input
                type="text"
                className="lc-affiliate-widget-input"
                value={draft}
                onChange={(e) => setDraft(e.target.value.toLowerCase())}
                placeholder="your-handle"
                maxLength={30}
                disabled={saving}
                autoFocus
              />
              <button
                type="button"
                className="lc-affiliate-widget-btn-primary"
                onClick={() => void onSubmit()}
                disabled={!canPersist || saving}
              >
                {saving ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="lc-affiliate-widget-btn-quiet"
                onClick={() => { setEditing(false); setError(null); }}
                disabled={saving}
              >
                Cancel
              </button>
            </div>
          )}
          {error ? <p className="lc-affiliate-widget-error">{error}</p> : null}

          <span className="lc-affiliate-widget-label" style={{ marginTop: 18 }}>
            Share URL
          </span>
          <div className="lc-affiliate-widget-url-row">
            <span className="lc-affiliate-widget-url">
              {shareUrl || "liquidclips.app/join/—"}
            </span>
            <button
              type="button"
              className="lc-affiliate-widget-btn-primary"
              onClick={() => void copyUrl()}
              disabled={!shareUrl}
            >
              {copyState === "url" ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>

        <div className="lc-affiliate-widget-right">
          <div ref={qrRef} className="lc-affiliate-widget-qr">
            {shareUrl ? (
              <QRCodeSVG value={shareUrl} size={140} bgColor="#0b0b10" fgColor="#f4f1ea" level="M" />
            ) : (
              <div className="lc-affiliate-widget-qr-placeholder">Set a handle to generate QR</div>
            )}
          </div>
          <button
            type="button"
            className="lc-affiliate-widget-btn-quiet"
            onClick={() => void copyQr()}
            disabled={!shareUrl}
          >
            {copyState === "qr" ? "Copied ✓" : "Copy QR"}
          </button>
        </div>
      </div>

      <div className="lc-affiliate-widget-stats">
        <div className="lc-affiliate-widget-stat">
          <span className="lc-affiliate-widget-stat-value">
            {affiliate?.active_members_count ?? "—"}
          </span>
          <span className="lc-affiliate-widget-stat-label">Paid referrals</span>
        </div>
        <div className="lc-affiliate-widget-stat">
          <span className="lc-affiliate-widget-stat-value">
            {affiliate?.monthly_recurring_revenue_usd
              ? `$${affiliate.monthly_recurring_revenue_usd}`
              : "$—"}
          </span>
          <span className="lc-affiliate-widget-stat-label">MRR</span>
        </div>
        <div className="lc-affiliate-widget-stat">
          <span className="lc-affiliate-widget-stat-value">
            {affiliate?.total_referral_earnings_usd
              ? `$${affiliate.total_referral_earnings_usd}`
              : "$—"}
          </span>
          <span className="lc-affiliate-widget-stat-label">Total earned</span>
        </div>
      </div>
    </section>
  );
}
