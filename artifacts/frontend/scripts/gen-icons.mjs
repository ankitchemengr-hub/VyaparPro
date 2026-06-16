import sharp from "sharp";
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const svgPath = resolve(__dirname, "../public/pwa-icon.svg");
const svg = readFileSync(svgPath);

const sizes = [72, 96, 128, 144, 152, 192, 384, 512];

for (const size of sizes) {
  await sharp(svg)
    .resize(size, size)
    .png()
    .toFile(resolve(__dirname, `../public/pwa-${size}x${size}.png`));
  console.log(`Generated pwa-${size}x${size}.png`);
}

await sharp(svg).resize(180, 180).png().toFile(resolve(__dirname, "../public/apple-touch-icon.png"));
console.log("Generated apple-touch-icon.png");

await sharp(svg).resize(32, 32).png().toFile(resolve(__dirname, "../public/favicon-32x32.png"));
await sharp(svg).resize(16, 16).png().toFile(resolve(__dirname, "../public/favicon-16x16.png"));
console.log("Generated favicons");
