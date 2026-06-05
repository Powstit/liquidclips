import React from "react";
import ReactDOM from "react-dom/client";
import { Splash } from "../src/components/Splash";
import "../src/index.css";

type HarnessStage = "intro" | "loading" | "game" | "failed";

const params = new URLSearchParams(window.location.search);
const stage = (params.get("stage") ?? "loading") as HarnessStage;
const originalSetTimeout = window.setTimeout.bind(window);

window.setInterval = (() => 0) as typeof window.setInterval;
window.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
  if (stage !== "intro" && timeout === 28_500) {
    return originalSetTimeout(handler, 50, ...(args as []));
  }
  if (stage === "loading" && timeout === 5_000) return 0;
  if (stage === "game" && timeout === 5_000) {
    return originalSetTimeout(handler, 50, ...(args as []));
  }
  return originalSetTimeout(handler, timeout, ...(args as []));
}) as typeof window.setTimeout;

function Harness() {
  const [ready, setReady] = React.useState(stage === "game");

  React.useEffect(() => {
    if (stage === "game") {
      const t = window.setTimeout(() => setReady(true), 200);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, []);

  return (
    <main
      data-testid="splash-harness"
      style={{ width: "100vw", height: "100vh", overflow: "hidden" }}
    >
      <Splash
        failed={stage === "failed"}
        ready={ready}
        onContinue={() => {
          document.documentElement.dataset.continued = "1";
        }}
      />
    </main>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Harness />
  </React.StrictMode>,
);
