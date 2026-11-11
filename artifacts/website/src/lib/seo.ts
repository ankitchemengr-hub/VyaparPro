import { useEffect } from "react";

const SITE = "SHRADHA ERP";

function setMeta(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

// Per-page title, description and their Open Graph copies. index.html holds
// the home page's values for crawlers that don't run JavaScript.
export function usePageMeta(title: string, description: string) {
  useEffect(() => {
    const full = title.includes(SITE) ? title : `${title} | ${SITE}`;
    document.title = full;
    setMeta("name", "description", description);
    setMeta("property", "og:title", full);
    setMeta("property", "og:description", description);
    setMeta("property", "og:url", window.location.origin + window.location.pathname);
  }, [title, description]);
}
