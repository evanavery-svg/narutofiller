#!/usr/bin/env node
// Generates the leaf-swirl logo and renders the app icons (PNG) with Playwright's Chromium.
// Also writes the logo into index.html between the <!-- leaf:start --> / <!-- leaf:end --> markers.
// Usage: node tools/make-icons.js   (requires the `playwright` package and Chromium)
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const OUT = path.join(ROOT, "icons");

// ---------- Logo geometry ----------
// A spiral of about 1.75 turns. Its outer ring carries a pointed leaf tip (lower left)
// and a short straight stem (upper right). Built in a 550x500 sketch space, then
// normalised to a 100x100 box. Angles are degrees, counter-clockwise, y up.
const RADIUS = [[48, 198], [90, 190], [180, 180], [270, 186], [330, 172], [380, 152], [430, 116],
  [480, 98], [540, 84], [630, 84], [690, 72], [730, 50], [770, 26]];
const CENTRE = [[48, 304, 262], [360, 304, 262], [540, 316, 250], [770, 350, 260]];
const SQUASH = 1.0;
// Leaf tip: both edges leave the outer ring along its tangent, so they flow out of it
const TIP = [8, 402], TIP_UPPER_ANGLE = 136, TIP_LOWER_ANGLE = 272, TIP_PULL = [150, 175];
const STEM_LENGTH = 80;

// Interpolation through the table rows. "smooth": cubic Hermite with Catmull-Rom slopes
// (used for the radius, so the spiral has no flat spots). Otherwise an eased blend between
// neighbouring rows, which keeps the centre still while the outer ring is drawn.
function interp(table, a, smooth) {
  const n = table.length, k = table[0].length - 1;
  let i = 0;
  while (i < n - 2 && a > table[i + 1][0]) i++;
  const x0 = table[i][0], x1 = table[i + 1][0], h = x1 - x0;
  const t = Math.min(1, Math.max(0, (a - x0) / h));
  const slope = (j, c) => {
    const lo = table[Math.max(0, j - 1)], hi = table[Math.min(n - 1, j + 1)];
    return (hi[c] - lo[c]) / (hi[0] - lo[0]);
  };
  if (!smooth) {
    const e = t * t * (3 - 2 * t);
    return table[i].slice(1).map((v, c) => v + (table[i + 1][c + 1] - v) * e);
  }
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t, h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  const out = [];
  for (let c = 1; c <= k; c++) {
    out.push(h00 * table[i][c] + h10 * h * slope(i, c) + h01 * table[i + 1][c] + h11 * h * slope(i + 1, c));
  }
  return out;
}
function spiralPoint(a) {
  const [r] = interp(RADIUS, a, true), [cx, cy] = interp(CENTRE, a, false), th = (a * Math.PI) / 180;
  return [cx + SQUASH * r * Math.cos(th), cy - r * Math.sin(th)];
}

function tangent(a) { // direction of travel along the spiral at angle a (screen coords)
  const th = (a * Math.PI) / 180;
  return [-Math.sin(th), -Math.cos(th)];
}

/** The logo in sketch coordinates: { stem, spiral, up, cu, cl, lo } */
function leafSketch() {
  const a0 = RADIUS[0][0], a1 = RADIUS[RADIUS.length - 1][0];
  const n = Math.round((a1 - a0) / 10);
  const spiral = Array.from({ length: n + 1 }, (_, i) => spiralPoint(a0 + ((a1 - a0) * i) / n));
  const s0 = spiral[0];
  const stem = [s0, [s0[0] + STEM_LENGTH * 0.72, s0[1] - STEM_LENGTH * 0.69]];
  const up = spiralPoint(TIP_UPPER_ANGLE), lo = spiralPoint(TIP_LOWER_ANGLE);
  const tu = tangent(TIP_UPPER_ANGLE), tl = tangent(TIP_LOWER_ANGLE);
  const cu = [up[0] + tu[0] * TIP_PULL[0], up[1] + tu[1] * TIP_PULL[0]]; // continue past the ring
  const cl = [lo[0] - tl[0] * TIP_PULL[1], lo[1] - tl[1] * TIP_PULL[1]]; // arrive along the ring
  return { stem, spiral, up, cu, cl, lo };
}

function toPathData(g, N) {
  const { stem, spiral, up, cu, cl, lo } = g;
  const P = (i) => spiral[Math.max(0, Math.min(spiral.length - 1, i))];
  let curve = "M" + N(spiral[0]);
  for (let i = 0; i < spiral.length - 1; i++) { // Catmull-Rom -> cubic Bezier
    const p0 = P(i - 1), p1 = P(i), p2 = P(i + 1), p3 = P(i + 2);
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    curve += `C${N(c1)} ${N(c2)} ${N(p2)}`;
  }
  return `M${N(stem[0])}L${N(stem[1])}` + curve + `M${N(up)}Q${N(cu)} ${N(TIP)}Q${N(cl)} ${N(lo)}`;
}

function leafPath() {
  const g = leafSketch();
  const all = [...g.spiral, ...g.stem, TIP];
  const xs = all.map((p) => p[0]), ys = all.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = 88 / Math.max(maxX - minX, maxY - minY); // 6 units of padding for the stroke
  const offX = (100 - (maxX - minX) * scale) / 2, offY = (100 - (maxY - minY) * scale) / 2;
  const N = (p) => `${(offX + (p[0] - minX) * scale).toFixed(1)} ${(offY + (p[1] - minY) * scale).toFixed(1)}`;
  return toPathData(g, N);
}

const LEAF = leafPath();
module.exports = { leafSketch, toPathData, LEAF };
const INK = "#16130f";

// ---------- Icons ----------
// "any" icons: rounded orange tile. Maskable / Apple: full-bleed tile with the symbol
// kept inside the central safe zone.
function iconSvg({ size, rounded, scale, stroke }) {
  const s = 512 * scale; // symbol box size
  const o = (512 - s) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="${size}" height="${size}">
  <defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#ffae45"/><stop offset="1" stop-color="#ec7b12"/></linearGradient></defs>
  <rect width="512" height="512" rx="${rounded ? 112 : 0}" fill="url(#bg)"/>
  <g transform="translate(${o.toFixed(1)} ${(o + 6 * scale).toFixed(1)}) scale(${(s / 100).toFixed(4)})">
    <path d="${LEAF}" fill="none" stroke="${INK}" stroke-width="${stroke}" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;
}

const targets = [
  { file: "icon-192.png", size: 192, rounded: true, scale: 0.7, stroke: 5.6 },
  { file: "icon-512.png", size: 512, rounded: true, scale: 0.7, stroke: 5.2 },
  { file: "icon-maskable-192.png", size: 192, rounded: false, scale: 0.56, stroke: 6 },
  { file: "icon-maskable-512.png", size: 512, rounded: false, scale: 0.56, stroke: 5.6 },
  { file: "apple-touch-icon.png", size: 180, rounded: false, scale: 0.66, stroke: 5.8 },
  { file: "favicon-32.png", size: 32, rounded: true, scale: 0.84, stroke: 8.5 },
];

if (require.main === module) (async () => {
  const browser = await chromium.launch();
  for (const t of targets) {
    const page = await browser.newPage({ viewport: { width: t.size, height: t.size } });
    await page.setContent(`<html><body style="margin:0;background:transparent">${iconSvg(t)}</body></html>`);
    await page.screenshot({ path: path.join(OUT, t.file), omitBackground: true, clip: { x: 0, y: 0, width: t.size, height: t.size } });
    await page.close();
    console.log("wrote", t.file);
  }
  await browser.close();

  fs.writeFileSync(path.join(OUT, "icon.svg"),
    iconSvg({ size: 512, rounded: true, scale: 0.7, stroke: 5.2 }).replace(' width="512" height="512"', "") + "\n");
  console.log("wrote icon.svg");

  // Header logo in index.html
  const indexPath = path.join(ROOT, "index.html");
  const html = fs.readFileSync(indexPath, "utf8");
  const re = /<!-- leaf:start -->[\s\S]*?<!-- leaf:end -->/;
  if (re.test(html)) {
    const inline = `<!-- leaf:start --><svg class="app-leaf" viewBox="0 0 100 100" aria-hidden="true" focusable="false"><path d="${LEAF}"/></svg><!-- leaf:end -->`;
    fs.writeFileSync(indexPath, html.replace(re, inline));
    console.log("updated logo in index.html");
  }
})();
