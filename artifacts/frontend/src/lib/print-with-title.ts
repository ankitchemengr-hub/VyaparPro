import { useEffect } from "react";

// Browsers derive the default "Save as PDF" / print filename from
// document.title. The app's <title> is "Vipro ERP", so every print flow
// offered the file as "Vipro ERP.pdf" instead of the invoice / receipt no.
//
// Two ways to fix it, used together:
//   - usePrintTitle(name): keeps document.title set to `name` for as long as
//     the component is mounted. This covers BOTH the app's own Print button
//     and the browser's native Ctrl+P / menu Print, since the title is
//     already correct whenever a print is triggered. Use on full-page views
//     (invoice detail, the post-save invoice screen).
//   - printWithTitle(name): swaps the title only for the duration of one
//     print dialog, then restores it on `afterprint`. Use for dialog / modal
//     print buttons where there's no dedicated page whose title we can own.

// Turn an invoice/receipt no. like "SO/08/366" into something a filesystem
// will accept as a filename ("SO-08-366").
export function pdfSafeName(raw: string): string {
  return raw
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

export function printWithTitle(title: string): void {
  const clean = pdfSafeName(title);
  if (!clean) {
    window.print();
    return;
  }

  const original = document.title;
  let restored = false;
  const restore = () => {
    if (restored) return;
    restored = true;
    document.title = original;
    window.removeEventListener("afterprint", restore);
  };

  document.title = clean;
  window.addEventListener("afterprint", restore);
  // Fallback: if afterprint never fires, put the title back anyway.
  window.setTimeout(restore, 60_000);

  window.print();
}

// Keep document.title pinned to `title` while the calling component is
// mounted (restoring the previous title on unmount). Pass an empty string to
// leave the title alone (e.g. while the record is still loading).
export function usePrintTitle(title: string | null | undefined): void {
  useEffect(() => {
    const clean = title ? pdfSafeName(title) : "";
    if (!clean) return;
    const original = document.title;
    document.title = clean;
    return () => {
      document.title = original;
    };
  }, [title]);
}
