// Product photos are stored as base64 data URLs in `products.imageUrl` (same
// convention as the company logo and entity attachments — see
// lib/db/src/schema/subscriptions.ts and entities.ts). Embedding that blob
// directly in every product list/search response meant the same multi-MB
// image was re-downloaded on every keystroke, with no way for a service
// worker to cache it (there was no separate URL to intercept). This turns
// each image into its own small, cacheable HTTP resource instead.
//
// The `v=` query param is the product's own `updatedAt` timestamp, so a
// re-uploaded photo gets a brand-new URL automatically — safe to tell
// browsers/service-workers to cache the response "forever".
export function buildProductImageUrl(id: number, updatedAt: Date | string | null | undefined): string {
  const v = updatedAt ? new Date(updatedAt).getTime() : 0;
  return `/api/products/${id}/image?v=${v}`;
}

const DATA_URL_RE = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/;

export function decodeProductImageDataUrl(dataUrl: string): { mimeType: string; bytes: Buffer } | null {
  const match = DATA_URL_RE.exec(dataUrl);
  if (!match) return null;
  const [, mimeType, base64] = match;
  return { mimeType, bytes: Buffer.from(base64, "base64") };
}
