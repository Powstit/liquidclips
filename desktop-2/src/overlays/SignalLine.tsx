import { useEffect, useState } from "react";

const SIGNALS = [
  { label: "rank", value: "#42", suffix: "of 1284" },
  { label: "next post", value: "tiktok", suffix: "in 3h 14m" },
  { label: "today's leader", value: "@liquidclips", suffix: "12 viral" },
];

export function SignalLine() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (SIGNALS.length <= 1) return;
    const id = setInterval(() => {
      setIndex((i) => (i + 1) % SIGNALS.length);
    }, 5000);
    return () => clearInterval(id);
  }, []);

  const active = SIGNALS[index];

  return (
    <footer className="lc-signal-line" aria-hidden="true">
      <span className="lc-signal-item">
        <span className="lc-signal-item-dot" />
        {active.label} · <b>{active.value}</b> {active.suffix}
      </span>
      <span style={{ marginLeft: "auto" }}>0.8.0-beta</span>
    </footer>
  );
}
