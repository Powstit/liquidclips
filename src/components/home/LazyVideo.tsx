// LazyVideo — preloads nothing, autoplays muted+looped once it enters view,
// pauses when it scrolls out. Falls back to nothing on error so the
// gradient under the slide stays visible.

import { useEffect, useRef, useState } from "react";

interface LazyVideoProps {
  src: string;
  className?: string;
}

export function LazyVideo({ src, className }: LazyVideoProps): JSX.Element | null {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            void el.play().catch(() => undefined);
          } else {
            el.pause();
          }
        }
      },
      { threshold: 0.1 },
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  if (error) return null;

  return (
    <video
      ref={ref}
      src={src}
      preload="none"
      muted
      loop
      playsInline
      className={className ?? "h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"}
      onError={() => setError(true)}
    />
  );
}
