"use client";

import { useEffect, useRef, useState } from "react";

// Horizontal snap carousel — no library, pure scroll-snap.
// Children are rendered as flex-row siblings; each is one "page."

export function Carousel({ children, label }: { children: React.ReactNode[]; label?: string }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const onScroll = () => {
      const card = track.firstElementChild as HTMLElement | null;
      if (!card) return;
      const cardWidth = card.getBoundingClientRect().width + 16; // gap
      setIndex(Math.round(track.scrollLeft / cardWidth));
    };
    track.addEventListener("scroll", onScroll, { passive: true });
    return () => track.removeEventListener("scroll", onScroll);
  }, []);

  function jump(delta: number) {
    const track = trackRef.current;
    if (!track) return;
    const card = track.firstElementChild as HTMLElement | null;
    if (!card) return;
    const cardWidth = card.getBoundingClientRect().width + 16;
    track.scrollBy({ left: delta * cardWidth, behavior: "smooth" });
  }

  return (
    <section className="w-full">
      {label && (
        <div className="mb-3 flex items-center justify-between px-1">
          <div className="font-mono text-[11px] uppercase tracking-[0.12em] text-text-tertiary">
            {label}
          </div>
          <div className="flex items-center gap-2">
            <Paddle onClick={() => jump(-1)} disabled={index === 0} dir="left" />
            <Paddle onClick={() => jump(1)} disabled={index >= children.length - 1} dir="right" />
          </div>
        </div>
      )}
      <div
        ref={trackRef}
        className="flex w-full snap-x snap-mandatory gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {children.map((child, i) => (
          <div
            key={i}
            className="shrink-0 snap-start"
            style={{ width: "min(100%, 720px)" }}
          >
            {child}
          </div>
        ))}
      </div>
      {children.length > 1 && (
        <div className="mt-3 flex justify-center gap-1.5">
          {children.map((_, i) => (
            <span
              key={i}
              className={`h-[5px] rounded-full transition-all ${
                i === index ? "w-6 bg-fuchsia" : "w-1.5 bg-line"
              }`}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function Paddle({ onClick, disabled, dir }: { onClick: () => void; disabled: boolean; dir: "left" | "right" }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-full border border-line bg-paper text-ink transition-colors hover:border-fuchsia disabled:cursor-not-allowed disabled:opacity-30"
      aria-label={dir === "left" ? "Previous" : "Next"}
    >
      <span className="font-mono text-[14px]">{dir === "left" ? "←" : "→"}</span>
    </button>
  );
}
