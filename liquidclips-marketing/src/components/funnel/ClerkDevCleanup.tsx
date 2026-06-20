"use client";

import { useEffect } from "react";

/**
 * The Clerk dev-mode "Configure your application" portal renders with
 * random hash class names (`cl-internal-…`) and is nested under
 * Clerk's own provider div — making it hard to nuke with pure CSS
 * without risking the real sign-in widgets on /sign-in.
 *
 * This is a tiny one-shot cleanup: on mount, find every element whose
 * className matches `cl-internal-` and that is NOT inside our page
 * shell, then hide it. Runs once on the landing page only.
 */
export function ClerkDevCleanup() {
  useEffect(() => {
    function nuke() {
      // Hide any cl-internal element at root + its hosting wrapper. The
      // dev widget is rendered as a portal sibling to our <main>.
      const internals = document.querySelectorAll<HTMLElement>('[class^="cl-internal-"], [class*=" cl-internal-"]');
      internals.forEach((el) => {
        // Only nuke nodes that aren't inside our page shell — leaves
        // the real /sign-in and /sign-up widgets alone.
        if (el.closest(".lc-w1-shell")) return;
        // Bubble up to the outermost cl-internal ancestor and hide it.
        let top = el;
        let cursor: HTMLElement | null = el.parentElement;
        while (cursor && cursor !== document.body) {
          if (/(^|\s)cl-internal-/.test(cursor.className || "")) top = cursor;
          cursor = cursor.parentElement;
        }
        top.style.display = "none";
      });
    }
    nuke();
    // Re-nuke after a beat in case Clerk mounts late (StrictMode, hydration).
    const t1 = window.setTimeout(nuke, 400);
    const t2 = window.setTimeout(nuke, 1200);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, []);
  return null;
}
