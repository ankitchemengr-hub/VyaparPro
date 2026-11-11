import { useEffect } from "react";

// Fades `.reveal` elements in as they scroll into view, once each —
// including ones rendered later (pricing and FAQ load after the page). The
// hiding CSS only applies under `.reveal-ready`, which is set here, so
// without this script everything simply shows.
export function useReveal() {
  useEffect(() => {
    if (!("IntersectionObserver" in window) || !("MutationObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add("is-visible");
            io.unobserve(e.target);
          }
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
    );
    const watch = (root: ParentNode) => {
      root.querySelectorAll<HTMLElement>(".reveal:not(.is-visible)").forEach((el) => io.observe(el));
    };
    watch(document);
    const mo = new MutationObserver((records) => {
      for (const r of records) {
        r.addedNodes.forEach((n) => {
          if (!(n instanceof HTMLElement)) return;
          if (n.classList.contains("reveal")) io.observe(n);
          watch(n);
        });
      }
    });
    mo.observe(document.body, { childList: true, subtree: true });
    document.documentElement.classList.add("reveal-ready");
    return () => {
      mo.disconnect();
      io.disconnect();
      document.documentElement.classList.remove("reveal-ready");
    };
  }, []);
}
