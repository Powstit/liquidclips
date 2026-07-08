"use client";

/**
 * SignInOpsTab · P0 first-run access · admin surface for the dev-issue
 * license path (edit E of the P0 sprint) + Clerk exchange health.
 *
 * Renders:
 *   1. Env-gate status · reads `/admin/dev-issue-license` health via
 *      an explicit ping (400 = enabled, 403 = disabled) so admins see
 *      whether the ops window is currently open.
 *   2. "Issue LC license" button · calls `/admin/dev-issue-license`
 *      with the admin's own email · displays the license JWT ONCE in a
 *      copy-only text area · never persists locally, never logs, never
 *      re-fetches on refresh.
 *   3. Cold-lead offload health chip · reads `/audit/state` to confirm
 *      the cold-lead prep endpoint is reachable (unchanged by the P0
 *      sprint · surfaced here so a full sign-in review shows the whole
 *      first-touch surface at a glance).
 *
 * Auth: this tab lives inside AdminHQ · Clerk gates the surface at the
 * page layer + the backend endpoints require internal-secret. Ops
 * flows this component uses require the SAME internal secret every
 * other admin call already ships with — reuses the `sendInternal`
 * helper pattern.
 */
import { useCallback, useEffect, useState } from "react";

type Health = "unknown" | "ok" | "disabled" | "error";

export function SignInOpsTab({ adminEmail }: { adminEmail: string }) {
  const [devIssueHealth, setDevIssueHealth] = useState<Health>("unknown");
  const [coldLeadHealth, setColdLeadHealth] = useState<Health>("unknown");
  const [issuedJwt, setIssuedJwt] = useState<string | null>(null);
  const [issuedExpiresAt, setIssuedExpiresAt] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const checkHealth = useCallback(async () => {
    setErr(null);
    // Dev-issue endpoint probe · empty email = 400 (malformed) when
    // env-flag is ON, 403 when env-flag is OFF, 401 without secret.
    // Reuses the shipped endpoint · no dedicated probe route needed.
    try {
      const r = await fetch("/api/admin/dev-issue-license", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "" }),
      });
      if (r.status === 400) setDevIssueHealth("ok");
      else if (r.status === 403) setDevIssueHealth("disabled");
      else setDevIssueHealth("error");
    } catch {
      setDevIssueHealth("error");
    }
    // Cold-lead offload · GET /admin/cold-leads is the existing admin
    // read the ColdLeadsTab uses. Reachable = pipeline can accept HQ
    // enrichment writes (POST /cold-leads/prep from HQ).
    try {
      const r = await fetch("/api/admin/cold-leads", { method: "GET" });
      setColdLeadHealth(r.ok ? "ok" : "error");
    } catch {
      setColdLeadHealth("error");
    }
  }, []);

  useEffect(() => {
    void checkHealth();
  }, [checkHealth]);

  async function handleIssue() {
    setIssuing(true);
    setErr(null);
    setIssuedJwt(null);
    setIssuedExpiresAt(null);
    try {
      const r = await fetch("/api/admin/dev-issue-license", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: adminEmail }),
      });
      if (!r.ok) {
        setErr(`dev-issue failed · HTTP ${r.status}`);
        return;
      }
      const j = (await r.json()) as {
        license_jwt?: string;
        expires_at?: string;
      };
      if (!j.license_jwt) {
        setErr("no license_jwt in response");
        return;
      }
      setIssuedJwt(j.license_jwt);
      setIssuedExpiresAt(j.expires_at ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "network error");
    } finally {
      setIssuing(false);
    }
  }

  return (
    <div className="lc-hq-panel">
      <header className="lc-hq-panel-head">
        <h2 className="lc-hq-panel-title">Sign-in Ops</h2>
        <p className="lc-hq-panel-sub">
          P0 first-run access surface · Clerk OTP is the primary customer path.
          This tab is the ops mirror: dev-issue a Liquid Clips license without
          going through OTP, verify cold-lead offload still reachable, and
          confirm the dev-issue window is open before flipping it.
        </p>
      </header>

      <section className="lc-hq-grid">
        {/* --- Dev issue status --- */}
        <article className="lc-hq-card">
          <p className="lc-hq-eb">Dev issue license</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="lc-hq-chip"
              data-health={devIssueHealth}
              aria-label={`dev-issue health ${devIssueHealth}`}
            >
              {devIssueHealth === "ok"
                ? "Enabled · window open"
                : devIssueHealth === "disabled"
                  ? "Disabled · env flag off"
                  : devIssueHealth === "error"
                    ? "Unreachable"
                    : "Checking…"}
            </span>
            <button
              type="button"
              className="lc-hq-chip lc-hq-chip-btn"
              onClick={() => void checkHealth()}
            >
              Re-check
            </button>
          </div>
          <p className="lc-hq-help">
            Flip on Railway: <code>LC_DEV_ISSUE_LICENSE_ENABLED=1</code>. Flip
            off after use. Ships DISABLED by default.
          </p>
        </article>

        {/* --- Cold-lead offload health --- */}
        <article className="lc-hq-card">
          <p className="lc-hq-eb">Cold-lead offload</p>
          <div className="flex items-center gap-2 mt-1">
            <span
              className="lc-hq-chip"
              data-health={coldLeadHealth}
              aria-label={`cold-lead health ${coldLeadHealth}`}
            >
              {coldLeadHealth === "ok"
                ? "Reachable"
                : coldLeadHealth === "error"
                  ? "Unreachable"
                  : "Checking…"}
            </span>
            <button
              type="button"
              className="lc-hq-chip lc-hq-chip-btn"
              onClick={() => void checkHealth()}
            >
              Re-check
            </button>
          </div>
          <p className="lc-hq-help">
            HQ POSTs <code>/cold-leads/prep</code> with
            {" "}<code>preview_clip_url</code>. Untouched by the P0 sign-in
            sprint · listed here so a full first-touch review sees the whole
            surface at a glance.
          </p>
        </article>
      </section>

      {/* --- Issue license --- */}
      <section className="lc-hq-panel-section">
        <h3 className="lc-hq-panel-h3">Issue for {adminEmail}</h3>
        <p className="lc-hq-help">
          Mints a Liquid Clips license JWT for your admin email · paste into
          the desktop app&rsquo;s <em>Have an LC-ID?</em> recovery field. One-shot,
          no persistence, no log. Only runs when the env flag above is ON.
        </p>
        <div className="flex items-center gap-2 mt-3">
          <button
            type="button"
            className="lc-hq-btn-primary"
            disabled={issuing || devIssueHealth !== "ok"}
            onClick={() => void handleIssue()}
          >
            {issuing ? "Issuing…" : "Issue LC license"}
          </button>
          {err && <span className="lc-hq-err">{err}</span>}
        </div>

        {issuedJwt && (
          <div className="lc-hq-jwt-block">
            <p className="lc-hq-eb">License JWT · expires {issuedExpiresAt ?? "unknown"}</p>
            <textarea
              readOnly
              value={issuedJwt}
              className="lc-hq-jwt-textarea"
              rows={4}
              onFocus={(e) => e.currentTarget.select()}
              aria-label="License JWT · copy once"
            />
            <p className="lc-hq-help">
              Copy once, close this tab. Nothing on this page is persisted.
            </p>
          </div>
        )}
      </section>

      {/* --- Runbook --- */}
      <section className="lc-hq-panel-section">
        <h3 className="lc-hq-panel-h3">Runbook</h3>
        <ol className="lc-hq-runbook">
          <li>Railway dashboard → junior-backend → Variables → set <code>LC_DEV_ISSUE_LICENSE_ENABLED=1</code>. Redeploy.</li>
          <li>Refresh this tab. Chip flips to <strong>Enabled · window open</strong>.</li>
          <li>Click <strong>Issue LC license</strong>. Copy the JWT.</li>
          <li>Paste into desktop app → <em>Have an LC-ID?</em> recovery field. Shell opens.</li>
          <li>Return to Railway. Set <code>LC_DEV_ISSUE_LICENSE_ENABLED=0</code>. Redeploy.</li>
        </ol>
      </section>

      <style jsx>{`
        .lc-hq-panel { display: grid; gap: 20px; }
        .lc-hq-panel-title { font-size: 18px; font-weight: 600; letter-spacing: -0.01em; }
        .lc-hq-panel-sub { font-size: 13px; color: rgba(244,241,234,0.65); line-height: 1.55; margin: 4px 0 0; max-width: 720px; }
        .lc-hq-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 12px; }
        .lc-hq-card { padding: 14px 16px; border-radius: 12px; background: rgba(20,6,18,0.55); border: 1px solid rgba(255,255,255,0.08); }
        .lc-hq-eb { font-family: ui-monospace, 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: rgba(255,102,184,0.85); margin: 0 0 4px; }
        .lc-hq-help { font-size: 11px; line-height: 1.55; color: rgba(244,241,234,0.55); margin: 8px 0 0; }
        .lc-hq-chip { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; font-family: ui-monospace, 'Geist Mono', monospace; font-size: 10px; letter-spacing: 0.14em; text-transform: uppercase; background: rgba(255,255,255,0.06); color: rgba(244,241,234,0.7); }
        .lc-hq-chip[data-health="ok"] { background: rgba(74,222,128,0.14); color: #86efac; }
        .lc-hq-chip[data-health="disabled"] { background: rgba(250,204,21,0.14); color: #fde047; }
        .lc-hq-chip[data-health="error"] { background: rgba(248,113,113,0.14); color: #fca5a5; }
        .lc-hq-chip-btn { cursor: pointer; border: 0; background: rgba(255,255,255,0.08); }
        .lc-hq-btn-primary { padding: 8px 16px; border-radius: 10px; border: 0; background: linear-gradient(180deg, #ff1a8c, #d40d70); color: white; font-weight: 600; font-size: 13px; cursor: pointer; }
        .lc-hq-btn-primary:disabled { opacity: 0.5; cursor: not-allowed; }
        .lc-hq-err { font-size: 11px; color: #fca5a5; }
        .lc-hq-jwt-block { margin-top: 16px; }
        .lc-hq-jwt-textarea { width: 100%; padding: 10px 12px; border-radius: 8px; background: rgba(11,4,12,0.68); border: 1px solid rgba(255,26,140,0.32); color: #f4f1ea; font-family: ui-monospace, 'Geist Mono', monospace; font-size: 11px; word-break: break-all; }
        .lc-hq-panel-section { padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.06); }
        .lc-hq-panel-h3 { font-size: 14px; font-weight: 600; margin: 0 0 6px; }
        .lc-hq-runbook { padding-left: 20px; font-size: 12px; line-height: 1.7; color: rgba(244,241,234,0.72); }
        .lc-hq-runbook code { padding: 1px 6px; border-radius: 4px; background: rgba(255,26,140,0.12); font-size: 11px; }
      `}</style>
    </div>
  );
}
