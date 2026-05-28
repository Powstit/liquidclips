import { useRef } from "react";
import { QRCodeCanvas, QRCodeSVG } from "qrcode.react";

/**
 * QrCode — Liquid Clips branded QR for any URL.
 *
 * Brand rules (per Daniel's brief):
 *  - Border accent in Liquid Clips fuchsia. THIN, not bulky.
 *  - QR modules stay black-on-white. Tinting the modules harms scan reliability,
 *    so we never touch them.
 *  - Quiet zone preserved (qrcode.react ships its own white border; we add
 *    extra padding outside that to keep scanners happy under wrappers).
 *  - Optional caption below — small, neutral, not salesy.
 *
 * Same `value` as the tracking link `short_url`, so link clicks and QR scans
 * resolve to the same /r/{tracking_link_id} endpoint and aggregate under the
 * same Reward Clip.
 */
export function QrCode({
  value,
  size = 192,
  caption,
  downloadName,
  className = "",
}: {
  value: string;
  /** On-screen pixel size of the QR itself (inside the border). Defaults to 192. */
  size?: number;
  /** Optional small caption rendered below the QR. */
  caption?: string;
  /** When provided, renders a "Download QR" affordance that emits a PNG. */
  downloadName?: string;
  className?: string;
}) {
  const hiddenCanvasWrap = useRef<HTMLDivElement | null>(null);

  function downloadPng() {
    const canvas = hiddenCanvasWrap.current?.querySelector("canvas");
    if (!canvas) return;
    const url = canvas.toDataURL("image/png");
    const a = document.createElement("a");
    a.href = url;
    a.download = (downloadName || "junior-qr") + ".png";
    document.body.appendChild(a);
    a.click();
    a.remove();
  }

  return (
    <div className={`inline-flex flex-col items-center gap-2 ${className}`}>
      {/* Outer card — thin fuchsia accent, white inner padding for the quiet zone */}
      <div className="rounded-2xl border border-fuchsia/60 bg-paper p-3 shadow-[var(--glow-sm)]">
        <div className="bg-white p-1.5">
          <QRCodeSVG
            value={value}
            size={size}
            level="M"
            bgColor="#FFFFFF"
            fgColor="#000000"
            marginSize={2}
          />
        </div>
      </div>

      {caption && (
        <p className="font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
          {caption}
        </p>
      )}

      {downloadName && (
        <>
          <button
            onClick={downloadPng}
            className="inline-flex items-center gap-1.5 rounded-full border border-line bg-paper px-3 py-1 font-sans text-[11px] font-medium text-text-secondary hover:border-fuchsia hover:text-fuchsia-deep"
          >
            Download QR
          </button>
          {/* Hidden canvas — same encoding as the visible SVG, used purely to
              produce a downloadable PNG on demand. Kept off-screen so it
              doesn't double-render to the user. */}
          <div ref={hiddenCanvasWrap} className="absolute -left-[9999px] top-0" aria-hidden="true">
            <QRCodeCanvas
              value={value}
              size={size * 2}   /* 2× for retina/share quality */
              level="M"
              bgColor="#FFFFFF"
              fgColor="#000000"
              marginSize={2}
            />
          </div>
        </>
      )}
    </div>
  );
}
