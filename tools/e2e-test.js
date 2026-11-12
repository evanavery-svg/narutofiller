#!/usr/bin/env node
/* End-to-end checks with Playwright + Chromium (optional dev tool; the site itself needs no npm).
 * Usage: node tools/e2e-test.js
 * Copies the site into a temp dir under a /naruto-filler/ subpath (like GitHub Pages),
 * serves it with `python3 -m http.server`, and checks features, offline mode,
 * installability and the update banner. Also checks opening index.html via file://.
 */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
const FILES = ["index.html", "styles.css", "app.js", "sync.js", "firebase-config.js", "manifest.json", "service-worker.js", "data", "icons", "fonts"];
const SW_VERSION = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8").match(/CACHE_VERSION = "([^"]+)"/)[1];
const PRECACHE_COUNT = (fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8").match(/const PRECACHE = \[([\s\S]*?)\]/)[1].match(/"\.\//g) || []).length;
const PORT = 8765;
const BASE = `http://localhost:${PORT}/naruto-filler/`;

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  — " + extra : ""}`);
  if (!cond) failures++;
}

// Ranges published at the top of animefillerlist.com/shows/naruto (independent of the per-episode table)
const AFL = {
  canon: "1-6, 8, 10-13, 17, 22, 25, 31-36, 42, 48, 50-51, 61-62, 64-65, 67-68, 73, 75-82, 84-96, 107-111, 115-125, 128-129, 132-135",
  mixed: "7, 9, 14-16, 18-21, 23-24, 27-30, 37-41, 43-47, 49, 52-60, 63, 66, 69-72, 74, 83, 98-100, 112-114, 126-127, 130-131, 141-142, 220",
  filler: "26, 97, 101-106, 136-140, 143-219",
};
const expand = (s) => s.split(",").flatMap((p) => {
  const [a, b] = p.trim().split("-").map(Number);
  return b ? Array.from({ length: b - a + 1 }, (_, i) => a + i) : [a];
});
const collapse = (nums) => {
  const r = [];
  [...nums].sort((a, b) => a - b).forEach((n) => {
    const last = r[r.length - 1];
    if (last && n === last[1] + 1) last[1] = n; else r.push([n, n]);
  });
  return r.map(([a, b]) => (a === b ? `${a}` : `${a}–${b}`)).join(", ");
};

(async () => {
  // ---- Data cross-check against the AFL summary ranges ----
  const ctx = {};
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, "data/episodes.js"), "utf8") + "\nthis.E = EPISODES;", ctx);
  const E = ctx.E;
  for (const t of Object.keys(AFL)) {
    const mine = E.filter((e) => e.type === t).map((e) => e.number).join(",");
    check(`data: "${t}" episodes match AFL summary list`, mine === expand(AFL[t]).join(","));
  }

  // ---- Prepare served copy at a subpath ----
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-e2e-"));
  const site = path.join(tmp, "naruto-filler");
  fs.mkdirSync(site);
  for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(site, f), { recursive: true });
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: tmp, stdio: "ignore" });
  // Wait until the server answers
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch (e) { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }

  const browser = await chromium.launch();
  try {
    // ================= file:// =================
    {
      const page = await browser.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto("file://" + path.join(ROOT, "index.html"));
      check("file://: 220 episodes rendered", (await page.locator(".episode").count()) === 220);
      check("file://: no JS errors", errors.length === 0, errors.join(" | "));
      check("file://: no service worker registered", await page.evaluate(async () => {
        if (!navigator.serviceWorker) return true;
        try { return (await navigator.serviceWorker.getRegistrations()).length === 0; } catch (e) { return true; } // not allowed on file://
      }));
      check("file://: offline/install note shown", await page.locator("#file-note").isVisible());
      check("file://: sharing explains it needs the hosted site", (await page.textContent("#sync-unavailable-text")).includes("hosted site"));
      await page.locator(`.episode >> nth=4 >> input`).check();
      await page.reload();
      check("file://: watched state persists", await page.locator(`#ep-5 input`).isChecked());
      await page.close();
    }

    // ================= http (features) =================
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    let navigations = 0;
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations++; });
    await page.goto(BASE);
    await page.waitForSelector("#ep-220");
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.waitForTimeout(1000);
    check("sw: first visit installs without reloading the page", navigations === 1, navigations);

    const visibleNums = () => page.$$eval(".episode:not([hidden])", (els) => els.map((e) => Number(e.id.slice(3))));
    const toggle = (t) => page.click(`.filter[data-type="${t}"]`);

    check("http: 220 episodes rendered", (await page.locator(".episode").count()) === 220);
    check("http: legend lists 4 types", (await page.locator("#legend-list .legend-item").count()) === 4);
    check("sync: not configured -> setup note, no buttons", (await page.locator("#sync-unavailable").isVisible()) && !(await page.locator("#sync-create").isVisible()));

    // Filters
    await toggle("filler");
    let v = await visibleNums();
    check("filter: canon+mixed only (filler off)", v.length === 130 && v.every((n) => E[n - 1].type !== "filler"), v.length);
    await toggle("mixed");
    v = await visibleNums();
    check("filter: canon only", v.length === 74 && v.every((n) => E[n - 1].type === "canon"), v.length);
    await toggle("canon");
    check("filter: none selected shows empty state", (await visibleNums()).length === 0 && (await page.locator("#empty-state").isVisible()));
    await toggle("filler");
    v = await visibleNums();
    check("filter: filler only", v.length === 90 && v.every((n) => E[n - 1].type === "filler"), v.length);

    // Search combined with filter (filler only)
    await page.fill("#search", "KAKASHI");
    v = await visibleNums();
    const expectKakashiFiller = E.filter((e) => e.type === "filler" && e.title.toLowerCase().includes("kakashi")).map((e) => e.number);
    check("search+filter: 'KAKASHI' within filler (case-insensitive)", JSON.stringify(v) === JSON.stringify(expectKakashiFiller), v.join(","));
    await toggle("canon"); await toggle("mixed");
    await page.fill("#search", "kakashi");
    v = await visibleNums();
    const expectKakashi = E.filter((e) => e.title.toLowerCase().includes("kakashi")).map((e) => e.number);
    check("search: 'kakashi' all types", JSON.stringify(v) === JSON.stringify(expectKakashi), v.length);
    await page.fill("#search", "135");
    check("search: number '135'", JSON.stringify(await visibleNums()) === "[135]");
    await page.fill("#search", "#7");
    check("search: '#7'", JSON.stringify(await visibleNums()) === "[7]");
    await page.fill("#search", "");
    check("search cleared: all 220 shown", (await visibleNums()).length === 220);

    // Watch tracker
    for (const n of [1, 2, 3, 26]) await page.check(`#ep-${n} input`);
    check("tracker: all progress 4/220", (await page.textContent("#progress-all-text")).startsWith("4 / 220"));
    check("tracker: canon progress 3/74", (await page.textContent("#progress-canon-text")) === "3 / 74");
    check("map: 220 squares in each map", (await page.locator("#ep-map .cell").count()) === 220 && (await page.locator("#guide-map .cell").count()) === 220);
    check("map: watched squares lit", (await page.locator("#ep-map .cell.is-on").count()) === 4);
    check("map: next episode marked", (await page.getAttribute("#ep-map .cell.is-next", "data-n")) === "4");
    check("ring: shows 2%", (await page.textContent("#ring-value")) === "2%");
    await page.fill("#search", "zzz");
    await page.click('#ep-map .cell[data-n="150"]');
    await page.waitForTimeout(700);
    check("map: tapping a square jumps to that episode", await page.locator("#ep-150").isVisible() && (await page.locator("#ep-150.is-highlight").count()) === 1);
    await page.fill("#search", "");
    // next ep (skip filler on by default)
    check("next: skip filler default -> ep 4", (await page.textContent("#next-hint")).startsWith("Ep 4 "));
    for (let n = 4; n <= 25; n++) await page.check(`#ep-${n} input`);
    await page.uncheck("#ep-26 input");
    check("next: skip filler -> ep 27 (skips 26)", (await page.textContent("#next-hint")).startsWith("Ep 27 "));
    await page.click("#skip-filler-next + .switch-ui");
    check("next: no skip -> ep 26", (await page.textContent("#next-hint")).startsWith("Ep 26 "));
    await page.click("#skip-filler-next + .switch-ui");
    // jump while filter hides target
    await toggle("mixed");
    await page.fill("#search", "zzz");
    await page.click("#next-button");
    await page.waitForTimeout(700);
    check("next: jump reveals hidden target ep 27", await page.locator("#ep-27").isVisible());
    check("next: target highlighted", await page.locator("#ep-27.is-highlight").count() === 1);
    check("next: target in viewport", await page.locator("#ep-27").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    // hide watched
    await page.click("#hide-watched + .switch-ui");
    v = await visibleNums();
    check("hide watched: eps 1–25 hidden", v[0] === 26 && v.length === 195, v.length);
    await page.click("#hide-watched + .switch-ui");

    // persistence
    await page.reload();
    const checked = await page.$$eval(".episode input:checked", (els) => els.map((e) => Number(e.dataset.number)));
    check("persistence: watched survive reload", JSON.stringify(checked) === JSON.stringify(Array.from({ length: 25 }, (_, i) => i + 1)), checked.length);
    check("persistence: progress after reload", (await page.textContent("#progress-all-text")).startsWith("25 / 220"));

    // reset confirm
    await page.click("#reset-button");
    check("reset: confirm step shown", await page.locator("#reset-confirm").isVisible());
    await page.click("#reset-cancel");
    check("reset: cancel keeps progress", (await page.locator(".episode input:checked").count()) === 25);
    await page.click("#reset-button");
    await page.click("#reset-yes");
    check("reset: confirm clears all", (await page.locator(".episode input:checked").count()) === 0);
    await page.reload();
    check("reset: cleared state persists", (await page.locator(".episode input:checked").count()) === 0);

    // Skip-filler guide
    await page.click("#tab-guide");
    const watchIncl = collapse([...expand(AFL.canon), ...expand(AFL.mixed)]);
    check("guide (incl. mixed): ranges match data", (await page.textContent("#guide-watch-text")) === watchIncl, await page.textContent("#guide-watch-text"));
    check("guide (incl. mixed): skip ranges", (await page.textContent("#guide-skip-text")) === collapse(expand(AFL.filler)));
    check("guide (incl. mixed): count 130", (await page.textContent("#guide-watch-count")) === "130");
    check("guide map: 130 squares lit", (await page.locator("#guide-map .cell.is-on").count()) === 130);
    check("guide (incl. mixed): time saved 90×23 = 34 h 30 min", (await page.textContent("#guide-time-saved")) === "~34 h 30 min");
    await page.click("#include-mixed + .switch-ui");
    check("guide (canon only): ranges match data", (await page.textContent("#guide-watch-text")) === collapse(expand(AFL.canon)), await page.textContent("#guide-watch-text"));
    check("guide (canon only): count 74", (await page.textContent("#guide-watch-count")) === "74");
    check("guide (canon only): time saved 146×23 = 55 h 58 min", (await page.textContent("#guide-time-saved")) === "~55 h 58 min");
    await page.screenshot({ path: path.join(tmp, "guide-mobile.png"), fullPage: true });
    await page.click("#include-mixed + .switch-ui");
    await page.click("#tab-episodes");
    await page.screenshot({ path: path.join(tmp, "episodes-mobile.png") });
    check("mobile: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // ================= PWA =================
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    const swInfo = await page.evaluate(async () => {
      const reg = await navigator.serviceWorker.getRegistration();
      return { scope: reg && reg.scope, controlled: !!navigator.serviceWorker.controller };
    });
    check("sw: registered with subpath scope", swInfo.scope === BASE, swInfo.scope);
    if (!swInfo.controlled) await page.reload();
    check("sw: page controlled", await page.evaluate(() => !!navigator.serviceWorker.controller));
    const cached = await page.evaluate(async () => {
      const keys = await caches.keys();
      const c = await caches.open(keys[0]);
      return { keys, urls: (await c.keys()).map((r) => new URL(r.url).pathname) };
    });
    check("sw: one versioned cache", cached.keys.length === 1 && cached.keys[0] === "naruto-filler-" + SW_VERSION, cached.keys.join(","));
    check(`sw: precached all ${PRECACHE_COUNT} files`, cached.urls.length >= PRECACHE_COUNT, cached.urls.length);

    const cdp = await context.newCDPSession(page);
    const manifest = await cdp.send("Page.getAppManifest");
    check("manifest: parsed with no errors", manifest.errors.length === 0, JSON.stringify(manifest.errors));
    const inst = await cdp.send("Page.getInstallabilityErrors");
    check("installability: no errors", inst.installabilityErrors.length === 0, JSON.stringify(inst.installabilityErrors));

    // Offline
    await context.setOffline(true);
    await page.reload();
    check("offline: page loads with 220 episodes", (await page.locator(".episode").count()) === 220);
    await page.check("#ep-10 input");
    await page.goto(BASE + "index.html");
    check("offline: index.html loads & watched persists", await page.locator("#ep-10 input").isChecked());
    const iconOk = await page.evaluate(async () => (await fetch("./icons/icon-512.png")).ok);
    check("offline: icons served from cache", iconOk);
    await context.setOffline(false);

    // Update flow: publish a new version, expect banner, click it, expect reload on new cache
    const swPath = path.join(site, "service-worker.js");
    fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8").replace(`"${SW_VERSION}"`, '"v-update-test"'));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    await page.waitForSelector("#update-banner:not([hidden])", { timeout: 10000 }).catch(() => {});
    check("update: banner shown", await page.locator("#update-banner").isVisible());
    await page.screenshot({ path: path.join(tmp, "update-banner.png") });
    await Promise.all([page.waitForEvent("load", { timeout: 10000 }).catch(() => {}), page.click("#update-button")]);
    await page.waitForTimeout(500);
    const keysAfter = await page.evaluate(() => caches.keys());
    check("update: reloaded onto new cache, old cache deleted", keysAfter.length === 1 && keysAfter[0] === "naruto-filler-v-update-test", keysAfter.join(","));
    check("update: watched state kept", await page.locator("#ep-10 input").isChecked());

    check("http: no JS/console errors", errors.length === 0, errors.join(" | "));
    console.log("\nScreenshots in", tmp);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
})();
