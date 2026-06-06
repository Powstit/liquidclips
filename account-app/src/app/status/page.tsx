export const dynamic = "force-dynamic";

type PublicGate = {
  key: string;
  label: string;
  status: "ok" | "warn" | "fail";
};

type PublicStatus = {
  overall: "ok" | "warn" | "fail";
  score: number | string | null;
  generated_at: string | null;
  checks: number;
  failures: number;
  warnings: number;
  gates: PublicGate[];
  message: string;
};

const BACKEND_URL = process.env.NEXT_PUBLIC_JUNIOR_BACKEND_URL ?? "https://api.jnremployee.com";

async function loadStatus(): Promise<PublicStatus | null> {
  try {
    const res = await fetch(`${BACKEND_URL}/status`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as PublicStatus;
  } catch {
    return null;
  }
}

function tone(status: PublicGate["status"] | PublicStatus["overall"]): string {
  if (status === "ok") return "border-emerald-500/35 bg-emerald-500/10 text-emerald-700";
  if (status === "warn") return "border-amber-500/40 bg-amber-500/10 text-amber-700";
  return "border-fuchsia-deep/40 bg-fuchsia-soft/40 text-fuchsia-deep";
}

function label(status: PublicStatus["overall"]): string {
  if (status === "ok") return "All systems operational";
  if (status === "warn") return "Some systems need attention";
  return "Service checks are degraded";
}

export default async function StatusPage() {
  const status = await loadStatus();

  return (
    <main className="min-h-screen bg-paper px-5 py-10 text-ink sm:py-16">
      <div className="mx-auto max-w-5xl">
        <header className="flex flex-wrap items-end justify-between gap-5 border-b border-line pb-8">
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.14em] text-fuchsia">liquid clips status</div>
            <h1 className="mt-3 font-display text-[clamp(34px,6vw,64px)] font-semibold leading-[0.98] tracking-[-0.04em]">
              Public service health.
            </h1>
          </div>
          {status && (
            <div className={`rounded-full border px-4 py-2 font-mono text-[11px] uppercase tracking-[0.1em] ${tone(status.overall)}`}>
              {status.overall} · {status.score}/100
            </div>
          )}
        </header>

        {!status && (
          <section className="mt-10 rounded-3xl border border-fuchsia-deep/30 bg-fuchsia-soft/30 p-6">
            <h2 className="font-display text-2xl font-semibold tracking-[-0.02em]">Status temporarily unavailable.</h2>
            <p className="mt-2 text-sm leading-6 text-text-secondary">
              The public status check could not load. The app may still be online; try again shortly.
            </p>
          </section>
        )}

        {status && (
          <>
            <section className="mt-10 grid grid-cols-1 gap-4 sm:grid-cols-4">
              <div className="rounded-3xl border border-line bg-paper-warm/50 p-5">
                <div className="font-display text-4xl font-semibold tracking-[-0.03em]">{status.score}/100</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">score</div>
              </div>
              <div className="rounded-3xl border border-line bg-paper-warm/50 p-5">
                <div className="font-display text-4xl font-semibold tracking-[-0.03em]">{status.checks}</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">checks</div>
              </div>
              <div className="rounded-3xl border border-line bg-paper-warm/50 p-5">
                <div className="font-display text-4xl font-semibold tracking-[-0.03em]">{status.failures}</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">red</div>
              </div>
              <div className="rounded-3xl border border-line bg-paper-warm/50 p-5">
                <div className="font-display text-4xl font-semibold tracking-[-0.03em]">{status.warnings}</div>
                <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">warnings</div>
              </div>
            </section>

            <section className="mt-6 rounded-3xl border border-line bg-paper-warm/50 p-6">
              <div className={`inline-flex rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.1em] ${tone(status.overall)}`}>
                {label(status.overall)}
              </div>
              <p className="mt-4 max-w-2xl text-sm leading-6 text-text-secondary">{status.message}</p>
              <div className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">
                Last checked: {status.generated_at ?? "unknown"}
              </div>
            </section>

            <section className="mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
              {status.gates.map((gate) => (
                <div key={gate.key} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-paper p-4">
                  <div className="min-w-0">
                    <div className="truncate font-display text-[17px] font-semibold tracking-[-0.02em]">{gate.label}</div>
                    <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.12em] text-text-tertiary">automated check</div>
                  </div>
                  <span className={`shrink-0 rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] ${tone(gate.status)}`}>
                    {gate.status}
                  </span>
                </div>
              ))}
            </section>
          </>
        )}
      </div>
    </main>
  );
}
