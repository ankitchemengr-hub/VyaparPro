import sharp from "sharp";
import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const sourcePath = resolve(__dirname, "../public/pwa-icon-source.jpg");
const source = readFileSync(sourcePath);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

for (const size of sizes) {
  await sharp(source)
    .resize(size, size)
    .png()
    .toFile(resolve(__dirname, `../public/pwa-${size}x${size}.png`));
  console.log(`Generated pwa-${size}x${size}.png`);
}

await sharp(source).resize(180, 180).png().toFile(resolve(__dirname, "../public/apple-touch-icon.png"));
console.log("Generated apple-touch-icon.png");

await sharp(source).resize(32, 32).png().toFile(resolve(__dirname, "../public/favicon-32x32.png"));
await sharp(source).resize(16, 16).png().toFile(resolve(__dirname, "../public/favicon-16x16.png"));
console.log("Generated favicons");

// favicon.svg — the source logo is raster, not vector, so wrap a small PNG
// render in an SVG shell (via an embedded data URI) to keep the existing
// <link rel="icon" type="image/svg+xml" href="/favicon.svg"> in index.html working.
const faviconPng = await sharp(source).resize(64, 64).png().toBuffer();
const faviconSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64"><image width="64" height="64" href="data:image/png;base64,${faviconPng.toString("base64")}"/></svg>\n`;
writeFileSync(resolve(__dirname, "../public/favicon.svg"), faviconSvg);
console.log("Generated favicon.svg");
