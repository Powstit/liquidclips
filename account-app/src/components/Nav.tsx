// Sticky nav with the brand lockup — matches partner-app's Nav structure
// so the chrome reads identically across both surfaces.
import Link from "next/link";
import { SignInButton, SignUpButton, Show, UserButton } from "@clerk/nextjs";
import { Logo } from "./Logo";

export function Nav() {
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-paper/85 px-8 py-[18px] backdrop-blur-[20px]">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between">
        <Logo />
        <div className="flex items-center gap-4 text-sm">
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
