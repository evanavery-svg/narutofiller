#!/usr/bin/env node
/* Two-device test of the "Watch together" shared list against the Firestore emulator.
 * Optional dev tool; needs Playwright, Java and the Firebase CLI.
 *
 *   1. Start the emulator (it loads firestore.rules from firebase.json):
 *        npx firebase-tools emulators:start --only firestore --project demo-naruto-filler
 *   2. node tools/sync-test.js
 *
 * The browser loads the Firebase SDK from www.gstatic.com. To use a local copy instead,
 * point FIREBASE_SDK_DIR at an installed `firebase` npm package of the same version.
 */
const { chromium } = require("playwright");
const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const FILES = ["index.html", "styles.css", "app.js", "sync.js", "manifest.json", "service-worker.js", "data", "icons"];
const PORT = 8766;
const BASE = `http://localhost:${PORT}/naruto-filler/`;
const EMULATOR = process.env.FIRESTORE_EMULATOR_HOST || "127.0.0.1:8080";
const PROJECT = "demo-naruto-filler";
const SDK_VERSION = fs.readFileSync(path.join(ROOT, "sync.js"), "utf8").match(/firebasejs\/([\d.]+)\//)[1];

let failures = 0;
function check(name, cond, extra) {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra !== undefined ? "  — " + extra : ""}`);
  if (!cond) failures++;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitFor(fn, timeout = 8000) {
  const end = Date.now() + timeout;
  let last;
  while (Date.now() < end) {
    last = await fn();
    if (last) return last;
    await sleep(150);
  }
  return last;
}

(async () => {
  // Emulator up?
  try { await fetch(`http://${EMULATOR}/`); } catch (e) {
    console.error(`Firestore emulator not reachable at ${EMULATOR}. Start it first (see the top of this file).`);
    process.exit(2);
  }
  await fetch(`http://${EMULATOR}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: "DELETE" });

  // Serve a copy with a demo Firebase config
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "nf-sync-"));
  const site = path.join(tmp, "naruto-filler");
  fs.mkdirSync(site);
  for (const f of FILES) fs.cpSync(path.join(ROOT, f), path.join(site, f), { recursive: true });
  fs.writeFileSync(path.join(site, "firebase-config.js"),
    `const FIREBASE_CONFIG = { apiKey: "demo-key", projectId: "${PROJECT}", appId: "demo-app" };\n`);
  const server = spawn("python3", ["-m", "http.server", String(PORT), "--bind", "127.0.0.1"], { cwd: tmp, stdio: "ignore" });
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(BASE)).ok) break; } catch (e) { /* not up yet */ }
    await sleep(200);
  }

  const browser = await chromium.launch();
  async function device(name) {
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await context.addInitScript((host) => { window.NF_FIRESTORE_EMULATOR = host; }, EMULATOR);
    if (process.env.FIREBASE_SDK_DIR) {
      await context.route(`https://www.gstatic.com/firebasejs/${SDK_VERSION}/*`, (route) => {
        const file = path.join(process.env.FIREBASE_SDK_DIR, path.basename(new URL(route.request().url()).pathname));
        route.fulfill({ body: fs.readFileSync(file), contentType: "text/javascript", headers: { "Access-Control-Allow-Origin": "*" } });
      });
    }
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(`${name}: ${e.message}`));
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const t = m.text();
      // Expected while a device is deliberately offline
      if (/ERR_INTERNET_DISCONNECTED|Could not reach Cloud Firestore backend|net::ERR_/.test(t)) return;
      errors.push(`${name}: ${t}`);
    });
    return { context, page, errors, name };
  }
  const watchedOf = (page) => page.$$eval(".episode input:checked", (els) => els.map((e) => Number(e.dataset.number)));
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const status = (page) => page.getAttribute("#sync-status", "data-state");
  const isOpen = (page, id) => page.evaluate((i) => document.getElementById(i).open, id);
  const closeSheets = (page) => page.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  const openMenu = async (page) => { if (!(await isOpen(page, "menu-sheet"))) await page.click("#menu-open"); };
  const openSync = async (page) => { if (!(await isOpen(page, "sync-sheet"))) { await openMenu(page); await page.click("#menu-sync"); } };
  // Close any open sheet first, as a person would, before tapping an episode
  const tick = async (page, n) => { await closeSheets(page); await page.check(`#ep-${n} input`); };
  const untick = async (page, n) => { await closeSheets(page); await page.uncheck(`#ep-${n} input`); };

  try {
    const A = await device("A");
    const B = await device("B");
    await A.page.goto(BASE);
    await B.page.goto(BASE);

    await openSync(A.page);
    check("setup: create/join shown when configured", await A.page.locator("#sync-create").isVisible());

    // A has some progress, then creates a shared list
    for (const n of [1, 2, 3]) await tick(A.page, n);
    await openSync(A.page);
    await A.page.click("#sync-create");
    await waitFor(async () => (await status(A.page)) === "synced", 15000);
    check("create: A connected and synced", (await status(A.page)) === "synced", await status(A.page));
    const code = (await A.page.textContent("#sync-code-display")).replace(/-/g, "");
    check("create: 16-character code shown", /^[2-9A-HJ-NP-Z]{16}$/.test(code), code);

    // B already has its own progress, then opens the invite link
    await tick(B.page, 10);
    await B.page.goto(BASE + "#join=" + code);
    check("invite: B sees a join prompt", await B.page.locator("#sync-invite-prompt").isVisible());
    check("invite: link removed from address bar", !B.page.url().includes("join="));
    check("invite: banner on B's main screen", await B.page.isVisible("#invite-banner"));
    await B.page.click("#sync-invite-accept");
    await waitFor(async () => (await status(B.page)) === "synced", 15000);
    check("join: B synced", (await status(B.page)) === "synced", await status(B.page));
    check("join: B has A's progress merged with its own", same(await waitFor(async () => { const w = await watchedOf(B.page); return same(w, [1, 2, 3, 10]) && w; }), [1, 2, 3, 10]), (await watchedOf(B.page)).join(","));
    check("join: A receives B's progress live", same(await waitFor(async () => { const w = await watchedOf(A.page); return same(w, [1, 2, 3, 10]) && w; }), [1, 2, 3, 10]), (await watchedOf(A.page)).join(","));

    // Live changes both ways
    await tick(A.page, 4);
    await untick(B.page, 2);
    const live = [1, 3, 4, 10];
    check("live: A tick + B untick reach both", same(await waitFor(async () => { const a = await watchedOf(A.page), b = await watchedOf(B.page); return same(a, live) && same(b, live) && a; }), live),
      `A=${await watchedOf(A.page)} B=${await watchedOf(B.page)}`);
    check("live: progress text updated on A", (await A.page.textContent("#progress-all-text")) === "4 of 220 total");

    // Marking several at once (and Undo) syncs too
    check("chip: A shows 'Shared' on the main screen", (await A.page.textContent("#sync-chip")) === "Shared" && await A.page.isVisible("#sync-chip"));
    check("chip: invite banner gone after joining", !(await B.page.isVisible("#invite-banner")));
    check("menu: Watch Together shows 'Synced'", (await A.page.textContent("#menu-sync-status")) === "Synced");
    await closeSheets(A.page);
    await openMenu(A.page);
    await A.page.click("#menu-bulk");
    await A.page.fill("#bulk-from", "100");
    await A.page.fill("#bulk-to", "105");
    await A.page.click("#bulk-watch");
    const withBulk = [...live, 100, 101, 102, 103, 104, 105];
    check("bulk: marking 100–105 on A reaches B", same(await waitFor(async () => { const b = await watchedOf(B.page); return same(b, withBulk) && b; }, 10000), withBulk), (await watchedOf(B.page)).join(","));
    await A.page.click(".toast-action");
    check("bulk: Undo on A reaches B", same(await waitFor(async () => { const b = await watchedOf(B.page); return same(b, live) && b; }, 10000), live), (await watchedOf(B.page)).join(","));

    // Skipping from the up-next card syncs too
    await closeSheets(A.page);
    const skipNum = Number((await A.page.textContent("#deck-num")).replace(/\D/g, ""));
    await A.page.click("#deck-skip");
    check(`skip: skipping episode ${skipNum} on A shows as skipped on B`, (await waitFor(async () => (await B.page.locator(`#ep-${skipNum}.is-skipped`).count()) === 1, 10000)) === true);
    await A.page.click(".toast-action");
    check("skip: Undo on A reaches B", (await waitFor(async () => (await B.page.locator(`#ep-${skipNum}.is-skipped`).count()) === 0, 10000)) === true);

    // B goes offline and makes changes; A changes in the meantime
    await B.context.setOffline(true);
    await tick(B.page, 5);
    await untick(B.page, 3);
    await waitFor(async () => ["offline", "saving"].includes(await status(B.page)));
    check("offline: B shows offline/saving status", ["offline", "saving"].includes(await status(B.page)), await status(B.page));
    await tick(A.page, 6);
    await sleep(500);
    check("offline: A doesn't see B's offline changes yet", same(await watchedOf(A.page), [1, 3, 4, 6, 10]), (await watchedOf(A.page)).join(","));
    await B.context.setOffline(false);
    const merged = [1, 4, 5, 6, 10];
    check("reconnect: both converge", same(await waitFor(async () => { const a = await watchedOf(A.page), b = await watchedOf(B.page); return same(a, merged) && same(b, merged) && a; }, 20000), merged),
      `A=${await watchedOf(A.page)} B=${await watchedOf(B.page)}`);
    await waitFor(async () => (await status(B.page)) === "synced", 15000);
    check("reconnect: B back to synced", (await status(B.page)) === "synced", await status(B.page));

    // B ticks while offline, then closes the app before reconnecting
    await B.context.setOffline(true);
    await tick(B.page, 7);
    await B.page.close();
    await B.context.setOffline(false);
    B.page = await B.context.newPage();
    B.page.on("pageerror", (e) => B.errors.push(`B: ${e.message}`));
    await B.page.goto(BASE);
    check("resume: B reconnects to the saved list on startup", (await waitFor(async () => (await status(B.page)) === "synced", 15000)) === true);
    check("resume: change made offline before closing reaches A", (await waitFor(async () => (await watchedOf(A.page)).includes(7), 15000)) === true, (await watchedOf(A.page)).join(","));

    // Reset clears the list for both
    await openMenu(A.page);
    await A.page.click("#reset-button");
    check("reset: wording mentions the shared list", (await A.page.textContent("#reset-question")).includes("everyone on the shared list"));
    await A.page.click("#reset-yes");
    check("reset: clears B too", (await waitFor(async () => (await watchedOf(B.page)).length === 0, 10000)) === true, (await watchedOf(B.page)).join(","));

    // Leaving stops syncing (two taps)
    await B.page.click("#sync-chip");
    check("chip: tapping it opens Watch Together", await isOpen(B.page, "sync-sheet"));
    await B.page.click("#sync-leave");
    check("leave: first tap asks to confirm", (await B.page.textContent("#sync-leave")).includes("again"));
    await B.page.click("#sync-leave");
    check("leave: setup shown again", await B.page.locator("#sync-create").isVisible());
    await tick(B.page, 8);
    await sleep(1500);
    check("leave: B's changes no longer reach A", !(await watchedOf(A.page)).includes(8));
    await B.page.reload();
    await openSync(B.page);
    check("leave: stays left after reload", await B.page.locator("#sync-create").isVisible());

    // Bad codes
    await B.page.click("#sync-join-toggle");
    await B.page.fill("#sync-code", "2222-3333-4444-5555");
    await B.page.click("#sync-join-submit");
    check("join: unknown code -> clear message", (await waitFor(async () => (await B.page.textContent("#sync-message")).includes("No shared list"), 15000)) === true, await B.page.textContent("#sync-message"));
    await B.page.fill("#sync-code", "abc");
    await B.page.click("#sync-join-submit");
    check("join: malformed code -> format hint", (await B.page.textContent("#sync-message")).includes("16 letters"));
    // Pasting the whole invite link (code in lowercase with dashes) works too
    await B.page.fill("#sync-code", BASE + "#join=" + code.toLowerCase().replace(/(.{4})(?=.)/g, "$1-"));
    await B.page.click("#sync-join-submit");
    check("join: pasted invite link / typed code works", (await waitFor(async () => (await status(B.page)) === "synced", 15000)) === true);

    // Security rules (requests without admin rights, like a browser's)
    const api = `http://${EMULATOR}/v1/projects/${PROJECT}/databases/(default)/documents`;
    const list = await fetch(`${api}/rooms`);
    check("rules: listing rooms is denied", list.status === 403, list.status);
    const badId = await fetch(`${api}/rooms/short?`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { eps: { mapValue: { fields: {} } } } }) });
    check("rules: invalid room code is denied", badId.status === 403, badId.status);
    const extra = await fetch(`${api}/rooms/${code}?updateMask.fieldPaths=evil`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fields: { evil: { stringValue: "x" } } }) });
    check("rules: unexpected fields are denied", extra.status === 403, extra.status);
    const del = await fetch(`${api}/rooms/${code}`, { method: "DELETE" });
    check("rules: deleting a room is denied", del.status === 403, del.status);
    const other = await fetch(`${api}/other/doc`);
    check("rules: other collections are closed", other.status === 403, other.status);

    await A.page.screenshot({ path: path.join(tmp, "sync-A.png") });
    const errs = [...A.errors, ...B.errors];
    check("no unexpected JS errors", errs.length === 0, errs.join(" | "));
    console.log("\nScreenshots in", tmp);
  } finally {
    await browser.close();
    server.kill();
  }
  console.log(failures ? `\n${failures} check(s) FAILED` : "\nAll sync checks passed.");
  process.exit(failures ? 1 : 0);
})();
