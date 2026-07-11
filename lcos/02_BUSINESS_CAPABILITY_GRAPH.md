# 02 · Business Capability Graph

Mission owns capabilities. Capabilities own features. Every capability has a KPI, a revenue weight, and a mission-fingerprint link.

Draft accepted 2026-07-12 (approved). Refined in P2.

## Schema

```
capability.<id>
Name:              <human>
Purpose:           <what it delivers to the creator>
Owns features:     [feature.id, ...]
KPIs:              [metric.id, ...]
Mission link:      [M1|M2|M3|M4, ...]
Revenue weight:    <critical | high | medium | low>
Status:            <live | building | on-hold | deprecated>
Owner:             <person>
```

## The seven capabilities

---

### `capability.identity-trust` · Identity & Trust
- **Purpose:** Prove the person on the other side of the pill is who they say they are, and that Liquid Clips knows them.
- **Owns features:** `feature.auth-otp`, `feature.lc-id`, `feature.handle`, `feature.session-lifecycle`, `feature.membership-gate`
- **KPIs:** `otp_success_rate`, `me_hydration_p95_ms`, `guest_leak_incidents`
- **Mission link:** M1, M3
- **Revenue weight:** critical
- **Status:** live (drift being fixed · BUG-002 open)
- **Owner:** Daniel

---

### `capability.creator-onboarding` · Creator Onboarding
- **Purpose:** Get a first-time user from install → first meaningful clip → felt success.
- **Owns features:** `feature.welcome-flow`, `feature.crew-invite`, `feature.first-upload`, `feature.first-clip-celebration`
- **KPIs:** `d1_first_clip_rate`, `crew_invites_sent_per_new_user`
- **Mission link:** M1, M4
- **Revenue weight:** high
- **Status:** live (crew wall shipped in Block 1)
- **Owner:** Daniel

---

### `capability.content-production` · Content Production
- **Purpose:** Turn a raw source (URL or file) into shippable vertical clips with captions and thumbnails.
- **Owns features:** `feature.ingest`, `feature.transcription`, `feature.clip-judgement`, `feature.cutting`, `feature.my-clips`, `feature.export`, `feature.upload-preflight`
- **KPIs:** `ingest_success_rate`, `clip_write_rate`, `stage_failure_by_class`, `export_success_rate`
- **Mission link:** M1, M4
- **Revenue weight:** critical
- **Status:** live (Block 2 preflight shipped)
- **Owner:** Daniel

---

### `capability.campaign-distribution` · Campaign Distribution
- **Purpose:** Connect clips to paying missions on Whop and other rails.
- **Owns features:** `feature.campaign-discovery`, `feature.submit-to-whop`, `feature.submission-compliance`, `feature.publishing`
- **KPIs:** `submissions_per_active_user`, `submit_success_rate`, `permission_type_compliance`
- **Mission link:** M2
- **Revenue weight:** high
- **Status:** live (Block 1 R1 · permission_type contract enforced)
- **Owner:** Daniel

---

### `capability.affiliate-revenue` · Affiliate Revenue
- **Purpose:** Convert creator activity into recurring MRR through Whop referrals and payouts.
- **Owns features:** `feature.wallet`, `feature.referral-qr`, `feature.affiliate-claim`, `feature.payouts`, `feature.whop-connection`, `feature.crew-pipeline`, `feature.cancellation-intercept`
- **KPIs:** `mrr_added_this_week`, `referrals_activated`, `payout_success_rate`, `whop_link_completion_rate`
- **Mission link:** M2, M3
- **Revenue weight:** **critical (business core)**
- **Status:** live (Block 1 R2/R3 shipped · payout endpoint 503 pending Whop)
- **Owner:** Daniel

---

### `capability.community-retention` · Community Retention
- **Purpose:** Keep creators coming back after their first success.
- **Owns features:** `feature.community`, `feature.notifications`, `feature.learn-walkthroughs`, `feature.channels`, `feature.schedule`
- **KPIs:** `d7_return_rate`, `channel_connections_per_active`, `learn_completion_rate`
- **Mission link:** M4
- **Revenue weight:** medium
- **Status:** partial (Learn wired Block 3 · notifications backend unwired · BUG-005 open)
- **Owner:** Daniel

---

### `capability.operational-excellence` · Operational Excellence
- **Purpose:** Keep the shipped app honest — runtime updates, diagnostics, HQ control tower, ship gates.
- **Owns features:** `feature.runtime-updates`, `feature.diagnostics`, `feature.hq-control-tower`, `feature.smoke-gate`, `feature.ship-lens`
- **KPIs:** `smoke_gate_pass_rate`, `hq_signal_freshness`, `incident_mttr`
- **Mission link:** M3 (indirectly all)
- **Revenue weight:** high (protects the other six)
- **Status:** live (Block 4 smoke gate shipped)
- **Owner:** Daniel

---

## Dependency edges (capability → capability)

Every capability affects at least one other:

```
identity-trust        → all six others (blocks everything)
creator-onboarding    → content-production, community-retention
content-production    → campaign-distribution
campaign-distribution → affiliate-revenue
community-retention   → creator-onboarding (loop)
operational-excellence → all six (meta)
```

If `identity-trust` is degraded, every downstream capability inherits AMBER.

## Adding a new capability

Only via Decision Graph entry. Capabilities are business-level; they don't proliferate freely.
