"use client";

/* Liquid Clips HQ — Admin brand header.
 * Replaces the plain "Liquid Clips HQ." top strip with the brand wordmark,
 * pixel-invader landmark, and brand-voice subtitle. Sticky + blurred per
 * the brand kit (HUD chrome at the top of every long-lived surface).
 *
 * Owned by HQ Agent 2 (Brand Pass). Do NOT add destructive controls or
 * tab-switch logic here — that belongs to AdminHQ.tsx.
 */

import Image from "next/image";
import type { ReactNode } from "react";

type Props = {
  adminEmail: string;
  /** Status / score / actions slot — appears at the right edge. */
  rightSlot?: ReactNode;
  /** Optional override of the brand-voice subtitle. */
  subtitle?: string;
};

export function AdminBrandHeader({ adminEmail, rightSlot, subtitle }: Props) {
  return (
    <header
      className="lc-stroke-under sticky top-0 z-40 -mx-5 mb-7 px-5"
      style={{
        background: "color-mix(in srgb, var(--lc-bg) 78%, transparent)",
        backdropFilter: "blur(14px) saturate(140%)",
        WebkitBackdropFilter: "blur(14px) saturate(140%)",
      }}
    >
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-4 py-4">
        <div className="flex items-center gap-3">
          {/* Monogram — compact landmark · pixel-invader brand mark */}
          <div className="relative h-10 w-10 shrink-0 overflow-hidden rounded-[12px] border border-[color:var(--lc-stroke-strong)] bg-[color:var(--lc-bg-warm)]">
            <Image
              src="/brand/logo-monogram.png"
              alt="Liquid Clips"
              fill
              priority
              sizes="40px"
              className="object-cover"
              style={{ imageRendering: "auto" }}
            />
          </div>

          <div className="leading-tight">
            {/* Eyebrow — Geist Mono, brand kit voice */}
            <div
              className="lc-eyebrow flex items-center gap-2"
              style={{ color: "var(--lc-accent-mid)" }}
            >
              <span
                className="pulse-dot inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: "var(--lc-accent)" }}
              />
              HQ · MISSION CONTROL
            </div>

            {/* Wordmark — sentence case, brand-coloured slash */}
            <div
              className="lc-display mt-1"
              style={{ fontSize: "clamp(22px, 2.4vw, 28px)", letterSpacing: "-0.025em" }}
            >
              liquid<span style={{ color: "var(--lc-accent)" }}>/</span>clips · HQ
            </div>

            {/* Brand-voice subtitle — never "Admin Dashboard" */}
            <div className="lc-body mt-1" style={{ fontSize: "12px", color: "var(--lc-fg-faint)" }}>
              {subtitle ?? "the dojo · read-only inspection of every revenue gate, agent key, and signal in flight"}
            </div>
          </div>
        </div>

        <div className="flex flex-col items-end gap-1.5 text-right">
          {rightSlot}
          <div className="lc-eyebrow" style={{ color: "var(--lc-fg-faint)" }}>
            signed in
          </div>
          <div
            className="font-[family-name:var(--font-geist-mono,ui-monospace)] text-[11px]"
            style={{ color: "var(--lc-fg)" }}
          >
            {adminEmail}
          </div>
        </div>
      </div>
    </header>
  );
}
