"use client";

import { track } from "@/lib/analytics";

export function ShareButtons({ referralUrl, username }: { referralUrl: string; username: string }) {
  const slug = referralUrl.split("?a=")[1]?.split(/[&#]/)[0];
  const fire = (channel: "x" | "email" | "demo_clip") =>
    track("affiliate_link_shared", { affiliate_id: slug, channel });
  const tweet = `Just found Junior — drops a 4-hour podcast in, gets 30 ready-to-post clips out, posts them across the next 2 weeks while you sleep. Free forever for clippers. ${referralUrl}`;
  const xUrl = `https://x.com/intent/tweet?text=${encodeURIComponent(tweet)}`;

  const mailSubject = `You should try Junior`;
  const mailBody = `Hey,\n\nFound an app called Junior. You drop a long video in, it spits out 30+ ready-to-post clips with captions and schedules them across YouTube, TikTok and X. Free forever for clippers.\n\n${referralUrl}\n\n— ${username}`;
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
