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
// Most checks start past the first-launch "what's your name?" screen
const noSplash = () => { window.NF_NO_SPLASH = true; }; // the startup animation is tested on its own
const presetProfile = () => {
  window.NF_NO_SPLASH = true;
  window.NF_NO_CELEBRATION = true; // the arc-complete screen is tested on its own
  try {
    const key = "naruto-filler:profile:v1";
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ id: "testtesttest", name: "Tester", asked: true }));
  } catch (e) { /* file:// may not allow it before load */ }
};
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
      // No init script here: one that touches localStorage at document start can make headless
      // Chromium hand a reloaded file:// page an empty storage area. Use the welcome screen instead.
      const page = await browser.newPage();
      await page.addInitScript(noSplash);
      const errors = [];
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
      await page.goto("file://" + path.join(ROOT, "index.html"));
      check("file://: 220 episodes rendered", (await page.locator(".episode").count()) === 220);
      check("file://: first launch asks for a name", await page.evaluate(() => document.getElementById("welcome-sheet").open));
      await page.fill("#welcome-name", "Tester");
      await page.click("#welcome-save");
      check("file://: no JS errors", errors.length === 0, errors.join(" | "));
      check("file://: no service worker registered", await page.evaluate(async () => {
        if (!navigator.serviceWorker) return true;
        try { return (await navigator.serviceWorker.getRegistrations()).length === 0; } catch (e) { return true; } // not allowed on file://
      }));
      check("file://: offline/install note in the menu", await page.$eval("#file-note", (e) => !e.hidden));
      check("file://: sharing explains it needs the hosted site", (await page.textContent("#sync-unavailable-text")).includes("hosted site"));
      await page.locator(`.episode >> nth=4 >> input`).check();
      await page.reload();
      check("file://: name isn't asked again", !(await page.evaluate(() => document.getElementById("welcome-sheet").open)));
      check("file://: watched state persists", await page.locator(`#ep-5 input`).isChecked());
      await page.close();
    }

    // ================= http (features) =================
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript(presetProfile);
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    let navigations = 0;
    page.on("framenavigated", (f) => { if (f === page.mainFrame()) navigations++; });
    await page.goto(BASE);
    await page.waitForSelector("#ep-220", { state: "attached" });
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
    const expandAllArcs = () => page.evaluate(() => document.querySelectorAll('.arc-head[aria-expanded="false"]').forEach((b) => b.click()));
    const resetArcChoices = async () => {
      await page.evaluate(() => {
        const key = "naruto-filler:prefs:v1";
        const p = JSON.parse(localStorage.getItem(key) || "{}");
        p.arcOpen = {};
        localStorage.setItem(key, JSON.stringify(p));
      });
      await page.reload();
    };

    check("http: 220 episodes rendered", (await page.locator(".episode").count()) === 220);
    check("http: main screen is progress, up-next card, search/switcher and list", (await page.locator("main > :not([hidden]):not(.empty-state)").count()) === 4);
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
    await page.fill("#search", "KAKASHI"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    v = await visibleNums();
    const expectKakashiFiller = E.filter((e) => e.type === "filler" && e.title.toLowerCase().includes("kakashi")).map((e) => e.number);
    check("search+filter: 'KAKASHI' within filler (case-insensitive)", JSON.stringify(v) === JSON.stringify(expectKakashiFiller), v.join(","));
    await show("all");
    await page.fill("#search", "kakashi"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    v = await visibleNums();
    const expectKakashi = E.filter((e) => e.title.toLowerCase().includes("kakashi")).map((e) => e.number);
    check("search: 'kakashi' all types", JSON.stringify(v) === JSON.stringify(expectKakashi), v.length);
    await page.fill("#search", "135"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    check("search: number '135'", JSON.stringify(await visibleNums()) === "[135]");
    await page.fill("#search", "#7"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    check("search: '#7'", JSON.stringify(await visibleNums()) === "[7]");
    await page.fill("#search", ""); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    check("search cleared: all 220 shown", (await visibleNums()).length === 220);
    await page.fill("#search", "zzzz"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    check("search: no match shows empty state", (await visibleNums()).length === 0 && (await page.locator("#empty-state").isVisible()));
    await page.fill("#search", ""); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame

    await expandAllArcs(); // so every episode row can be tapped
    // Tapping the episode's title (or number) ticks it too
    await page.click("#ep-50 .ep-title");
    check("row: tapping the title ticks the episode", await page.isChecked("#ep-50 input"));
    await page.click("#ep-50 .ep-number");
    check("row: tapping the number unticks it", !(await page.isChecked("#ep-50 input")));
    await page.click("#ep-26 .badge");
    check("row: tapping the Filler tag ticks it", await page.isChecked("#ep-26 input"));
    await page.click("#ep-26 .ep-title");
    check("row: progress follows row taps", (await page.textContent("#progress-all-text")) === "0 of 220 total");

    // Watch tracker
    for (const n of [1, 2, 3, 26]) await page.check(`#ep-${n} input`);
    check("tracker: headline is canon, 3 of 130", (await page.textContent("#tracker-title")) === "3 of 130 canon watched");
    check("tracker: all episodes 4 of 220 underneath", (await page.textContent("#progress-all-text")) === "4 of 220 total");
    check("version: 0.1 shown at the bottom", (await page.textContent(".app-version")) === "Version 0.1");
    check("tracker: bar tracks canon", (await page.getAttribute("#progress-canon-bar", "aria-valuenow")) === "3" && (await page.getAttribute("#progress-canon-bar", "aria-valuemax")) === "130");
    // Up-next card (skips filler by default)
    check("deck: shows episode 4 next", (await page.textContent("#deck-num")) === "Episode 4");
    check("deck: shows its arc and title", (await page.textContent("#deck-arc")) === "Land of Waves" && (await page.textContent("#deck-title")) === E[3].title);
    check("deck: canon card is green", (await page.getAttribute("#deck-card", "data-kind")) === "canon" && (await page.textContent("#deck-kind")) === "Canon");
    for (let n = 4; n <= 25; n++) await page.check(`#ep-${n} input`);
    await page.uncheck("#ep-26 input");
    check("deck: skip filler -> ep 27 (skips 26)", (await page.textContent("#deck-num")) === "Episode 27");
    check("deck: the cards behind are shown", (await page.getAttribute("#deck-layer-1", "data-kind")) === "canon");
    await menuSwitch("skip-filler-next");
    check("deck: no skip -> ep 26", (await page.textContent("#deck-num")) === "Episode 26");
    check("deck: filler card is red", (await page.getAttribute("#deck-card", "data-kind")) === "filler" && (await page.textContent("#deck-kind")) === "Filler");
    // Skip -> 26 is marked skipped (not watched), next card comes up
    await page.click("#deck-skip");
    await waitFor(async () => (await page.textContent("#deck-num")) === "Episode 27", 3000);
    check("deck: Skip moves to the next card", (await page.textContent("#deck-num")) === "Episode 27");
    check("deck: skipped episode is marked in the list, not watched", (await page.locator("#ep-26.is-skipped").count()) === 1 && !(await page.isChecked("#ep-26 input")));
    check("deck: skipped count shown", (await page.textContent("#progress-all-text")).includes("1 skipped"));
    await page.click(".toast-action");
    check("deck: Undo brings the skipped card back", (await page.textContent("#deck-num")) === "Episode 26" && (await page.locator("#ep-26.is-skipped").count()) === 0);
    // Watched -> ticked in the list, progress moves
    await page.click("#deck-watch");
    await waitFor(async () => (await page.textContent("#deck-num")) === "Episode 27", 3000);
    check("deck: Watched ticks the episode", await page.isChecked("#ep-26 input") && (await page.textContent("#progress-all-text")) === "26 of 220 total");
    await page.click(".toast-action");
    check("deck: Undo unticks it", !(await page.isChecked("#ep-26 input")));
    // skip then tap the row: becomes watched, no longer skipped
    await page.click("#deck-skip");
    await waitFor(async () => (await page.locator("#ep-26.is-skipped").count()) === 1, 3000);
    await page.click("#ep-26 .ep-title");
    check("row: tapping a skipped episode marks it watched", await page.isChecked("#ep-26 input") && (await page.locator("#ep-26.is-skipped").count()) === 0);
    await page.uncheck("#ep-26 input");
    await menuSwitch("skip-filler-next");

    // Arcs (back to the automatic open/fold behavior)
    await resetArcChoices();
    check("arcs: 32 sections in story order", (await page.locator(".arc").count()) === 32);
    check("arcs: first is Land of Waves (1–19, canon)", (await page.textContent("#arc-0 .arc-name")) === "Land of Waves" && (await page.textContent("#arc-0 .arc-meta")) === "Episodes 1–19 · Canon");
    check("arcs: an untouched filler arc says Skip (not Done) while skipping filler", (await page.$$eval(".arc", (els) => els.filter((e) => e.querySelector(".arc-name").textContent === "Land of Tea Escort Mission").map((e) => e.querySelector(".arc-progress").textContent + (e.classList.contains("is-done") ? "!" : "")).join(""))) === "Skip");
    check("arcs: Land of Tea is a filler arc", (await page.$$eval(".arc", (els) => els.filter((e) => e.querySelector(".arc-name").textContent === "Land of Tea Escort Mission" && e.dataset.kind === "filler").length)) === 1);
    check("arcs: finished arc shows Done and is folded", (await page.textContent("#arc-0 .arc-progress")) === "Done" && !(await page.isVisible("#ep-1")));
    check("arcs: the current arc is open", await page.isVisible("#ep-27") && (await page.getAttribute("#arc-1 .arc-head", "aria-expanded")) === "true");
    check("arcs: progress per arc", (await page.textContent("#arc-1 .arc-progress")) === "6/48", await page.textContent("#arc-1 .arc-progress"));
    await page.click("#arc-0 .arc-head");
    check("arcs: tapping a header opens it", await page.isVisible("#ep-1"));
    await page.reload();
    check("arcs: your choice is remembered", await page.isVisible("#ep-1"));
    await page.click("#arc-0 .arc-head");
    check("arcs: tapping again folds it", (await waitFor(async () => !(await page.isVisible("#ep-1")), 3000)) === true);
    await page.fill("#search", "special report"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    check("arcs: a search opens matching sections", await page.isVisible("#ep-26") && (await page.locator(".arc:not([hidden])").count()) === 1);
    await page.fill("#search", ""); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    await show("filler");
    check("arcs: Filler hides canon-only arcs", !(await page.isVisible("#arc-0")) && await page.isVisible("#arc-1"));
    await show("all");
    await expandAllArcs();
    // jump while filter hides target
    await show("filler");
    await page.fill("#search", "zzz"); await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r()))); // search redraws on the next frame
    await page.click("#deck-find");
    await page.waitForTimeout(700);
    check("deck: tapping the card reveals ep 27 in the list", await page.locator("#ep-27").isVisible());
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
    check("persistence: progress after reload", (await page.textContent("#progress-all-text")) === "25 of 220 total");

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
    check("bulk: progress updated", (await page.textContent("#progress-all-text")) === "29 of 220 total");
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
    // Episode details, ratings, favorites
    await expandAllArcs();
    await page.click("#ep-1 .ep-info");
    check("details: ⓘ opens episode 1", await isOpen("ep-sheet") && (await page.textContent("#ep-sheet-title")) === "Episode 1");
    check("details: arc and manga chapter", (await page.textContent("#ep-sheet-arc")) === "Land of Waves" && (await page.textContent("#ep-sheet-chapters")) === "Chapter 1");
    check("details: tapping ⓘ doesn't tick the row", !(await page.isChecked("#ep-1 input")));
    await page.click('#ep-sheet-stars .star[data-v="4"]');
    check("rating: row shows 4 stars", (await page.textContent("#ep-1 .ep-meta")).includes("4"));
    check("rating: arc shows your average", (await page.textContent("#arc-0 .arc-meta")).includes("★ 4.0"), await page.textContent("#arc-0 .arc-meta"));
    await page.click('#ep-sheet-stars .star[data-v="4"]');
    check("rating: tapping the same star clears it", (await page.textContent("#ep-1 .ep-meta")) === "");
    await page.click('#ep-sheet-stars .star[data-v="3"]');
    await page.click("#ep-sheet-fav");
    check("favorite: heart on the row", (await page.locator("#ep-1 .meta-fav").count()) === 1 && (await page.getAttribute("#ep-sheet-fav", "aria-pressed")) === "true");
    await page.click('#ep-sheet-state [data-state="skipped"]');
    check("details: status → Skipped", (await page.locator("#ep-1.is-skipped").count()) === 1);
    await page.click('#ep-sheet-state [data-state="watched"]');
    check("details: status → Watched, with the date", await page.isChecked("#ep-1 input") && await page.isVisible("#ep-sheet-date-row"));
    await page.click('#ep-sheet-state [data-state="none"]');
    await page.keyboard.press("Escape");
    await page.click("#ep-26 .ep-info");
    check("details: filler episode says anime-only", (await page.textContent("#ep-sheet-chapters")) === "None (anime-only)" && (await page.textContent("#ep-sheet-kind")) === "Filler");
    await page.click('#ep-sheet-stars .star[data-v="5"]');
    await page.keyboard.press("Escape");
    await openMenu();
    await page.click("#menu-top");
    const top = await page.$$eval("#top-rated .top-item .ep-number", (els) => els.map((e) => e.textContent));
    check("top rated: highest first", JSON.stringify(top) === '["26","1"]', top.join(","));
    check("favorites: listed", (await page.$$eval("#fav-list .top-item .ep-number", (els) => els.map((e) => e.textContent))).join(",") === "1");
    await page.click("#top-rated .top-item");
    check("top rated: tapping opens details", await isOpen("ep-sheet") && (await page.textContent("#ep-sheet-title")) === "Episode 26");
    await page.keyboard.press("Escape");
    await page.reload();
    check("rating + favorite: saved", (await page.textContent("#ep-26 .ep-meta")).includes("5") && (await page.locator("#ep-1 .meta-fav").count()) === 1);

    // "Rate Ep N" after Watched on the card
    const deckN = Number((await page.textContent("#deck-num")).replace(/\D/g, ""));
    await page.click("#deck-watch");
    await waitFor(() => page.isVisible("#rate-prompt"), 3000);
    check("rate prompt: appears after Watched", (await page.textContent("#rate-text")) === "Rate Ep " + deckN);
    await page.click('#rate-stars .star[data-v="5"]');
    check("rate prompt: rating saved", (await page.textContent(`#ep-${deckN} .ep-meta`)).includes("5"));
    await page.waitForTimeout(1800);
    check("rate prompt: goes away after rating", !(await page.isVisible("#rate-prompt")));
    // Pace: several episodes marked one at a time → finish estimate
    check("time left: shown under the progress", (await page.textContent("#pace-text")).includes("of canon left"), await page.textContent("#pace-text"));
    check("pace: no estimate from a single episode", !(await page.textContent("#pace-text")).includes("a day"));
    for (let i = 0; i < 2; i++) { // wait for each card to fly off and the next to come up
      const was = await page.textContent("#deck-num");
      await page.click("#deck-watch");
      await waitFor(async () => (await page.textContent("#deck-num")) !== was, 3000);
    }
    check("pace: finish estimate shown", (await page.isVisible("#pace-text")) && (await page.textContent("#pace-text")).includes("a day"), await page.textContent("#pace-text"));

    // Share this app: copies the app's address (no share sheet in desktop Chromium)
    await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(BASE).origin });
    await openMenu();
    check("share app: in the menu", await page.isVisible("#menu-share-app"));
    await page.click("#menu-share-app");
    await waitFor(async () => (await page.textContent("#toast")).includes("Link copied"), 3000);
    check("share app: copies the app's link", (await page.evaluate(() => navigator.clipboard.readText())) === BASE && (await page.textContent("#toast")).includes(BASE), await page.textContent("#toast"));
    await closeSheets();

    // Animations
    check("animations: page marked ready for entrance animations", await page.evaluate(() => document.documentElement.classList.contains("ready")));
    await show("filler");
    check("animations: the selector's thumb slides to the choice", (await page.evaluate(() => getComputedStyle(document.getElementById("filters")).getPropertyValue("--i").trim())) === "2");
    await show("all");
    await page.evaluate(() => window.scrollTo(0, 0));
    const beforeFly = await page.textContent("#deck-num");
    await page.click("#deck-watch");
    check("animations: Watched stamps the card before it flies", (await page.locator("#deck-card.fly-right .stamp-watched").count()) === 1 && (await page.textContent("#deck-num")) === beforeFly);
    await waitFor(async () => (await page.textContent("#deck-num")) !== beforeFly, 3000);
    check("animations: the next card comes up", (await page.textContent("#deck-num")) !== beforeFly && (await page.locator("#deck-card.fly-right").count()) === 0);
    await page.click(".toast-action"); // undo
    await page.click('#rate-close').catch(() => {});
    await page.emulateMedia({ reducedMotion: "reduce" });
    const beforeReduced = await page.textContent("#deck-num");
    await page.click("#deck-watch");
    check("animations: with Reduce Motion the card changes at once", (await waitFor(async () => (await page.textContent("#deck-num")) !== beforeReduced, 350)) === true); // well under the 460 ms animation
    check("animations: with Reduce Motion nothing animates", (await page.$eval("#deck-card", (el) => getComputedStyle(el).transitionDuration)) === "0s" || (await page.$eval("#deck-card", (el) => getComputedStyle(el).transitionProperty)) === "none");
    await page.click(".toast-action");
    await page.emulateMedia({ reducedMotion: "no-preference" });

    // Spoiler shield
    await menuSwitch("spoiler-shield");
    const blurOf = (sel) => page.$eval(sel, (el) => getComputedStyle(el).filter);
    const firstUnwatched = await page.evaluate(() => Number(document.querySelector(".episode:not(.is-watched)").id.slice(3)));
    check("shield: unwatched titles are blurred", (await blurOf(`#ep-${firstUnwatched} .ep-title`)).includes("blur"));
    const someWatched = await page.evaluate(() => Number(document.querySelector(".episode.is-watched").id.slice(3)));
    check("shield: watched titles stay readable", (await blurOf(`#ep-${someWatched} .ep-title`)) === "none");
    check("shield: the up-next title is hidden", (await page.locator("#deck-card.is-hidden-title").count()) === 1 && (await page.textContent("#deck-label")).includes("tap to reveal"));
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.click("#deck-find");
    check("shield: first tap on the card reveals its title", (await page.locator("#deck-card.is-hidden-title").count()) === 0);
    await page.click(`#ep-${firstUnwatched} .ep-info`);
    check("shield: details hide the title with a Show title button", (await page.locator("#ep-sheet-name.is-hidden-title").count()) === 1 && await page.isVisible("#ep-sheet-reveal"));
    await page.click("#ep-sheet-reveal");
    check("shield: Show title reveals it", (await page.locator("#ep-sheet-name.is-hidden-title").count()) === 0);
    await page.keyboard.press("Escape");
    await menuSwitch("spoiler-shield");
    check("shield: off again shows everything", (await blurOf(`#ep-${firstUnwatched} .ep-title`)) === "none");
    // Arc names: blurred until you've watched or skipped something in the arc
    await menuSwitch("spoiler-shield");
    const arcBlur = (sel) => page.$eval(sel, (el) => getComputedStyle(el).filter);
    const startedArc = await page.evaluate(() => [...document.querySelectorAll(".arc:not(.unstarted)")][0].id);
    const unstartedArc = await page.evaluate(() => [...document.querySelectorAll(".arc.unstarted")].pop().id);
    check("shield: names of arcs you haven't started are blurred", (await arcBlur(`#${unstartedArc} .arc-name`)).includes("blur"));
    check("shield: names of arcs you've started stay readable", (await arcBlur(`#${startedArc} .arc-name`)) === "none");
    const lastEp = await page.evaluate((id) => Number([...document.querySelectorAll(`#${id} .episode`)].pop().id.slice(3)), unstartedArc);
    await page.click(`#${unstartedArc} .arc-head`);
    await page.click(`#ep-${lastEp} .ep-info`);
    check("shield: details blur the arc of an unstarted arc", (await arcBlur("#ep-sheet-arc")).includes("blur"));
    await page.click("#ep-sheet-reveal");
    check("shield: Show title reveals the arc too", (await arcBlur("#ep-sheet-arc")) === "none");
    await page.click('#ep-sheet-state [data-state="watched"]');
    await closeSheets();
    check("shield: watching an episode reveals that arc's name", (await arcBlur(`#${unstartedArc} .arc-name`)) === "none");
    // put it back (a finished arc folds away, so untick it directly)
    await page.evaluate((n) => { const i = document.querySelector(`#ep-${n} input`); i.click(); }, lastEp);
    check("shield: unwatching it blurs that arc's name again", (await arcBlur(`#${unstartedArc} .arc-name`)).includes("blur"));
    await resetArcChoices();
    await menuSwitch("spoiler-shield");

    // Naruto Wrapped
    await openMenu();
    await page.click("#menu-wrapped");
    const watchedCount = await page.locator(".episode input:checked").count();
    check("wrapped: opens with your stats", await isOpen("wrapped-sheet") && (await page.textContent("#wrapped-count")) === String(watchedCount) && (await page.textContent("#wrapped-who")) === "Tester's Naruto");
    check("wrapped: lists your top episode and favorite arc", (await page.textContent("#wrapped-details")).includes("Ep 26") && (await page.textContent("#wrapped-details")).includes("Favorite arc"));
    await page.keyboard.press("Escape");

    // Notes & reactions
    await page.evaluate(() => document.querySelector("#ep-26 .ep-info").click());
    await waitFor(() => isOpen("ep-sheet"), 2000);
    check("notes: details show six reactions and a note field", (await page.locator("#ep-sheet-reactions .reaction").count()) === 6 && await page.isVisible("#ep-sheet-note"));
    await page.click('#ep-sheet-reactions [data-e="😭"]');
    check("notes: tapping a reaction selects it", (await page.getAttribute('#ep-sheet-reactions [data-e="😭"]', "aria-pressed")) === "true");
    await page.click('#ep-sheet-reactions [data-e="🔥"]');
    check("notes: only one reaction at a time", (await page.locator('#ep-sheet-reactions [aria-pressed="true"]').count()) === 1 && (await page.getAttribute('#ep-sheet-reactions [data-e="🔥"]', "aria-pressed")) === "true");
    await page.click('#ep-sheet-reactions [data-e="🔥"]');
    check("notes: tapping it again clears it", (await page.locator('#ep-sheet-reactions [aria-pressed="true"]').count()) === 0);
    await page.click('#ep-sheet-reactions [data-e="😭"]');
    await page.fill("#ep-sheet-note", "Haku's story got me");
    await closeSheets();
    check("notes: the row shows the reaction and a note icon", (await page.textContent("#ep-26 .ep-meta")).includes("😭") && (await page.locator("#ep-26 .meta-note").count()) === 1);
    check("notes: saved on the device", await page.evaluate(() => JSON.parse(localStorage.getItem("naruto-filler:notes:v1"))["26"].x === "Haku's story got me"));
    await page.reload();
    await page.evaluate(() => document.querySelector("#ep-26 .ep-info").click());
    await waitFor(() => isOpen("ep-sheet"), 2000);
    check("notes: still there after a reload", (await page.inputValue("#ep-sheet-note")) === "Haku's story got me" && (await page.getAttribute('#ep-sheet-reactions [data-e="😭"]', "aria-pressed")) === "true");
    await closeSheets();
    await openMenu();
    await page.click("#menu-top");
    check("notes: listed under Notes & Reactions", (await page.locator("#note-list .top-item").count()) === 1 && (await page.textContent("#note-list")).includes("😭"));
    await closeSheets();
    await openMenu();
    await page.click("#menu-wrapped");
    check("notes: Wrapped shows your go-to reaction", (await page.textContent("#wrapped-details")).includes("Go-to reaction") && (await page.textContent("#wrapped-details")).includes("😭"));
    await closeSheets();

    // Backup: save, clear, restore
    await openMenu();
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#menu-export")]);
    const backupPath = path.join(tmp, "backup.json");
    await download.saveAs(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, "utf8"));
    check("backup: file has watched episodes, ratings and favorites", backup.app === "naruto-filler-guide" && backup.watched.length === watchedCount && backup.ratings["26"] === 5 && backup.favorites.includes(1), download.suggestedFilename());
    check("backup: file has your notes", backup.notes && backup.notes["26"] && backup.notes["26"].e === "😭");
    await openMenu();
    await page.click("#reset-button");
    await page.click("#reset-yes");
    check("backup: (progress cleared for the test)", (await page.locator(".episode input:checked").count()) === 0);
    await openMenu();
    await page.setInputFiles("#restore-file", backupPath);
    await waitFor(() => isOpen("restore-sheet"), 3000);
    check("backup: restore asks first, with a summary", (await page.textContent("#restore-text")).includes(`${watchedCount} watched`), await page.textContent("#restore-text"));
    await page.click("#restore-yes");
    check("backup: restored", (await page.locator(".episode input:checked").count()) === watchedCount && (await page.textContent("#ep-26 .ep-meta")).includes("5"));
    check("backup: notes restored", (await page.textContent("#ep-26 .ep-meta")).includes("😭"));
    fs.writeFileSync(path.join(tmp, "not-a-backup.json"), "{\"hello\": 1}");
    await openMenu();
    await page.setInputFiles("#restore-file", path.join(tmp, "not-a-backup.json"));
    await page.waitForTimeout(300);
    check("backup: other files are refused", !(await isOpen("restore-sheet")) && (await page.textContent("#toast")).includes("isn't a Naruto Filler Guide backup"));
    await closeSheets();

    check("mobile: no horizontal scroll", await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // Finishing an arc celebrates (fresh browser, celebrations on)
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      await ctx.addInitScript(noSplash);
      await ctx.addInitScript(() => localStorage.setItem("naruto-filler:profile:v1", JSON.stringify({ id: "partypartypa", name: "P", asked: true })));
      const p = await ctx.newPage();
      await p.goto(BASE);
      await p.click("#menu-open");
      await p.click("#menu-bulk");
      await p.fill("#bulk-to", "18");
      await p.click("#bulk-watch");
      check("celebrate: Mark Several doesn't celebrate", !(await p.evaluate(() => document.getElementById("celebrate-sheet").open)));
      await p.check("#ep-19 input");
      check("celebrate: finishing Land of Waves celebrates", await p.evaluate(() => document.getElementById("celebrate-sheet").open) && (await p.textContent("#celebrate-title")) === "Land of Waves complete!");
      check("celebrate: says what's next", (await p.textContent("#celebrate-text")).includes("Next up: Chūnin Exams"), await p.textContent("#celebrate-text"));
      await p.click("#celebrate-ok");
      check("celebrate: Nice! closes it", !(await p.evaluate(() => document.getElementById("celebrate-sheet").open)));
      await ctx.close();
    }

    // Watch calendar & streaks (fresh browser with a made-up history)
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      await ctx.addInitScript(presetProfile);
      await ctx.addInitScript(() => {
        if (localStorage.getItem("naruto-filler:watched:v1")) return;
        const noon = (daysAgo) => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate() - daysAgo, 12).getTime(); };
        const watched = [], changed = {};
        const mark = (n, t) => { watched.push(n); changed[n] = t; };
        mark(1, Date.now() - 60000); mark(2, Date.now() - 30000);   // today: 2
        mark(3, noon(1));                                          // yesterday: 1 ...
        for (let n = 40; n < 50; n++) mark(n, noon(1) + 5);         // ... plus 10 from Mark Several (don't count)
        mark(4, noon(2)); mark(5, noon(2) + 1000); mark(6, noon(2) + 2000); // 2 days ago: 3
        mark(7, noon(5)); mark(8, noon(6));                         // an older 2-day run
        localStorage.setItem("naruto-filler:watched:v1", JSON.stringify(watched));
        localStorage.setItem("naruto-filler:changed:v1", JSON.stringify(changed));
      });
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(BASE);
      check("streak: chip shows a 3-day streak", await p.isVisible("#streak-chip") && (await p.textContent("#streak-count")) === "3");
      check("streak: watched today, so it isn't at risk", !(await p.getAttribute("#streak-chip", "class")).includes("at-risk"));
      await p.click("#streak-chip");
      check("calendar: the chip opens it", await p.evaluate(() => document.getElementById("calendar-sheet").open));
      check("calendar: current 3, longest 3, 5 days watched", (await p.textContent("#cal-current")) === "3" && (await p.textContent("#cal-longest")) === "3" && (await p.textContent("#cal-days")) === "5",
        [await p.textContent("#cal-current"), await p.textContent("#cal-longest"), await p.textContent("#cal-days")].join("/"));
      check("calendar: 18 weeks of days", (await p.locator("#cal-grid .cal-cell").count()) === 18 * 7);
      check("calendar: today is shaded and selected, with its episodes listed", (await p.getAttribute("#cal-grid .cal-cell.today", "data-level")) === "2" &&
        (await p.getAttribute("#cal-grid .cal-cell.today", "aria-pressed")) === "true" && (await p.textContent("#cal-day-title")) === "Today" && (await p.locator("#cal-day-list .top-item").count()) === 2);
      const yesterday = await p.evaluate(() => { const d = new Date(); d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
      await p.click(`#cal-grid [data-day="${yesterday}"]`);
      check("calendar: tapping a day lists it (Mark Several left out)", (await p.textContent("#cal-day-title")) === "Yesterday" && (await p.locator("#cal-day-list .top-item").count()) === 1);
      const empty = await p.evaluate(() => document.querySelector('#cal-grid .cal-cell[data-level="0"]').dataset.day);
      await p.click(`#cal-grid [data-day="${empty}"]`);
      check("calendar: an empty day says so", (await p.isHidden("#cal-day-list")) && (await p.textContent("#cal-day-empty")).includes("Nothing watched"));
      check("calendar: fits the phone screen", await p.evaluate(() => { const g = document.getElementById("cal-grid"); return g.scrollWidth <= g.clientWidth + 1; }));
      await p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
      await p.click("#menu-open");
      check("calendar: menu shows the streak", (await p.textContent("#menu-streak")) === "🔥 3");
      await p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
      await p.uncheck("#ep-1 input");
      await p.uncheck("#ep-2 input");
      check("streak: nothing today keeps it, marked at risk", (await p.textContent("#streak-count")) === "2" && (await p.getAttribute("#streak-chip", "class")).includes("at-risk"));
      await p.check("#ep-1 input");
      check("streak: watching today brings it back", (await waitFor(async () => (await p.textContent("#streak-count")) === "3", 2000)) === true && !(await p.getAttribute("#streak-chip", "class")).includes("at-risk"));
      await p.click("#menu-open");
      await p.click("#menu-wrapped");
      check("calendar: Wrapped shows your longest streak and biggest binge", (await p.textContent("#wrapped-details")).includes("Longest streak") && (await p.textContent("#wrapped-details")).includes("3 episodes"));
      check("calendar: no JS errors", errs.length === 0, errs.join(" | "));
      await ctx.close();
    }

    // Startup animation (fresh browser each time, nothing switched off)
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(BASE);
      check("splash: plays on launch", await p.isVisible("#splash") && (await p.locator("#splash .sharingan-tomoe > g").count()) === 3);
      check("splash: the welcome screen waits for it", !(await p.evaluate(() => document.getElementById("welcome-sheet").open)));
      check("splash: gone within about 2 seconds, then the welcome screen", (await waitFor(async () => (await p.locator("#splash").count()) === 0, 4000)) === true && await p.evaluate(() => document.getElementById("welcome-sheet").open));
      check("splash: app is ready afterwards", await p.evaluate(() => document.documentElement.classList.contains("ready")));
      await p.fill("#welcome-name", "S");
      await p.click("#welcome-save");
      await p.reload();
      check("splash: doesn't replay on a reload", !(await p.isVisible("#splash")));
      const p2 = await ctx.newPage(); // a new tab = a new launch
      await p2.goto(BASE);
      check("splash: plays again on the next launch", await p2.isVisible("#splash"));
      await p2.click("#splash");
      check("splash: tap skips it", (await waitFor(async () => (await p2.locator("#splash").count()) === 0, 1000)) === true);
      await p2.click("#menu-open");
      check("splash: switch in the menu is on by default", await p2.isChecked("#startup-animation"));
      await p2.click("#startup-animation");
      const p3 = await ctx.newPage();
      await p3.goto(BASE);
      check("splash: switched off, it doesn't play", !(await p3.isVisible("#splash")) && await p3.evaluate(() => document.documentElement.classList.contains("ready")));
      check("splash: no JS errors", errs.length === 0, errs.join(" | "));
      await ctx.close();
      const ctxR = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block", reducedMotion: "reduce" });
      const pR = await ctxR.newPage();
      await pR.goto(BASE);
      check("splash: skipped with Reduce Motion", !(await pR.isVisible("#splash")) && await pR.evaluate(() => document.getElementById("welcome-sheet").open));
      await ctxR.close();
    }

    // First launch: asks for your name (fresh browser, no saved data)
    {
      const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      await ctx.addInitScript(noSplash);
      const p = await ctx.newPage();
      await p.goto(BASE);
      check("welcome: asks for your name on first launch", await p.evaluate(() => document.getElementById("welcome-sheet").open));
      await p.fill("#welcome-name", "Evan");
      await p.click("#welcome-save");
      check("welcome: closes and greets you", !(await p.evaluate(() => document.getElementById("welcome-sheet").open)) && (await p.textContent("#toast")).includes("Hi, Evan"));
      await p.reload();
      check("welcome: not asked again", !(await p.evaluate(() => document.getElementById("welcome-sheet").open)));
      await p.click("#menu-open");
      check("welcome: name shown in the menu", (await p.textContent("#menu-name-value")) === "Evan");
      await p.click("#menu-name");
      check("welcome: menu opens it to change the name", (await p.inputValue("#welcome-name")) === "Evan" && (await p.textContent("#welcome-title")) === "Your Name");
      await p.fill("#welcome-name", "E");
      await p.click("#welcome-save");
      await p.click("#menu-open");
      check("welcome: changed name saved", (await p.textContent("#menu-name-value")) === "E");
      await p.click("#menu-bulk");
      await p.fill("#bulk-to", "30");
      await p.click("#bulk-watch");
      check("pace: Mark Several doesn't count toward your pace", !(await p.textContent("#pace-text")).includes("a day"));
      await ctx.close();
      const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
      await ctx2.addInitScript(noSplash);
      const p2 = await ctx2.newPage();
      await p2.goto(BASE);
      await p2.click("#welcome-skip");
      await p2.reload();
      check("welcome: Not Now isn't asked again", !(await p2.evaluate(() => document.getElementById("welcome-sheet").open)));
      await ctx2.close();
    }

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
      await ctx.addInitScript(noSplash);
      if (name === "Android") await ctx.addInitScript(presetProfile);
      const p = await ctx.newPage();
      const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(BASE2 + "#join=" + CODE);
      await p.waitForTimeout(500);
      if (name === "iPhone") { // a brand-new phone: name first, then the install steps
        check("install (iPhone): asks for a name first", await p.evaluate(() => document.getElementById("welcome-sheet").open) && !(await p.evaluate(() => document.getElementById("install-sheet").open)));
        await p.fill("#welcome-name", "Sara");
        await p.click("#welcome-save");
        await p.waitForTimeout(300);
      }
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
      await ctx.addInitScript(presetProfile);
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
