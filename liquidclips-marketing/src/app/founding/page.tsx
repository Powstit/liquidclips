import type { Metadata } from "next";
import Image from "next/image";
import { PageShell } from "@/components/Chrome";
import { FoundingClippersForm } from "@/components/funnel/FoundingClippersForm";
import { PRODUCT_HUNT_URL } from "@/lib/env";

export const metadata: Metadata = {
  title: "Founding Clippers · Join before launch",
  description:
    "Join the Founding Clippers list. Early access, founding member badge, launch pricing locked forever.",
  alternates: { canonical: "/founding" },
};

// Invader swarm — 7 sprites at deterministic positions so SSR and client
// render the same DOM. Animation params are tuned per sprite so they feel
// like a real arcade march (not 7 clones in lock-step).
const INVADERS = [
  { top: "12%",  left: "-6%",  size: 56,  speed: "38s", bob: "1.6s", delay: "-3s",  opacity: 0.55 },
  { top: "22%",  left: "-12%", size: 38,  speed: "52s", bob: "2.1s", delay: "-14s", opacity: 0.4  },
  { top: "38%",  left: "-8%",  size: 72,  speed: "44s", bob: "1.9s", delay: "-22s", opacity: 0.65 },
  { top: "58%",  left: "-10%", size: 44,  speed: "60s", bob: "1.7s", delay: "-8s",  opacity: 0.45 },
  { top: "72%",  left: "-5%",  size: 60,  speed: "40s", bob: "2.3s", delay: "-30s", opacity: 0.55 },
  { top: "84%",  left: "-15%", size: 34,  speed: "56s", bob: "1.5s", delay: "-18s", opacity: 0.4  },
  { top: "8%",   left: "-3%",  size: 48,  speed: "48s", bob: "2.0s", delay: "-12s", opacity: 0.5  },
] as const;

export default function FoundingPage() {
  return (
    <PageShell hideChrome>
      {/* Preload the experience assets so the room + hero + ghost trail
          all appear with the first paint, not after a hop. */}
      <link
        rel="preload"
        as="image"
        href="/world/mission-pedestal.webp"
        fetchPriority="high"
      />
      <link
        rel="preload"
        as="image"
        href="/brand/kade/up-sequence/kade-up-1.webp"
        fetchPriority="high"
      />
      <main className="lc-founding-shell">
        {/* Generated world-plate background — the founding member badge
            on a pedestal. Doubles as visual identity for the offer. */}
        <div className="lc-founding-room" aria-hidden="true">
          <Image
            src="/world/mission-pedestal.webp"
            alt=""
            fill
            priority
            sizes="100vw"
            className="lc-founding-room-img"
          />
          <div className="lc-founding-vignette" />
          <div className="lc-founding-scanlines" />
        </div>

        {/* Animated invader swarm — CSS-only, drifts L→R, bobs, flickers */}
        <div className="lc-founding-swarm" aria-hidden="true">
          {INVADERS.map((inv, i) => (
            <span
              key={i}
              className="lc-founding-invader"
              style={{
                top: inv.top,
                left: inv.left,
                width: inv.size,
                height: inv.size,
                ["--march" as string]: inv.speed,
                ["--bob" as string]: inv.bob,
                ["--delay" as string]: inv.delay,
                ["--alpha" as string]: String(inv.opacity),
              }}
            />
          ))}
        </div>

        {/* Scrapbook composition · fully static. Kade as a corner
            mascot, sticker invaders as tilted decorations. The room
            backdrop + the drifting ambient swarm provide all the life
            this page needs. */}
        <div className="lc-founding-scrapbook" aria-hidden="true">
          <span className="lc-sb-sticker lc-sb-sticker--a" />
          <span className="lc-sb-sticker lc-sb-sticker--b" />
          <span className="lc-sb-sticker lc-sb-sticker--c" />
          <span className="lc-sb-sticker lc-sb-sticker--d" />
          <span className="lc-sb-sticker lc-sb-sticker--e" />

          <div className="lc-sb-hero">
            <Image
              src="/brand/kade/up-sequence/kade-up-1.webp"
              alt="Kade · founding clipper mascot"
              width={220}
              height={220}
              priority
              className="lc-sb-hero-static"
            />
          </div>
        </div>

        <section className="lc-founding-inner">
          <FoundingClippersForm
            source="website"
            sourcePage="/founding"
            productHuntUrl={PRODUCT_HUNT_URL}
          />
        </section>
      </main>
    </PageShell>
  );
}
