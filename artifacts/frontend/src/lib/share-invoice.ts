// html2canvas (not -pro) doesn't understand oklch(), the color space
// Tailwind v4's default palette is defined in — it throws "Attempting to
// parse an unsupported color function 'oklch'" the moment it hits any
// Tailwind color utility class. html2canvas-pro is a maintained drop-in
// fork that adds oklch/lab/lch/color() support; same API otherwise.
import html2canvas from "html2canvas-pro";

// Snapshots a rendered invoice sheet and hands it to the phone's native share
// sheet (Web Share API level 2, file sharing) — WhatsApp shows up there like
// any other app, and the recipient gets a real image of the invoice, not just
// a text summary. Falls back to downloading the PNG on browsers that don't
// support sharing files (desktop Chrome/Firefox, older mobile browsers), so
// the invoice can still be attached manually.
export async function shareInvoiceImage(
  sheetEl: HTMLElement,
  opts: { fileName: string; title: string; text: string },
): Promise<"shared" | "downloaded"> {
  const canvas = await html2canvas(sheetEl, {
    scale: 2,
    backgroundColor: "#ffffff",
    useCORS: true,
  });
  const blob: Blob | null = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
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
