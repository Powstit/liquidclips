"use client";

import Image from "next/image";
import { FIXTURE_CLIPS } from "@/lib/fixtureClips";

/**
 * Window 3 · Clip Vault.
 * Top-down inventory camera · ownership beat. Fuchsia = these are YOURS.
 * Cards are EXAMPLE data · clearly badged so we never pretend.
 */

export function ClipVaultWindow() {
  return (
    <section className="lc-w3" aria-labelledby="lc-w3-h">
      <div className="lc-w3-head">
        <div className="lc-w3-head-left">
          <span className="lc-w3-eb">
            <span className="lc-w3-eb-dot" /> YOUR VAULT
          </span>
          <h2 id="lc-w3-h" className="lc-w3-h2">
            Scored. Titled. <em>Hooked.</em> Waiting.
          </h2>
          <p className="lc-w3-sub">
            Your clips are waiting. Locked to this session. Open the workbench
            to watch and export.
          </p>
        </div>
        <div className="lc-w3-head-right">
          <span className="lc-w3-tag">
            <span className="lc-w3-tag-dot" /> EXAMPLE · DEMO VAULT
          </span>
          <div className="lc-w3-kade-wrap">
            <div className="lc-w3-kade-rim" aria-hidden="true" />
            <Image
              src="/brand/kade/kade-success.webp"
              alt=""
              width={300}
              height={300}
              className="lc-w3-kade"
            />
          </div>
        </div>
      </div>

      <ol className="lc-w3-grid" aria-label="Sample clip vault">
        {FIXTURE_CLIPS.map((c, idx) => (
          <li
            key={c.id}
            className="lc-w3-card"
            style={{ animationDelay: `${idx * 70}ms` }}
          >
            <span className="lc-w3-bracket lc-w3-bracket--tl" aria-hidden="true" />
            <span className="lc-w3-bracket lc-w3-bracket--tr" aria-hidden="true" />
            <span className="lc-w3-bracket lc-w3-bracket--bl" aria-hidden="true" />
            <span className="lc-w3-bracket lc-w3-bracket--br" aria-hidden="true" />

            <div
              className="lc-w3-thumb"
              style={{ ['--hue' as string]: `${c.thumbHue}deg` }}
              aria-hidden="true"
            >
              <span className="lc-w3-thumb-num">
                {c.index < 10 ? `0${c.index}` : c.index}
              </span>
              <span className="lc-w3-thumb-dur">{c.duration}</span>
              <span className="lc-w3-thumb-example">EXAMPLE</span>
            </div>

            <div className="lc-w3-meta">
              <div className="lc-w3-meta-row">
                <span className="lc-w3-score">{c.viralScore}</span>
                <span className="lc-w3-reach">{c.estimatedReach}</span>
              </div>
              <h3 className="lc-w3-title">{c.title}</h3>
              <p className="lc-w3-hook">“{c.hookLine}”</p>
            </div>

            <div className="lc-w3-locked" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="14" height="14">
                <path
                  d="M7 10V8a5 5 0 0 1 10 0v2h.5A2.5 2.5 0 0 1 20 12.5v6A2.5 2.5 0 0 1 17.5 21h-11A2.5 2.5 0 0 1 4 18.5v-6A2.5 2.5 0 0 1 6.5 10H7zm2 0h6V8a3 3 0 1 0-6 0v2z"
                  fill="currentColor"
                />
              </svg>
              OPEN IN WORKBENCH
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
