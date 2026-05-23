import QRCode from "qrcode";

export async function ReferralQR({ url }: { url: string }) {
  const svg = await QRCode.toString(url, {
    type: "svg",
    width: 220,
    margin: 1,
    errorCorrectionLevel: "M",
    color: {
      dark: "#0A0A0F",   // ink
      light: "#FAF7F2",  // paper
    },
  });

  return (
    <div className="rounded-2xl border border-line bg-paper p-5 sm:p-6">
      <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start sm:gap-5">
        <div
          className="flex-shrink-0 rounded-xl bg-paper-warm p-3"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
        <div className="flex-1 text-center sm:text-left">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            Scan to share
          </div>
          <h3 className="mt-2 font-display text-xl font-semibold tracking-tight sm:text-2xl">
            Your link as a QR code.
          </h3>
          <p className="mt-2 text-sm text-text-secondary">
            Right-click → Save image. Print it on stickers, drop it in your bio, post it on a podcast cover. Every scan lands on{" "}
            <code className="rounded bg-paper-warm px-1.5 py-0.5 font-mono text-xs">jnremployee.com</code>{" "}
            with your attribution.
          </p>
          <p className="mt-3 font-mono text-[11px] text-text-tertiary">
            Encodes: {url}
          </p>
        </div>
      </div>
    </div>
  );
}
