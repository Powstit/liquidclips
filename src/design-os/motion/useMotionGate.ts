/**
 * Liquid Clips · Motion · Reduced-motion gate
 *
 * Every motion component MUST consult this hook so we honour the OS-level
 * `prefers-reduced-motion: reduce` setting (and the body.rm class for manual
 * testing). When reduced, animations collapse to instant state changes.
 */

import { useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";

export function useMotionGate(): { reduced: boolean } {
  const sys = useReducedMotion();
  const [manual, setManual] = useState<boolean>(false);

  useEffect(() => {
    const el = document.body;
    const update = () => setManual(el.classList.contains("rm"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(el, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return { reduced: Boolean(sys) || manual };
}
