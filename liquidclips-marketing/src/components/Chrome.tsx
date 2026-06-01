import Link from "next/link";
import { accountUrl, downloadUrl, navLinks, partnerUrl, supportEmail } from "@/lib/site";
import { Logo } from "./Logo";

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
    <footer className="site-footer">
      <div className="container">
        <div className="footer-grid">
          <div className="footer-brand">
            <Logo />
            <p>Made for creators who would rather record than wrestle timelines.</p>
          </div>
          <div>
            <h4>Product</h4>
            <Link href="/#how">How it works</Link>
            <Link href="/#pricing">Pricing</Link>
            <a href={downloadUrl}>Download</a>
            <a href={accountUrl}>Account</a>
          </div>
          <div>
            <h4>Earn</h4>
            <Link href="/#earn">Whop rewards</Link>
            <a href={partnerUrl}>Affiliate sign in</a>
            <a href={`${accountUrl}/checkout`}>Start 100 free clips</a>
          </div>
          <div>
            <h4>Trust</h4>
            <Link href="/privacy">Privacy</Link>
            <Link href="/terms">Terms</Link>
            <a href={`mailto:${supportEmail}`}>Support</a>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© 2026 Liquid Clips</span>
          <span>Local-first desktop AI editing</span>
        </div>
      </div>
    </footer>
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
