import Link from "next/link";
import { PageShell } from "@/components/Chrome";

export default function NotFound() {
  return (
    <PageShell>
      <main className="legal-page" aria-labelledby="game-over">
        <div className="container" style={{ textAlign: "center", maxWidth: 720 }}>
          <div className="ops-eyebrow" style={{ margin: "0 auto" }}>SIGNAL LOST</div>
          <div style={{ margin: "32px auto 16px", display: "inline-block" }}>
            <img
              src="/brand/invader.png"
              alt="Liquid Clips Invader"
              width={120}
              height={120}
              style={{ imageRendering: "pixelated" }}
              className="flicker"
            />
          </div>
          <h1
            id="game-over"
            className="page-title"
            style={{ textAlign: "center" }}
          >
            GAME OVER
          </h1>
          <p
            className="page-lede"
            style={{ margin: "16px auto 0", textAlign: "center" }}
          >
            Page not found. The signal cut out before we could load it. Try a different stage —
            or insert a coin to continue.
          </p>
          <div
            style={{
              marginTop: 36,
              display: "flex",
              gap: 14,
              justifyContent: "center",
              flexWrap: "wrap",
            }}
          >
            <Link href="/" className="button-primary">
              ▸ PRESS START
            </Link>
            <Link href="/help" className="button-secondary">
              CLIPPER ACADEMY
            </Link>
          </div>
          <p
            className="updated"
            style={{ marginTop: 56, textAlign: "center" }}
          >
            INSERT COIN — RESPAWN AT TITLE SCREEN
          </p>
        </div>
      </main>
    </PageShell>
  );
}
