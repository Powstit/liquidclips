import type { MetadataRoute } from "next";

// v0.7.56 — PWA manifest for account.liquidclips.app.
//
// Scope: account-app only. The marketing site stays a brochure (no
// manifest there by design — install icon in the address bar would
// be noise for a marketing page users visit once).
//
// Copy discipline: nothing here says "Download" or "DMG" — that lives
// on liquidclips.app/download and in the Nav's "Download desktop app"
// link. This manifest is exclusively about the BROWSER install ("Install
// web app"), which is a different surface from the Mac desktop app.
//
// Theme + background colours follow the Liquid Clips brand kit:
//   - paper (#FAF7F2) = warm-cream surface, matches the body bg
//   - ink   (#0A0A0F) = primary text colour, used for theme_color so the
//                       PWA top chrome on Android matches the in-app nav
//                       (sticky bg-paper/85 with ink text).
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Liquid Clips",
    short_name: "Liquid Clips",
    description:
      "Manage your Liquid Clips subscription, billing, and account from the web.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "portrait-primary",
    background_color: "#FAF7F2",
    theme_color: "#0A0A0F",
    categories: ["productivity", "business"],
    icons: [
      {
        src: "/brand/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/brand/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
