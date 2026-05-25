"use client";

import { track, referralIdFromUrl } from "@/lib/analytics";

// Client component: renders a "Save QR" button and fires the
// affiliate_qr_downloaded PostHog event when the user downloads the QR SVG.
export function QRDownloadButton({
  svgContent,
  referralUrl,
}: {
  svgContent: string;
  referralUrl: string;
}) {
  const handleDownload = () => {
    try {
      const blob = new Blob([svgContent], { type: "image/svg+xml" });
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = blobUrl;
      a.download = "junior-referral-qr.svg";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(blobUrl);
    } catch {
      // best-effort download
    }
    track("affiliate_qr_downloaded", {
      affiliate_id: referralIdFromUrl(referralUrl),
    });
  };

  return (
    <button
      onClick={handleDownload}
      className="mt-4 inline-flex items-center gap-2 rounded-full border border-line bg-paper px-4 py-2 font-mono text-[11px] uppercase tracking-[0.12em] text-ink transition-colors hover:border-fuchsia hover:text-fuchsia"
    >
      ↓ Save QR
    </button>
  );
}
