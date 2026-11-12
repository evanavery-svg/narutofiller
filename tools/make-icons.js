#!/usr/bin/env node
// Renders the app icons (PNG) from simple inline SVG designs using Playwright's Chromium.
// Usage: node tools/make-icons.js   (requires the `playwright` package and Chromium)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const OUT = path.join(__dirname, "..", "icons");
const FONT = "DejaVu Sans, Arial, Helvetica, sans-serif";

// "any" icon: rounded orange tile. "full": full-bleed tile (maskable / Apple),
// with the artwork scaled into the central safe zone.
function svg({ rounded, scale }) {
  const s = scale; // content scale around the centre
  const t = (v) => 256 + (v - 256) * s;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ff9a3c"/><stop offset="1" stop-color="#e8590c"/></linearGradient></defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <text x="256" y="${t(303)}" text-anchor="middle" font-family="${FONT}" font-weight="700"
        font-size="${210 * s}" letter-spacing="${-8 * s}" fill="#16130f">NF</text>
  <rect x="${t(136)}" y="${t(341)}" width="${240 * s}" height="${22 * s}" rx="${11 * s}" fill="#16130f"/>
</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, rounded: true, scale: 1 },
  { file: "icon-512.png", size: 512, rounded: true, scale: 1 },
  { file: "icon-maskable-192.png", size: 192, rounded: false, scale: 0.78 },
  { file: "icon-maskable-512.png", size: 512, rounded: false, scale: 0.78 },
  { file: "apple-touch-icon.png", size: 180, rounded: false, scale: 0.9 },
  { file: "favicon-32.png", size: 32, rounded: true, scale: 1.1 },
];

(async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    const html = `<html><body style="margin:0;background:transparent">
      <div style="width:${t.size}px;height:${t.size}px">${svg(t).replace('width="512" height="512"', `width="${t.size}" height="${t.size}"`)}</div></body></html>`;
    await page.setContent(html);
    await page.screenshot({ path: path.join(OUT, t.file), omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
    await page.close();
    console.log("wrote", t.file);
  }
  fs.writeFileSync(path.join(OUT, "icon.svg"), svg({ rounded: true, scale: 1 }).replace(' width="512" height="512"', "") + "\n");
  await browser.close();
})();
