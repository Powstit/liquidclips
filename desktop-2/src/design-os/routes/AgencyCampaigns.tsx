/**
 * Agency Campaign Builder route · Sprint D (2026-07-02).
 *
 * The "meat" of the agency product — where an owner builds, connects,
 * and publishes a Whop content-reward campaign. Wires to the four
 * shipped agency-campaign endpoints via the sibling
 * `desktop-2/src/lib/agencyCampaigns.ts` wrappers:
 *
 *   listMyCampaigns  · GET  /agency/campaigns
 *   createCampaign   · POST /agency/campaigns              · create-draft
 *   patchCampaign    · PATCH /agency/campaigns/{slug}      · edit
 *   connectReward    · POST /agency/campaigns/{slug}/connect-reward
 *   publishCampaign  · POST /agency/campaigns/{slug}/publish
 *
 * DECOUPLING (per Daniel's directive):
 *   · Does NOT import from lib/agency.ts (roster/payout/rules) — that
 *     file backs the Settings-mounted panels; this route is independent.
 *   · Does NOT reach into design-os/routes/agency-panels/ — the two
 *     surfaces are siblings. A future consolidation would MOVE files,
 *     never cross-import between builder + panels.
 *
 * TIER GATE (server + client mirror):
 *   · Server: agency_campaigns.py::_require_agency now calls
 *     `is_agency_tier(user.tier)` → 403 for anyone whose resolved tier
 *     is not in {agency, agency_solo, agency_whitelabel, autopilot}
 *     (founder + admin still bypass).
 *   · Client: this component checks `tier === "agency"` before rendering
 *     the builder. Non-agency users see an upgrade wall pointing at
 *     /pricing. The client Tier enum collapses all three backend
 *     agency-family strings to "agency" via mapBackendTier — one truth,
 *     mirrored client + server.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CampaignBlock,
  CampaignCreatePayload,
  CampaignPatchPayload,
  CampaignStatus,
  ConnectRewardPayload,
  CampaignType,
} from "../../lib/agencyCampaigns";
import {
  connectReward,
  createCampaign,
  listMyCampaigns,
  patchCampaign,
  publishCampaign,
  slugify,
} from "../../lib/agencyCampaigns";
import { openInApp } from "../../lib/openInApp";
import { WHOP_BOUNTY_CAPTURED_EVENT, type WhopBountyCaptured } from "../../lib/whopBountyCapture";
import { bus } from "../bridge";
import { DesignOSAppShell } from "../components/AppShell";
import { ROUTE_REGISTRY } from "../routing/routeRegistry";
import { canUseAgencyActions, useTierCaps } from "../state/useTierCaps";
// 2026-07-03 · Step 2 batch 2f · server-owned capability primitives.
// Preferred over `tier.adminOverride` for new gates.
import { CAP, hasCapability } from "../../lib/authz/capabilities";
// ag-07 fix (2026-07-06) · Sovereign-Operator Protocol · wrap the campaign
// builder so a mid-render crash lands in KadeRepairScreen instead of taking
// the shell down. The grid + editor is the agency-tier revenue arm.
import { Watchdog } from "../../lib/watchdog/Watchdog";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; campaigns: CampaignBlock[] }
  | { kind: "forbidden"; message: string }
  | { kind: "offline"; message: string }
  | { kind: "error"; message: string };

const CAMPAIGN_TYPES: readonly CampaignType[] = [
  "clip",
  "coordination",
  "affiliate",
  "submission",
];

export function AgencyCampaignsRoute(): JSX.Element {
  const tier = useTierCaps();
  const spec = ROUTE_REGISTRY["campaign-builder"];

  // 2026-07-03 · Step 2 batch 2f · server-owned capability gate.
  // Primary check: server-authoritative agency.workspace.read capability
  // (read by /me + /sync via the projection). Falls back to legacy
  // tier === "agency" || adminOverride during the compat window so an
  // unloaded /me snapshot doesn't lock the founders out.
  const gated =
    hasCapability(tier.capabilities, CAP.AGENCY_WORKSPACE_READ)
    || tier.tier === "agency"
    || tier.adminOverride;
  return (
    <DesignOSAppShell
      world={spec.world}
      route="campaign-builder"
      defaultKade={spec.defaultKade}
      kadePlacement={spec.kadePlacement}
    >
      {gated ? (
        <AgencyCampaignsBuilder />
      ) : (
        <TierGateWall currentTier={tier.tier} />
      )}
    </DesignOSAppShell>
  );
}

function TierGateWall({ currentTier }: { currentTier: string }): JSX.Element {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "calc(100vh - 190px)",
        padding: "48px 24px",
      }}
    >
      <div
        className="lc-settings-card"
        style={{
          maxWidth: 560,
          padding: 32,
          textAlign: "center",
        }}
      >
        <span className="lc-settings-card-eb" style={{ color: "var(--color-fuchsia, #FF1A8C)" }}>
          agency tier required
        </span>
        <h2 style={{ margin: "16px 0 12px", fontSize: 24, fontWeight: 600 }}>
          Upgrade to run your own campaigns.
        </h2>
        <p style={{ margin: 0, color: "var(--color-text-secondary, #B5AFA8)" }}>
          The campaign builder ships with Agency · <strong>$99.99/mo</strong> ·
          multi-brand campaigns, campaign launch, analytics rollups, and 2,500 posts/mo.
          Sign-up is free · you&rsquo;re only charged when you activate.
        </p>
        <p
          style={{
            margin: "12px 0 0",
            fontSize: 12,
            color: "var(--color-text-tertiary, #7A7672)",
          }}
        >
          Current tier: <code>{currentTier}</code>
        </p>
        <div style={{ marginTop: 24, display: "flex", justifyContent: "center", gap: 12 }}>
          <button
            type="button"
            onClick={() => {
              void openInApp("https://liquidclips.app/pricing", {
                intent: "read-only",
              });
            }}
            className="lc-btn"
            data-variant="primary"
          >
            See pricing →
          </button>
        </div>
      </div>
    </div>
  );
}

function AgencyCampaignsBuilder(): JSX.Element {
  // Path A Fix 2 · redundant client-side tier gate on every write action.
  // `canUseAgencyActions` uses the STRICTER check — tier === "agency" AND
  // tier.source is trusted (real-http or session-cache). A debug-override
  // tier setting therefore CANNOT trigger a mutation via this builder,
  // even though the outer TierGateWall would allow the route to mount.
  // Also self-heals if the tier degrades mid-session — buttons disable
  // immediately without a route unmount.
  const tier = useTierCaps();
  // Step 2 batch 2f · prefer the server-issued write capability.
  // Falls back to the legacy canUseAgencyActions + adminOverride pair
  // during the compat window.
  const writeAllowed =
    hasCapability(tier.capabilities, CAP.AGENCY_CAMPAIGN_CREATE)
    || canUseAgencyActions({ tier: tier.tier, source: tier.source })
    || tier.adminOverride;

  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const reload = useCallback(async () => {
    setState({ kind: "loading" });
    const r = await listMyCampaigns();
    if (r.data && r.state === "ready") {
      setState({ kind: "ready", campaigns: r.data });
      return;
    }
    if (r.state === "forbidden") {
      setState({ kind: "forbidden", message: r.error ?? "Not authorised." });
      return;
    }
    if (r.state === "offline") {
      setState({ kind: "offline", message: r.error ?? "Offline." });
      return;
    }
    setState({ kind: "error", message: r.error ?? "Campaigns failed to load." });
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const selected: CampaignBlock | null = useMemo(() => {
    if (!selectedSlug || state.kind !== "ready") return null;
    return state.campaigns.find((c) => c.slug === selectedSlug) ?? null;
  }, [selectedSlug, state]);

  const handleCreated = useCallback((block: CampaignBlock) => {
    setSelectedSlug(block.slug);
    setCreating(false);
    void reload();
  }, [reload]);

  return (
    <Watchdog
      id="agency/ag-07/campaigns-grid"
      label="Agency Campaign Builder"
      cluster="agency"
      source="design-os/routes/AgencyCampaigns.tsx:213"
    >
    <main
      className="lc-agency-campaigns-grid"
      style={{
        /* Ship-lens P2-RR17-002 fix (2026-07-06) · display+gap moved
         *  to the class so the responsive collapse @ 900px takes
         *  effect without an inline `gap:24` override. */
        padding: 24,
        minHeight: "calc(100vh - 190px)",
        background: "var(--color-paper, #0F0F14)",
      }}
    >
      <aside>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <h1
            style={{ margin: 0, fontSize: 18, fontWeight: 600 }}
            data-route-title="Campaign Builder"
            data-kade-anchor
          >
            Campaigns
          </h1>
          <button
            type="button"
            className="lc-btn"
            data-variant="primary"
            onClick={() => {
              setCreating(true);
              setSelectedSlug(null);
            }}
          >
            + New
          </button>
        </div>

        {state.kind === "loading" && (
          <p className="lc-settings-hint">Loading your campaigns…</p>
        )}
        {/* Ship-lens Batch 4 P1-BATCH4-002 fix (2026-07-06) · every
         *  failure branch that renders dynamic state.message needs
         *  role="alert" so AT users get notified · same treatment as
         *  the error branch below. Forbidden is a hard access-denial
         *  (assertive) · offline is a recoverable failure (polite). */}
        {state.kind === "forbidden" && (
          <p className="lc-settings-hint" role="alert" aria-live="assertive">{state.message}</p>
        )}
        {state.kind === "offline" && (
          <>
            <p className="lc-settings-hint" role="alert" aria-live="polite">{state.message}</p>
            <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
          </>
        )}
        {state.kind === "error" && (
          <>
            {/* Ship-lens Batch 4 (Heading + touch sweep · 2026-07-06) ·
             *  role="alert" + aria-live="assertive" so AT users are
             *  immediately notified when the campaigns load fails.
             *  Prior <p> without role was silent to screen readers. */}
            <p className="lc-settings-hint" role="alert" aria-live="assertive">{state.message}</p>
            <button type="button" className="lc-btn" onClick={() => void reload()}>Retry</button>
          </>
        )}
        {state.kind === "ready" && (
          <CampaignList
            campaigns={state.campaigns}
            selectedSlug={selectedSlug}
            onSelect={(slug) => {
              setSelectedSlug(slug);
              setCreating(false);
            }}
          />
        )}
      </aside>

      <section>
        {creating ? (
          <CreateCampaignForm
            writeAllowed={writeAllowed}
            onCancel={() => setCreating(false)}
            onCreated={handleCreated}
          />
        ) : selected ? (
          <CampaignEditor
            campaign={selected}
            writeAllowed={writeAllowed}
            onChanged={(updated) => {
              // Update local list without a full round-trip; the reload
              // still runs on explicit user-driven refreshes.
              setState((prev) =>
                prev.kind === "ready"
                  ? {
                      kind: "ready",
                      campaigns: prev.campaigns.map((c) =>
                        c.slug === updated.slug ? updated : c,
                      ),
                    }
                  : prev,
              );
            }}
          />
        ) : (
          <EmptyState onNew={() => setCreating(true)} />
        )}
      </section>
    </main>
    </Watchdog>
  );
}

// ─── Sidebar list ─────────────────────────────────────────────────────

function CampaignList({
  campaigns,
  selectedSlug,
  onSelect,
}: {
  campaigns: CampaignBlock[];
  selectedSlug: string | null;
  onSelect: (slug: string) => void;
}): JSX.Element {
  // ag-07 fix (2026-07-06) · when the responsive grid collapses at <=900px
  // the sidebar becomes a bounded scrollable strip. Keep the selected
  // campaign scrolled into view so an operator on a narrow display never
  // loses their place after picking a row.
  const selectedRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    if (selectedRef.current) {
      selectedRef.current.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [selectedSlug]);

  if (campaigns.length === 0) {
    return (
      <p className="lc-settings-hint">
        No campaigns yet. Click <strong>+ New</strong> to draft your first.
      </p>
    );
  }
  return (
    <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
      {campaigns.map((c) => (
        <li key={c.slug}>
          <button
            type="button"
            ref={selectedSlug === c.slug ? selectedRef : undefined}
            onClick={() => onSelect(c.slug)}
            style={{
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--color-line, rgba(255,255,255,0.08))",
              background: selectedSlug === c.slug ? "var(--color-fuchsia-soft, rgba(255,26,140,0.14))" : "transparent",
              color: "inherit",
              cursor: "pointer",
            }}
          >
            <div style={{ fontWeight: 600, fontSize: 14 }}>{c.title}</div>
            <div style={{ fontSize: 11, color: "var(--color-text-secondary, #B5AFA8)", marginTop: 4 }}>
              {c.slug} · <StatusPill status={c.status} />
            </div>
          </button>
        </li>
      ))}
    </ul>
  );
}

function StatusPill({ status }: { status: CampaignStatus }): JSX.Element {
  const color =
    status === "live"
      ? "var(--color-ok, #4a9)"
      : status === "closed"
        ? "var(--color-text-tertiary, #7A7672)"
        : status === "draft"
          ? "var(--color-fuchsia, #FF1A8C)"
          : "var(--color-warn, #d9b04a)";
  return (
    <span style={{ color, fontWeight: 600, textTransform: "uppercase", letterSpacing: 0.5 }}>
      {status}
    </span>
  );
}

function EmptyState({ onNew }: { onNew: () => void }): JSX.Element {
  return (
    <div className="lc-settings-card" style={{ padding: 32, textAlign: "center" }}>
      <span className="lc-settings-card-eb">campaign builder</span>
      <h2 style={{ margin: "16px 0 8px", fontSize: 22, fontWeight: 600 }}>Select or create a campaign.</h2>
      <p style={{ margin: 0, color: "var(--color-text-secondary, #B5AFA8)" }}>
        Draft a brief · connect a Whop content-reward · publish when the funding lands.
      </p>
      <div style={{ marginTop: 20 }}>
        <button type="button" className="lc-btn" data-variant="primary" onClick={onNew}>
          + New campaign
        </button>
      </div>
    </div>
  );
}

// ─── Create form ──────────────────────────────────────────────────────

function CreateCampaignForm({
  writeAllowed,
  onCancel,
  onCreated,
}: {
  writeAllowed: boolean;
  onCancel: () => void;
  onCreated: (b: CampaignBlock) => void;
}): JSX.Element {
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [type, setType] = useState<CampaignType>("clip");
  const [description, setDescription] = useState("");
  const [rewardUrl, setRewardUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-derive slug from title unless the user edited it.
  useEffect(() => {
    if (!slugTouched) setSlug(slugify(title));
  }, [title, slugTouched]);

  // 2026-08-30 · Auto-fill Whop reward URL from the Kade wizard's
  // capture event. If the agency creates their Whop bounty in the
  // in-app browser while this form is open, the URL populates the
  // field so they don't have to paste. Only overrides an empty field
  // — respects manual entry if the agency typed something first.
  useEffect(() => {
    const onCapture = (evt: Event): void => {
      const detail = (evt as CustomEvent<WhopBountyCaptured>).detail;
      if (!detail?.url) return;
      setRewardUrl((current) => (current.trim() ? current : detail.url));
    };
    window.addEventListener(WHOP_BOUNTY_CAPTURED_EVENT, onCapture as EventListener);
    return () =>
      window.removeEventListener(WHOP_BOUNTY_CAPTURED_EVENT, onCapture as EventListener);
  }, []);

  const canSubmit = writeAllowed && title.trim().length >= 2 && slug.length >= 2 && !busy;

  const submit = useCallback(async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    const payload: CampaignCreatePayload = {
      title: title.trim(),
      slug,
      campaign_type: type,
      description: description.trim(),
      whop_reward_url: rewardUrl.trim() || null,
    };
    const r = await createCampaign(payload);
    setBusy(false);
    if (r.data && r.state === "ready") {
      onCreated(r.data);
      return;
    }
    setError(r.error ?? "Create failed.");
  }, [canSubmit, title, slug, type, description, rewardUrl, onCreated]);

  return (
    <div className="lc-settings-card" style={{ padding: 24 }}>
      <span className="lc-settings-card-eb">draft a new campaign</span>
      <h2 style={{ margin: "12px 0 20px", fontSize: 20, fontWeight: 600 }}>Create campaign</h2>

      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {!writeAllowed && (
          <p className="lc-settings-hint" role="status">
            Write actions disabled · agency-tier verification pending. Refresh
            your account before creating a campaign.
          </p>
        )}
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Q3 launch clip job"
            spellCheck={false}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Slug (URL id)</span>
          <input
            type="text"
            value={slug}
            onChange={(e) => {
              setSlug(slugify(e.target.value));
              setSlugTouched(true);
            }}
            placeholder="q3-launch-clip-job"
            spellCheck={false}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as CampaignType)}>
            {CAMPAIGN_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Brief</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={4}
            placeholder="What should the clipper highlight? What's the tone? What are the guardrails?"
            spellCheck
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>
            Whop reward URL (optional · can connect after create)
          </span>
          <input
            type="url"
            value={rewardUrl}
            onChange={(e) => setRewardUrl(e.target.value)}
            placeholder="https://whop.com/…/rewards/…"
            spellCheck={false}
          />
        </label>

        {error && (
          <p className="lc-settings-hint" role="alert" aria-live="assertive" style={{ color: "var(--color-alert, #d33)" }}>
            {error}
          </p>
        )}

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" className="lc-btn" onClick={onCancel} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className="lc-btn"
            data-variant="primary"
            onClick={submit}
            disabled={!canSubmit}
          >
            {busy ? "Drafting…" : "Create draft"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Editor (patch + connect-reward + publish) ────────────────────────

function CampaignEditor({
  campaign,
  writeAllowed,
  onChanged,
}: {
  campaign: CampaignBlock;
  writeAllowed: boolean;
  onChanged: (b: CampaignBlock) => void;
}): JSX.Element {
  const [title, setTitle] = useState(campaign.title);
  const [description, setDescription] = useState(campaign.description);
  const [bannerUrl, setBannerUrl] = useState(campaign.banner_url ?? "");
  const [rewardUrl, setRewardUrl] = useState(campaign.whop_reward_url ?? "");
  const [saveBusy, setSaveBusy] = useState(false);
  const [connectBusy, setConnectBusy] = useState(false);
  const [publishBusy, setPublishBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "err"; message: string } | null>(null);

  useEffect(() => {
    setTitle(campaign.title);
    setDescription(campaign.description);
    setBannerUrl(campaign.banner_url ?? "");
    setRewardUrl(campaign.whop_reward_url ?? "");
    setNotice(null);
  }, [campaign.slug, campaign.title, campaign.description, campaign.banner_url, campaign.whop_reward_url]);

  // 2026-08-30 · Auto-fill from Kade wizard's Whop URL capture. If
  // the agency posts to Whop from CampaignPageShell (or completes
  // the flow in the in-app browser while this panel is mounted), the
  // captured URL populates the reward field so they can click
  // Connect without pasting. Only overrides an empty field so we
  // never clobber manual entry, and only accepts captures that
  // arrived AFTER this panel opened (guards against stale events
  // from a previous campaign that just got dispatched late).
  useEffect(() => {
    const openedAt = Date.now();
    const onCapture = (evt: Event): void => {
      const detail = (evt as CustomEvent<WhopBountyCaptured>).detail;
      if (!detail?.url) return;
      if (detail.capturedAt) {
        const t = Date.parse(detail.capturedAt);
        if (!Number.isNaN(t) && t < openedAt) return;
      }
      setRewardUrl((current) => (current.trim() ? current : detail.url));
      // 2026-08-30 audit fix. Was setNotice(...) which clobbered any
      // in-flight save/connect notice mid-read. Toast instead so the
      // capture surfaces on its own layer + auto-dismisses without
      // overwriting a real form-action outcome.
      bus.emit("toast", {
        kind: "success",
        title: "Whop URL captured",
        body: "Click Connect to link it to this campaign.",
      });
    };
    window.addEventListener(WHOP_BOUNTY_CAPTURED_EVENT, onCapture as EventListener);
    return () =>
      window.removeEventListener(WHOP_BOUNTY_CAPTURED_EVENT, onCapture as EventListener);
  }, [campaign.slug]);

  const editsPending =
    title !== campaign.title
    || description !== campaign.description
    || (bannerUrl || null) !== campaign.banner_url;

  const locked = campaign.status === "live";

  const doSave = useCallback(async () => {
    if (!writeAllowed || !editsPending || locked) return;
    setSaveBusy(true);
    setNotice(null);
    const payload: CampaignPatchPayload = {
      title: title.trim(),
      description: description.trim(),
      banner_url: bannerUrl.trim() || null,
    };
    const r = await patchCampaign(campaign.slug, payload);
    setSaveBusy(false);
    if (r.data && r.state === "ready") {
      onChanged(r.data);
      setNotice({ kind: "ok", message: "Saved." });
      return;
    }
    setNotice({ kind: "err", message: r.error ?? "Save failed." });
  }, [writeAllowed, editsPending, locked, title, description, bannerUrl, campaign.slug, onChanged]);

  const doConnect = useCallback(async () => {
    if (!writeAllowed) return;
    const trimmed = rewardUrl.trim();
    if (!trimmed) {
      setNotice({ kind: "err", message: "Paste a Whop content-reward URL first." });
      return;
    }
    setConnectBusy(true);
    setNotice(null);
    const payload: ConnectRewardPayload = { whop_reward_url: trimmed };
    const r = await connectReward(campaign.slug, payload);
    setConnectBusy(false);
    if (r.data && r.state === "ready") {
      onChanged(r.data);
      setNotice({
        kind: "ok",
        message:
          r.data.whop_reward_state === "real"
            ? "Connected · Whop enrichment loaded."
            : "URL stored · Whop enrichment deferred (still safe to publish).",
      });
      return;
    }
    setNotice({ kind: "err", message: r.error ?? "Connect failed." });
  }, [writeAllowed, rewardUrl, campaign.slug, onChanged]);

  const doPublish = useCallback(async () => {
    if (!writeAllowed) return;
    setPublishBusy(true);
    setNotice(null);
    const r = await publishCampaign(campaign.slug);
    setPublishBusy(false);
    if (r.data && r.state === "ready") {
      onChanged(r.data);
      setNotice({ kind: "ok", message: "Campaign published — clippers can now submit." });
      return;
    }
    setNotice({ kind: "err", message: r.error ?? "Publish failed." });
  }, [writeAllowed, campaign.slug, onChanged]);

  return (
    <div className="lc-settings-card" style={{ padding: 24 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <span className="lc-settings-card-eb">campaign · {campaign.slug}</span>
          <h2 style={{ margin: "8px 0 4px", fontSize: 20, fontWeight: 600 }}>{campaign.title}</h2>
          <div style={{ fontSize: 12, opacity: 0.7 }}>
            <StatusPill status={campaign.status} />
            {" · "}
            reward: {campaign.whop_reward_state ?? "unlinked"}
            {" · "}
            enrichment: {campaign.whop_reward_snapshot_status}
          </div>
        </div>
      </div>

      {locked && (
        <p className="lc-settings-hint" role="status" aria-live="polite" style={{ marginTop: 16, color: "var(--color-warn, #d9b04a)" }}>
          Live campaigns are locked · edits require unpublish (not in v1).
        </p>
      )}

      {!writeAllowed && (
        <p className="lc-settings-hint" role="status" aria-live="polite" style={{ marginTop: 16, color: "var(--color-warn, #d9b04a)" }}>
          Write actions disabled · agency-tier verification pending. If you just
          upgraded, refresh to re-sync your license.
        </p>
      )}

      <div style={{ marginTop: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Title</span>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={locked}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Brief</span>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            disabled={locked}
          />
        </label>

        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontSize: 12, opacity: 0.7 }}>Banner URL (optional)</span>
          <input
            type="url"
            value={bannerUrl}
            onChange={(e) => setBannerUrl(e.target.value)}
            placeholder="https://…/banner.png"
            spellCheck={false}
            disabled={locked}
          />
        </label>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="lc-btn"
            data-variant="primary"
            onClick={doSave}
            disabled={!writeAllowed || !editsPending || saveBusy || locked}
          >
            {saveBusy ? "Saving…" : "Save changes"}
          </button>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--color-line, rgba(255,255,255,0.08))" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="lc-settings-card-eb">connect Whop reward</span>
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              Whop content-reward URL (source of truth · enrichment is best-effort)
            </span>
            <input
              type="url"
              value={rewardUrl}
              onChange={(e) => setRewardUrl(e.target.value)}
              placeholder="https://whop.com/…/rewards/…"
              spellCheck={false}
            />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button
              type="button"
              className="lc-btn"
              onClick={doConnect}
              disabled={!writeAllowed || connectBusy || !rewardUrl.trim()}
            >
              {connectBusy ? "Connecting…" : "Connect reward"}
            </button>
          </div>
        </div>

        <hr style={{ border: "none", borderTop: "1px solid var(--color-line, rgba(255,255,255,0.08))" }} />

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <span className="lc-settings-card-eb">publish</span>
          <p className="lc-settings-hint">
            Publishing flips the campaign live so it surfaces in every clipper&rsquo;s
            Earn tab. You can always close it later.
          </p>
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            <button
              type="button"
              className="lc-btn"
              data-variant="primary"
              onClick={doPublish}
              disabled={!writeAllowed || publishBusy || campaign.status === "live" || campaign.status === "closed"}
            >
              {publishBusy ? "Publishing…" : campaign.status === "live" ? "Live" : "Publish campaign"}
            </button>
          </div>
        </div>

        {notice && (
          <p
            className="lc-settings-hint"
            role={notice.kind === "ok" ? "status" : "alert"}
            aria-live={notice.kind === "ok" ? "polite" : "assertive"}
            style={{
              marginTop: 8,
              color:
                notice.kind === "ok"
                  ? "var(--color-ok, #4a9)"
                  : "var(--color-alert, #d33)",
            }}
          >
            {notice.message}
          </p>
        )}
      </div>
    </div>
  );
}
