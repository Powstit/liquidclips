import Link from "next/link";
import { accountUrl, downloadUrl, navLinks, partnerUrl, supportEmail } from "@/lib/site";
import { Logo } from "./Logo";
import { Marquee } from "./Marquee";

export function Header() {
  return (
    <header className="site-nav">
      <div className="container nav-inner">
        <Logo />
        <nav className="nav-links" aria-label="Primary navigation">
          {navLinks.map((link) => (
            <Link key={link.href} href={link.href}>
              {link.label}
            </Link>
          ))}
          <a href={downloadUrl} className="nav-cta">
            Download
          </a>
        </nav>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <>
      <Marquee
        tokens={[
          "TOP SCORE",
          "LIQUID CLIPS",
          "CLIPPERS WIN",
          "WAGMI",
          "INSERT COIN",
        ]}
      />
      <footer className="site-footer">
        <div className="container">
          <div className="footer-grid">
            <div className="footer-brand">
              <Logo />
              <p>
                The arcade for clippers. Built by a clipper, for clippers. Drop video. Clip. Post. Earn.
              </p>
            </div>
            <div>
              <h4>Product</h4>
              <Link href="/#how">How it works</Link>
              <Link href="/#pricing">Pricing</Link>
              <a href={downloadUrl}>Download</a>
              <a href={accountUrl}>Account</a>
              <Link href="/refer">Tag team</Link>
            </div>
            <div>
              <h4>Earn</h4>
              <Link href="/#earn">Whop rewards</Link>
              <a href={`${accountUrl}/checkout`}>Start 100 free clips</a>
              {/* Affiliate sign in removed — partner.jnremployee.com is
                  404'ing on every path. Active campaigns removed —
                  /lift/minecraft-challenge still uses "Liquid Lift" branding
                  which is a different product. Restore both once their
                  surfaces are live + on-brand. */}
            </div>
            <div>
              <h4>Ops console</h4>
              <Link href="/help">Clipper academy</Link>
              <Link href="/support">Support</Link>
              <Link href="/privacy">Privacy</Link>
              <Link href="/terms">Terms</Link>
              <Link href="/eula">EULA</Link>
              <Link href="/refunds">Refunds</Link>
              <Link href="/cookies">Cookies</Link>
              <Link href="/account-deletion">Delete account</Link>
              <a href={`mailto:${supportEmail}`}>{supportEmail}</a>
            </div>
          </div>
          <div className="footer-bottom">
            <span>© 2026 Liquid Clips · MADE BY A CLIPPER</span>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
              TOP SCORE: 0,000,000
              <img
                src="/brand/invader.png"
                alt=""
                width={18}
                height={18}
                className="invader-idle"
                style={{ imageRendering: "pixelated" }}
              />
            </span>
          </div>
        </div>
      </footer>
    </>
  );
}

export function PageShell({ children }: { children: React.ReactNode }) {
  return (
    <>
      <Header />
      {children}
      <Footer />
    </>
  );
}
