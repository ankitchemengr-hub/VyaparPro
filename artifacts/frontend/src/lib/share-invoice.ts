import { domToBlob } from "modern-screenshot";

// Snapshots a rendered invoice sheet and hands it to the phone's native share
// sheet (Web Share API level 2, file sharing) — WhatsApp shows up there like
// any other app, and the recipient gets a real image of the invoice, not just
// a text summary. Falls back to downloading the PNG on browsers that don't
// support sharing files (desktop Chrome/Firefox, older mobile browsers), so
// the invoice can still be attached manually.
//
// Uses modern-screenshot (not html2canvas/html2canvas-pro) — it renders via
// an SVG <foreignObject>, letting the browser do the actual painting instead
// of hand-parsing every CSS value. html2canvas-pro added oklch() support but
// still doesn't understand color-mix(), which Tailwind v4 generates
// throughout for opacity variants (e.g. bg-green-100, hover states) — that
// combination made every capture fail with "unsupported color function".
export async function shareInvoiceImage(
  sheetEl: HTMLElement,
  opts: { fileName: string; title: string; text: string },
): Promise<"shared" | "downloaded"> {
  // On phones, ScreenFitInvoiceSheet shrinks the sheet with a CSS `transform:
  // scale()` on an ancestor so it fits the narrow viewport. When no
  // width/height is given, modern-screenshot sizes its capture off
  // getBoundingClientRect(), which reflects that visual shrink — so the
  // shared image came out tiny instead of the full invoice. scrollWidth/
  // scrollHeight are layout properties transform never touches, so they
  // still report the sheet's true, unscaled size; passing them explicitly
  // makes modern-screenshot capture at full size regardless of on-screen zoom.
  const blob = await domToBlob(sheetEl, {
    scale: 2,
    backgroundColor: "#ffffff",
    width: sheetEl.scrollWidth,
    height: sheetEl.scrollHeight,
  });
  if (!blob) throw new Error("Could not generate invoice image");
  const file = new File([blob], opts.fileName, { type: "image/png" });

  const nav = navigator as Navigator & {
    canShare?: (data: { files: File[] }) => boolean;
    share?: (data: { files: File[]; title?: string; text?: string }) => Promise<void>;
  };

  if (nav.canShare && nav.share && nav.canShare({ files: [file] })) {
    await nav.share({ files: [file], title: opts.title, text: opts.text });
    return "shared";
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = opts.fileName;
  a.click();
  URL.revokeObjectURL(url);
  return "downloaded";
}
