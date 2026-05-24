"use client";

import { track, referralIdFromUrl } from "@/lib/analytics";

export function ShareButtons({ referralUrl, username }: { referralUrl: string; username: string }) {
  const slug = referralIdFromUrl(referralUrl);
  const fire = (channel: "x" | "email" | "demo_clip") =>
    track("affiliate_link_shared", { affiliate_id: slug, channel });
  const tweet = `Junior turns Whop bounties into submission-ready clips. My link gives you 100 bounty clip exports to try it. ${referralUrl}`;
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}`;

  const mailSubject = `You should try Junior`;
  const mailBody = `Hey,\n\nFound Junior. Pick a Whop bounty, paste the source, and it builds a clipping workspace around the brief. My invite gives you 100 bounty clip exports. Bring your own OpenAI key, card required, then Solo if you keep going.\n\n${referralUrl}\n\n— ${username}`;
  const mailUrl = `mailto:?subject=${encodeURIComponent(mailSubject)}&body=${encodeURIComponent(mailBody)}`;

  return (
    <div>
      <div className="text-center font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
        Start with one of these
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <a
          href={xUrl}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => fire("x")}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper px-5 py-4 text-sm font-medium text-ink transition-all hover:border-fuchsia hover:bg-fuchsia-soft"
        >
          <span>𝕏</span>
          <span>Post on X</span>
        </a>
        <a
          href="https://app.jnremployee.com/clips/clip-featured.mp4"
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => fire("demo_clip")}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper px-5 py-4 text-sm font-medium text-ink transition-all hover:border-fuchsia hover:bg-fuchsia-soft"
        >
          <span>▷</span>
          <span>Grab a demo clip</span>
        </a>
        <a
          href={mailUrl}
          onClick={() => fire("email")}
          className="flex items-center justify-center gap-2 rounded-2xl border border-line bg-paper px-5 py-4 text-sm font-medium text-ink transition-all hover:border-fuchsia hover:bg-fuchsia-soft"
        >
          <span>✉</span>
          <span>Email a friend</span>
        </a>
      </div>
      <div className="mt-2 text-center font-mono text-[11px] text-text-tertiary">
        Three pre-made posts. One tap to share.
      </div>
    </div>
  );
}
