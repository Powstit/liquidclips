/**
 * Features panel · first InformationConsole panel.
 * Inherits LOCKED W1 standard. Dark-glass cards, no SaaS-y feature grid.
 */

import Link from "next/link";
import { KadeHead } from "./KadeHead";

const FEATURES = [
  {
    glyph: "01",
    title: "Turn one long video into 10 short clips",
    body: "Drop in a YouTube link, podcast or recording. We pick the ten best moments worth posting.",
  },
  {
    glyph: "02",
    title: "Titles and hooks written for you",
    body: "Every clip gets a title, a score for how viral it could go, and the first line of the hook.",
  },
  {
    glyph: "03",
    title: "Captions and thumbnails done",
    body: "Burnt-in captions ready for each platform. Thumbnails generated. No extra editing app needed.",
  },
  {
    glyph: "04",
    title: "Ready for TikTok, Shorts, Reels and X",
    body: "Vertical for TikTok and Shorts. Square for Instagram. Wide for YouTube. One click sends them.",
  },
  {
    glyph: "05",
    title: "Submit clips and get paid",
    body: "Some creators pay you when their clips get views. Submit straight from the app — no extra setup.",
  },
  {
    glyph: "06",
    title: "Start on the site, finish in the app",
    body: "Paste a video on the website. Open Liquid Clips on your Mac. Your clips are already waiting.",
  },
];

export function FeaturesPanel() {
  return (
    <div className="lc-fp">
      <KadeHead
        src="/brand/kade/kade-cutting-clips.webp"
        alt="Kade scanning the workbench"
      >
        <span className="lc-fp-eb">
          <span className="lc-fp-eb-dot" /> FEATURES
        </span>
        <h2 className="lc-fp-h">
          Paste a YouTube video. Liquid Clips <em>finds the best moments</em>,
          writes titles, creates clips and gets them ready to post.
        </h2>
        <p className="lc-fp-sub">
          One app. No extra editor, no captions tool, no thumbnail app. Drop a
          long video in — get short clips out, ready for TikTok, Shorts,
          Reels and X.
        </p>
      </KadeHead>

      <ol className="lc-fp-grid">
        {FEATURES.map((f) => (
          <li key={f.glyph} className="lc-fp-card">
            <span className="lc-fp-card-bracket lc-fp-card-bracket--tl" aria-hidden="true" />
            <span className="lc-fp-card-bracket lc-fp-card-bracket--tr" aria-hidden="true" />
            <span className="lc-fp-card-bracket lc-fp-card-bracket--bl" aria-hidden="true" />
            <span className="lc-fp-card-bracket lc-fp-card-bracket--br" aria-hidden="true" />
            <span className="lc-fp-card-num">{f.glyph}</span>
            <h3 className="lc-fp-card-title">{f.title}</h3>
            <p className="lc-fp-card-body">{f.body}</p>
          </li>
        ))}
      </ol>

      <div className="lc-fp-cta-row">
        <Link
          href="#"
          className="lc-fp-cta lc-btn lc-btn--primary"
          onClick={(e) => {
            e.preventDefault();
            const top = document.querySelector(".lc-w1");
            if (top) top.scrollIntoView({ behavior: "smooth", block: "start" });
          }}
        >
          <span>Generate my first 10 clips</span>
          <span aria-hidden="true">→</span>
        </Link>
        <span className="lc-fp-cta-sub">
          drops you back at the tape slot · same session continues
        </span>
      </div>
    </div>
  );
}
