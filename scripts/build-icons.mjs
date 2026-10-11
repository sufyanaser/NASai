import { readFile, writeFile } from "node:fs/promises";
import pngToIco from "png-to-ico";
import sharp from "sharp";

const source = "assets/brand/nasai-mascot.png";
const iconPng = "assets/brand/nasai-app-icon.png";
const iconIco = "assets/NASai.ico";

const background = Buffer.from(`
  <svg width="1024" height="1024" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="#14243a"/>
        <stop offset="1" stop-color="#071019"/>
      </linearGradient>
      <radialGradient id="glow" cx="65%" cy="18%" r="70%">
        <stop offset="0" stop-color="#42d9b0" stop-opacity=".24"/>
        <stop offset="1" stop-color="#42d9b0" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1024" height="1024" rx="220" fill="url(#bg)"/>
    <rect width="1024" height="1024" rx="220" fill="url(#glow)"/>
  </svg>`);

const mascot = await sharp(source)
  .resize(830, 830, { fit: "contain" })
  .png()
  .toBuffer();

await sharp(background)
  .composite([{ input: mascot, gravity: "center" }])
  .png()
  .toFile(iconPng);

const sizes = [16, 24, 32, 48, 64, 128, 256];
const frames = await Promise.all(
  sizes.map((size) => sharp(iconPng).resize(size, size).png().toBuffer()),
);
await writeFile(iconIco, await pngToIco(frames));

const icon = await readFile(iconIco);
if (icon.length < 10_000)
  throw new Error("Generated ICO is unexpectedly small");

console.log(
  `Built ${iconIco} with ${sizes.length} sizes (${icon.length} bytes)`,
);
