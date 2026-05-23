import { Logo } from "./Logo";

export function Nav({ username }: { username?: string }) {
  return (
    <nav className="sticky top-0 z-50 border-b border-line bg-paper/85 px-8 py-[18px] backdrop-blur-[20px]">
      <div className="mx-auto flex max-w-[1240px] items-center justify-between">
        <Logo />
        <div className="flex items-center gap-6 text-sm">
          {username && <span className="hidden font-mono text-text-tertiary sm:inline">@{username}</span>}
          <a
            href="/auth/logout"
            className="text-text-secondary transition-colors hover:text-ink"
          >
            Sign out
          </a>
        </div>
      </div>
    </nav>
  );
}
