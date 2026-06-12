// Sticky nav with the brand lockup — matches partner-app's Nav structure
// so the chrome reads identically across both surfaces.
import Link from "next/link";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { Logo } from "./Logo";
import { InstallAppButton } from "./InstallAppButton";

// liquidclips.app/download is the single source of truth for installer
// URLs (v0.7.56). PWA "Install web app" surfaces separately via
// InstallAppButton — kept distinct so users never confuse the browser
// install with the Mac DMG download.
const MARKETING_DOWNLOAD_URL = "https://liquidclips.app/download";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-paper/85 px-8 py-[18px] backdrop-blur-[20px]">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between">
        <Logo />
        <div className="flex items-center gap-4 text-sm">
          {/* v0.7.56 P0 — Desktop download stays as a quiet text link
              (not a pill) so it sits visually below Sign in / Sign up
              for cold visitors. Cold visitor's primary action is still
              "Sign up" — the desktop download is a utility next to it. */}
          <a
            href={MARKETING_DOWNLOAD_URL}
            className="hidden font-sans text-[14px] font-medium text-text-secondary transition-colors hover:text-ink sm:inline-flex"
            data-cta="desktop-download"
          >
            Download desktop app
          </a>
          <Show when="signed-out">
            <SignInButton>
              <button className="font-sans text-[14px] font-medium text-text-secondary transition-colors hover:text-ink">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton>
              <button className="rounded-full bg-ink px-5 py-2 font-sans text-[14px] font-medium text-paper transition-all hover:bg-fuchsia hover:shadow-[0_10px_30px_rgba(255,26,140,0.3)]">
                Sign up
              </button>
            </SignUpButton>
          </Show>
          <Show when="signed-in">
            {/* v0.7.56 P0 — InstallAppButton is gated to signed-in users
                only. A cold visitor without an account should never see
                "Install web app" next to "Download desktop app" — too
                much install-of-what ambiguity. Signed-in users already
                know what the web app is. */}
            <InstallAppButton />
            <Link
              href="/dashboard"
              className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-secondary transition-colors hover:text-ink"
            >
              Dashboard
            </Link>
            <UserButton appearance={{ elements: { avatarBox: "h-[28px] w-[28px]" } }} />
          </Show>
        </div>
      </div>
    </nav>
  );
}
