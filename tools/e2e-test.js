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
const FILES = ["index.html", "styles.css", "app.js", "sync.js", "firebase-config.js", "manifest.json", "service-worker.js", "data", "icons"];
const SW_VERSION = fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8").match(/CACHE_VERSION = "([^"]+)"/)[1];
const PRECACHE_COUNT = (fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8").match(/const PRECACHE = \[([\s\S]*?)\]/)[1].match(/"\.\//g) || []).length;
const PORT = 8765;
const BASE = `http://localhost:${PORT}/naruto-filler/`;

let failures = 0;
async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) { last = await fn(); if (last) return last; await new Promise((r) => setTimeout(r, 200)); }
  return last;
}
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
  // This test covers the site with sharing switched off (tools/sync-test.js covers it switched on)
  fs.writeFileSync(path.join(site, "firebase-config.js"), "const FIREBASE_CONFIG = null;\n");
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
      check("file://: offline/install note in the menu", await page.$eval("#file-note", (e) => !e.hidden));
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
    const show = (v) => page.click(`#filters [data-show="${v}"]`);
    const isOpen = (id) => page.evaluate((i) => document.getElementById(i).open, id);
    const openMenu = async () => { if (!(await isOpen("menu-sheet"))) await page.click("#menu-open"); };
    const closeSheets = () => page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
    const menuSwitch = async (id) => { await openMenu(); await page.click("#" + id); await closeSheets(); };
    const openGuide = async () => { await openMenu(); await page.click("#menu-guide"); };

    check("http: 220 episodes rendered", (await page.locator(".episode").count()) === 220);
    check("http: main screen is just progress, search, switcher and list", (await page.locator("main > :not([hidden]):not(.empty-state)").count()) === 3);
    check("http: canon vs filler explained in the menu", (await page.textContent(".about")).includes("Filler"));
    check("categories: All / Canon / Filler switcher", (await page.$$eval("#filters [data-show]", (b) => b.map((x) => x.dataset.show).join(","))) === "all,canon,filler");
    check("categories: a 'mixed' episode (7) counts as canon (no Filler tag)", (await page.locator("#ep-7 .badge").count()) === 0);
    check("categories: filler episode (26) is tagged Filler", (await page.textContent("#ep-26 .badge")) === "Filler");
    check("categories: only the 90 filler episodes are tagged", (await page.locator(".episode .badge").count()) === 90);
    await openMenu();
    check("menu: opens with its rows", await isOpen("menu-sheet") && await page.isVisible("#menu-bulk") && await page.isVisible("#menu-guide") && await page.isVisible("#menu-sync"));
    check("menu: Watch Together says 'Not set up'", (await page.textContent("#menu-sync-status")) === "Not set up");
    await page.click("#menu-sync");
    check("sync: sheet replaces the menu", await isOpen("sync-sheet") && !(await isOpen("menu-sheet")));
    check("sync: not configured -> setup note, no buttons", (await page.locator("#sync-unavailable").isVisible()) && !(await page.locator("#sync-create").isVisible()));
    await page.keyboard.press("Escape");
    check("sync: Escape closes", !(await isOpen("sync-sheet")));
    check("sync: no 'Shared' label or invite banner when not sharing", !(await page.isVisible("#sync-chip")) && !(await page.isVisible("#invite-banner")));

    // Filters
    await show("canon");
    let v = await visibleNums();
    check("filter: Canon", v.length === 130 && v.every((n) => E[n - 1].type !== "filler"), v.length);
    check("filter: switcher shows the selection", (await page.getAttribute('#filters [data-show="canon"]', "aria-checked")) === "true");
    await show("filler");
    v = await visibleNums();
    check("filter: filler only", v.length === 90 && v.every((n) => E[n - 1].type === "filler"), v.length);

    // Search combined with filter (filler only)
    await page.fill("#search", "KAKASHI");
    v = await visibleNums();
    const expectKakashiFiller = E.filter((e) => e.type === "filler" && e.title.toLowerCase().includes("kakashi")).map((e) => e.number);
    check("search+filter: 'KAKASHI' within filler (case-insensitive)", JSON.stringify(v) === JSON.stringify(expectKakashiFiller), v.join(","));
    await show("all");
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
    await page.fill("#search", "zzzz");
    check("search: no match shows empty state", (await visibleNums()).length === 0 && (await page.locator("#empty-state").isVisible()));
    await page.fill("#search", "");

    // Tapping the episode's title (or number) ticks it too
    await page.click("#ep-50 .ep-title");
    check("row: tapping the title ticks the episode", await page.isChecked("#ep-50 input"));
    await page.click("#ep-50 .ep-number");
    check("row: tapping the number unticks it", !(await page.isChecked("#ep-50 input")));
    await page.click("#ep-26 .badge");
    check("row: tapping the Filler tag ticks it", await page.isChecked("#ep-26 input"));
    await page.click("#ep-26 .ep-title");
    check("row: progress follows row taps", (await page.textContent("#progress-all-text")) === "0 of 220");

    // Watch tracker
    for (const n of [1, 2, 3, 26]) await page.check(`#ep-${n} input`);
    check("tracker: progress 4 of 220", (await page.textContent("#progress-all-text")) === "4 of 220");
    check("tracker: canon progress 3 of 130", (await page.textContent("#progress-canon-text")) === "3 of 130 canon episodes");
    check("tracker: button says Continue", (await page.textContent("#next-label")) === "Continue");
    // next ep (skip filler on by default)
    check("next: skip filler default -> ep 4", (await page.textContent("#next-hint")).startsWith("Ep 4 "));
    for (let n = 4; n <= 25; n++) await page.check(`#ep-${n} input`);
    await page.uncheck("#ep-26 input");
    check("next: skip filler -> ep 27 (skips 26)", (await page.textContent("#next-hint")).startsWith("Ep 27 "));
    await menuSwitch("skip-filler-next");
    check("next: no skip -> ep 26", (await page.textContent("#next-hint")).startsWith("Ep 26 "));
    await menuSwitch("skip-filler-next");
    // jump while filter hides target
    await show("filler");
    await page.fill("#search", "zzz");
    await page.click("#next-button");
    await page.waitForTimeout(700);
    check("next: jump reveals hidden target ep 27", await page.locator("#ep-27").isVisible());
    check("next: target highlighted", await page.locator("#ep-27.is-highlight").count() === 1);
    check("next: target in viewport", await page.locator("#ep-27").evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }));
    // hide watched
    await menuSwitch("hide-watched");
    v = await visibleNums();
    check("hide watched: eps 1–25 hidden", v[0] === 26 && v.length === 195, v.length);
    await menuSwitch("hide-watched");

    // persistence
    await page.reload();
    const checked = await page.$$eval(".episode input:checked", (els) => els.map((e) => Number(e.dataset.number)));
    check("persistence: watched survive reload", JSON.stringify(checked) === JSON.stringify(Array.from({ length: 25 }, (_, i) => i + 1)), checked.length);
    check("persistence: progress after reload", (await page.textContent("#progress-all-text")) === "25 of 220");

    // reset confirm
    await openMenu();
    await page.click("#reset-button");
    check("reset: confirm step shown", await page.locator("#reset-confirm").isVisible());
    await page.click("#reset-cancel");
    check("reset: cancel keeps progress", (await page.locator(".episode input:checked").count()) === 25);
    await page.click("#reset-button");
    await page.click("#reset-yes");
    check("reset: menu closes afterwards", !(await isOpen("menu-sheet")));
    check("reset: confirm clears all", (await page.locator(".episode input:checked").count()) === 0);
    await page.reload();
    check("reset: cleared state persists", (await page.locator(".episode input:checked").count()) === 0);

    // Skip-filler guide
    await openGuide();
    check("guide: opens from the menu", await isOpen("guide-sheet"));
    // Canon on the site = AFL's "Manga Canon" + "Mixed Canon/Filler"
    const watchAll = collapse([...expand(AFL.canon), ...expand(AFL.mixed)]);
    check("guide: watch ranges match data", (await page.textContent("#guide-watch-text")) === watchAll, await page.textContent("#guide-watch-text"));
    check("guide: skip ranges match data", (await page.textContent("#guide-skip-text")) === collapse(expand(AFL.filler)));
    check("guide: count 130", (await page.textContent("#guide-watch-count")) === "130");
    check("guide map: 220 squares, 130 lit", (await page.locator("#guide-map .cell").count()) === 220 && (await page.locator("#guide-map .cell.is-on").count()) === 130);
    check("guide: time saved 90×23 = 34h 30m", (await page.textContent("#guide-time-saved")) === "~34h 30m");
    await page.screenshot({ path: path.join(tmp, "guide-mobile.png"), fullPage: true });
    await page.click('#guide-map .cell[data-n="150"]');
    await page.waitForTimeout(700);
    check("guide map: tapping a square closes the guide", !(await isOpen("guide-sheet")));
    check("guide map: tapping a square jumps to that episode", await page.locator("#ep-150").isVisible() && (await page.locator("#ep-150.is-highlight").count()) === 1);
    await page.screenshot({ path: path.join(tmp, "episodes-mobile.png") });

    // Mark several episodes at once
    const bulkOpen = async () => { await openMenu(); await page.click("#menu-bulk"); return isOpen("bulk-sheet"); };
    check("bulk: opens", await bulkOpen());
    check("bulk: starts at episode 1, filler included", (await page.inputValue("#bulk-from")) === "1" && !(await page.isChecked("#bulk-skip-filler")));
    check("bulk: needs a 'to' episode first", await page.isDisabled("#bulk-watch"));
    await page.fill("#bulk-to", "30");
    check("bulk: summary counts the range", (await page.textContent("#bulk-summary")).includes("30 episodes"), await page.textContent("#bulk-summary"));
    await page.check("#bulk-skip-filler");
    check("bulk: skipping filler leaves 29 (ep 26 is filler)", (await page.textContent("#bulk-summary")).includes("29 episodes") && (await page.textContent("#bulk-summary")).includes("1 filler skipped"), await page.textContent("#bulk-summary"));
    await page.click("#bulk-watch");
    let w = await page.$$eval(".episode input:checked", (els) => els.map((e) => Number(e.dataset.number)));
    check("bulk: marked 1–30 except filler 26", w.length === 29 && !w.includes(26) && w.includes(30), w.join(","));
    check("bulk: sheet closed", !(await page.evaluate(() => document.getElementById("bulk-sheet").open)));
    check("bulk: progress updated", (await page.textContent("#progress-all-text")) === "29 of 220");
    check("bulk: offers Undo", (await page.textContent("#toast")).includes("Marked 29 episodes") && await page.isVisible(".toast-action"));
    await page.click(".toast-action");
    check("bulk: Undo restores", (await page.locator(".episode input:checked").count()) === 0);
    await bulkOpen();
    await page.fill("#bulk-from", "40");
    await page.fill("#bulk-to", "35"); // reversed range is fine
    await page.click("#bulk-watch");
    w = await page.$$eval(".episode input:checked", (els) => els.map((e) => Number(e.dataset.number)));
    check("bulk: reversed range 40→35 marks 35–40", JSON.stringify(w) === "[35,36,37,38,39,40]", w.join(","));
    await bulkOpen();
    await page.fill("#bulk-from", "38");
    await page.fill("#bulk-to", "40");
    await page.click("#bulk-unwatch");
    w = await page.$$eval(".episode input:checked", (els) => els.map((e) => Number(e.dataset.number)));
    check("bulk: Mark as Unwatched clears 38–40", JSON.stringify(w) === "[35,36,37]", w.join(","));
    await page.reload();
    check("bulk: changes are saved", (await page.locator(".episode input:checked").count()) === 3);
    await bulkOpen();
    await page.fill("#bulk-to", "999");
    check("bulk: out-of-range number is rejected", await page.isDisabled("#bulk-watch") && (await page.textContent("#bulk-summary")).includes("from 1 to 220"));
    await page.keyboard.press("Escape");
    check("bulk: Escape closes", !(await page.evaluate(() => document.getElementById("bulk-sheet").open)));
    await bulkOpen();
    await page.fill("#bulk-from", "35");
    await page.fill("#bulk-to", "37");
    await page.click("#bulk-unwatch");

    // Light and dark mode follow the device
    const bgOf = async (scheme) => { await page.emulateMedia({ colorScheme: scheme }); return page.evaluate(() => getComputedStyle(document.body).backgroundColor); };
    check("theme: light mode", (await bgOf("light")) === "rgb(242, 242, 247)", await bgOf("light"));
    check("theme: dark mode", (await bgOf("dark")) === "rgb(0, 0, 0)", await bgOf("dark"));
    await page.emulateMedia({ colorScheme: "light" });
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

    // Always up to date: a deployed change shows on the next open, with no version bump
    const marker = "UPDATE-MARKER-" + Date.now();
    const htmlPath = path.join(site, "index.html");
    const originalHtml = fs.readFileSync(htmlPath, "utf8");
    // python's http.server only has 1-second Last-Modified precision: give each edit a distinct time
    const touch = (file, ahead) => { const t = Date.now() / 1000 + ahead; fs.utimesSync(file, t, t); };
    fs.writeFileSync(htmlPath, originalHtml.replace('<h1 class="title">Naruto Filler Guide</h1>', '<h1 class="title">' + marker + '</h1>'));
    touch(htmlPath, 10);
    await page.goto(BASE);
    check("update: next open shows the newest files", (await page.textContent(".title")).includes(marker));
    check("update: watched state kept", await page.locator("#ep-10 input").isChecked());
    await context.setOffline(true);
    await page.reload();
    check("update: offline open uses the newest saved copy", (await page.textContent(".title")).includes(marker));
    await context.setOffline(false);

    // Returning to the app: the service worker reports whether anything changed
    const askSw = () => page.evaluate(() => new Promise((resolve) => {
      const ch = new MessageChannel();
      ch.port1.onmessage = (e) => resolve(e.data && e.data.changed);
      navigator.serviceWorker.controller.postMessage({ type: "CHECK_UPDATES" }, [ch.port2]);
    }));
    check("update check: nothing changed -> false", (await askSw()) === false);
    fs.writeFileSync(htmlPath, originalHtml);
    touch(htmlPath, 20);
    check("update check: file changed on the server -> true", (await askSw()) === true);
    check("update check: after saving, no change -> false", (await askSw()) === false);

    // A new service worker takes over by itself (no "update available" step)
    const swPath = path.join(site, "service-worker.js");
    fs.writeFileSync(swPath, fs.readFileSync(swPath, "utf8").replace(`"${SW_VERSION}"`, '"v-update-test"'));
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const keysAfter = await waitFor(async () => {
      const k = await page.evaluate(() => caches.keys());
      return k.length === 1 && k[0] === "naruto-filler-v-update-test" ? k : null;
    }, 10000);
    check("update: new service worker activates by itself, old cache deleted", !!keysAfter, JSON.stringify(await page.evaluate(() => caches.keys())));

    check("http: no JS/console errors", errors.length === 0, errors.join(" | "));
    // ================= Install instructions =================
    // A second copy with a (demo) Firebase config, so invite links are active. Nothing connects.
    const site2 = path.join(tmp, "naruto-filler-cfg");
    fs.mkdirSync(site2);
    for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(site2, f), { recursive: true });
    fs.writeFileSync(path.join(site2, "firebase-config.js"), 'const FIREBASE_CONFIG = { apiKey: "demo", projectId: "demo-naruto-filler", appId: "demo" };\n');
    const BASE2 = `http://localhost:${PORT}/naruto-filler-cfg/`;
    const CODE = "KFMQK7JPAQ9NCBG8";
    const { devices } = require("playwright");
    for (const [name, dev] of [["iPhone", devices["iPhone 13"]], ["Android", devices["Pixel 7"]]]) {
      const ctx = await browser.newContext({ ...dev, serviceWorkers: "block" });
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(BASE2 + "#join=" + CODE);
      await p.waitForTimeout(500);
      check(`install (${name}): invite link opens the instructions`, await p.evaluate(() => document.getElementById("install-sheet").open));
      check(`install (${name}): shows the code`, (await p.textContent("#install-code")) === "KFMQ-K7JP-AQ9N-CBG8");
      const steps = await p.$$eval("#install-steps li", (els) => els.map((e) => e.textContent));
      if (name === "iPhone") {
        check("install (iPhone): Share → Add to Home Screen → Add → join with code", steps.length === 4 && /Share/.test(steps[0]) && /Add to Home Screen/.test(steps[1]) && /Join with a Code/.test(steps[3]), steps.join(" / "));
        check("install (iPhone): explains why to copy the code", await p.isVisible("#install-note"));
      } else {
        check("install (Android): join step, then browser-menu install", /Join the shared list/.test(steps[0]) && /Install app|Add to Home screen/.test(steps[1]), steps.join(" / "));
        check("install (Android): has a Join button", await p.isVisible("#install-steps button"));
      }
      await p.click("#install-later");
      check(`install (${name}): "Maybe later" closes it`, !(await p.evaluate(() => document.getElementById("install-sheet").open)));
      check(`install (${name}): invite banner waits on the main screen`, await p.isVisible("#invite-banner"));
      await p.click("#invite-banner");
      check(`install (${name}): banner opens the invite`, await p.evaluate(() => document.getElementById("sync-sheet").open) && await p.isVisible("#sync-invite-prompt"));
      await p.keyboard.press("Escape");
      await p.click("#menu-open");
      check(`install (${name}): Get the App is in the menu`, await p.isVisible("#menu-get-app"));
      await p.click("#menu-get-app");
      check(`install (${name}): Get app reopens the instructions`, await p.evaluate(() => document.getElementById("install-sheet").open));
      await p.keyboard.press("Escape");
      check(`install (${name}): Escape closes it`, !(await p.evaluate(() => document.getElementById("install-sheet").open)));
      check(`install (${name}): no horizontal scroll`, await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      check(`install (${name}): no JS errors`, errs.length === 0, errs.join(" | "));
      await ctx.close();
    }
    {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, serviceWorkers: "block" });
      const p = await ctx.newPage();
      await p.goto(BASE2 + "#join=" + CODE);
      await p.waitForTimeout(500);
      check("install (desktop): invite link doesn't pop up instructions", !(await p.evaluate(() => document.getElementById("install-sheet").open)));
      check("install (desktop): invite opens Watch Together instead", await p.evaluate(() => document.getElementById("sync-sheet").open) && await p.isVisible("#sync-invite-prompt"));
      check("install (desktop): menu shows 'Invited'", (await p.textContent("#menu-sync-status")) === "Invited");
      await ctx.close();
    }

    console.log("\nScreenshots in", tmp);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll checks passed.");
  process.exit(failures ? 1 : 0);
})();
