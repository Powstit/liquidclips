import { SECTION_IDS } from "../../shell/sectionIds";
import { FLOW_IDS } from "../../contracts/flowRegistry";
import { fakeAccount } from "../../fixtures/fakeAccount.preview";

export function AccountSection() {
  return (
    <div>
      <span className="lc-section-eyebrow">
        <span className="lc-section-eyebrow-dot" /> cross-cutting · read-only selectors
      </span>
      <h1 className="lc-section-title">Account</h1>
      <p className="lc-section-subtitle">
        Account hydrates from the Clerk session cookie at shell boot. It does not make network calls on launch.
      </p>
      <div className="lc-section-pills">
        <span className="lc-id-pill">{SECTION_IDS.SECTION_ACCOUNT}</span>
        <span className="lc-id-pill">{FLOW_IDS.FLOW_000_APP_SHELL}</span>
      </div>

      <div className="lc-grid lc-grid-2 lc-mt-16">
        <div className="lc-hud-card">
          <span className="lc-hud-eyebrow">identity</span>
          <h3 className="lc-hud-title">{fakeAccount.displayName}</h3>
          <p className="lc-hud-body">{fakeAccount.email}</p>
        </div>
        <div className="lc-hud-card">
          <span className="lc-hud-eyebrow">tier</span>
          <h3 className="lc-hud-title">{fakeAccount.tier.toUpperCase()}</h3>
          <p className="lc-hud-body">{fakeAccount.clipsRemaining} / {fakeAccount.clipsCap} clips remaining</p>
        </div>
        <div className="lc-hud-card">
          <span className="lc-hud-eyebrow">affiliate</span>
          <h3 className="lc-hud-title">{fakeAccount.affiliateId ?? "—"}</h3>
          <p className="lc-hud-body">First-touch attribution. Locked at signup; cannot be overwritten.</p>
        </div>
      </div>
    </div>
  );
}
