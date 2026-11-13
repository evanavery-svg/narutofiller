#!/usr/bin/env node
/* Random-action ("monkey") test. Optional dev tool; needs Playwright.
 * Does hundreds of random things (ticks, the up-next card, Undo, filters, search, Mark Several,
 * ratings, arcs, menus, reset, reloads) and after every one checks that the screen agrees with
 * what's saved: ticks and skips, progress text, the up-next card, ratings, filters, Hide watched.
 *
 *   python3 -m http.server 8000        (in the project folder)
 *   node tools/monkey-test.js [seed] [steps] [url]
 */
const { chromium } = require("playwright");
const SEED = Number(process.argv[2] || 1), STEPS = Number(process.argv[3] || 300);
const URL_ = process.argv[4] || "http://localhost:8000/";
let seed = SEED; const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: "block" });
  await ctx.addInitScript(() => {
    window.NF_NO_SPLASH = true;
    if (!localStorage.getItem("naruto-filler:profile:v1")) localStorage.setItem("naruto-filler:profile:v1", JSON.stringify({ id: "monkeymonkey", name: "M", asked: true }));
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  p.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  await p.goto(URL_);
  await p.waitForFunction(() => document.documentElement.classList.contains("ready"));
  const problems = [];
  const log = [];
  const invariants = () => p.evaluate(() => {
    const out = [];
    const L = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
    const W = new Set(L("naruto-filler:watched:v1", [])), Sk = new Set(L("naruto-filler:skipped:v1", []));
    const prefs = L("naruto-filler:prefs:v1", {});
    const R = L("naruto-filler:ratings:v1", {});
    for (let n = 1; n <= 220; n++) {
      const li = document.getElementById("ep-" + n), inp = li.querySelector("input");
      if (inp.checked !== W.has(n)) out.push(`ep ${n}: checkbox ${inp.checked} vs saved ${W.has(n)}`);
      if (li.classList.contains("is-watched") !== W.has(n)) out.push(`ep ${n}: is-watched class wrong`);
      if (li.classList.contains("is-skipped") !== Sk.has(n)) out.push(`ep ${n}: is-skipped class wrong`);
      if (W.has(n) && Sk.has(n)) out.push(`ep ${n}: both watched and skipped`);
      const meta = li.querySelector(".ep-meta").textContent;
      if (R[n] && !meta.includes(String(R[n]))) out.push(`ep ${n}: rating ${R[n]} not shown`);
      if (!R[n] && /\d/.test(meta)) out.push(`ep ${n}: shows a rating it doesn't have (${meta})`);
    }
    const canon = EPISODES.filter((e) => e.type !== "filler");
    const cw = canon.filter((e) => W.has(e.number)).length;
    const head = document.getElementById("progress-canon-text").textContent;
    if (head !== `${cw} of ${canon.length}`) out.push(`headline "${head}" vs ${cw}`);
    const tot = document.getElementById("progress-all-text").textContent;
    if (!tot.startsWith(`${W.size} of 220 total`)) out.push(`total "${tot}" vs ${W.size}`);
    if (Sk.size && !tot.includes(`${Sk.size} skipped`)) out.push(`skipped count missing in "${tot}"`);
    const skipF = prefs.skipFillerNext !== false;
    const next = EPISODES.find((e) => !W.has(e.number) && !Sk.has(e.number) && !(skipF && e.type === "filler"));
    const card = document.getElementById("deck-card");
    if (next) {
      if (card.hidden) out.push("deck hidden but there is a next episode " + next.number);
      else if (!card.className.includes("fly")) {
        const num = document.getElementById("deck-num").textContent;
        if (num !== "Episode " + next.number) out.push(`deck shows "${num}", expected ${next.number}`);
      }
    } else if (!card.hidden) out.push("deck shows a card but nothing is left");
    const open = [...document.querySelectorAll("dialog[open]")].map((d) => d.id);
    if (open.length > 1) out.push("several dialogs open: " + open.join(","));
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push("horizontal overflow");
    // visible rows must be consistent with the filter + hide-watched
    const show = prefs.show || "all";
    document.querySelectorAll(".episode").forEach((li) => {
      if (li.hidden) return;
      const n = Number(li.id.slice(3)), e = EPISODES[n - 1];
      if (show !== "all" && (e.type === "filler" ? "filler" : "canon") !== show) out.push(`ep ${n} visible despite filter ${show}`);
      if (prefs.hideWatched && W.has(n)) out.push(`ep ${n} visible despite Hide watched`);
    });
    return out;
  });
  const closeAll = () => p.evaluate(() => document.querySelectorAll("dialog[open]").forEach((d) => d.close()));
  const actions = {
    tickRandom: async () => { const n = int(1, 220); await p.evaluate((k) => document.querySelector(`#ep-${k} input`).click(), n); await p.waitForTimeout(500); return "tick " + n; }, // a ticked row hides after its animation
    deckWatch: async () => { await closeAll(); if (await p.isVisible("#deck-watch")) { await p.click("#deck-watch"); await p.waitForTimeout(int(0, 1) ? 50 : 600); } return "deck watched"; },
    deckSkip: async () => { await closeAll(); if (await p.isVisible("#deck-skip")) { await p.click("#deck-skip"); await p.waitForTimeout(int(0, 1) ? 50 : 600); } return "deck skip"; },
    undo: async () => { if (await p.isVisible(".toast-action")) { await p.click(".toast-action", { timeout: 1000 }).catch(() => {}); return "undo"; } return "undo (none)"; },
    filter: async () => { await closeAll(); const v = pick(["all", "canon", "filler"]); await p.click(`#filters [data-show="${v}"]`); return "filter " + v; },
    search: async () => { await closeAll(); const q = pick(["", "", "sasuke", "12", "#7", "zzz", "kakashi", "ep 101"]); await p.fill("#search", q); await p.waitForTimeout(40); return "search " + JSON.stringify(q); },
    menuSwitch: async () => { await closeAll(); await p.click("#menu-open"); const id = pick(["skip-filler-next", "hide-watched", "spoiler-shield"]); await p.click("#" + id); await p.keyboard.press("Escape"); return "toggle " + id; },
    bulk: async () => { await closeAll(); await p.click("#menu-open"); await p.click("#menu-bulk"); const a = int(1, 220), c = int(1, 220); await p.fill("#bulk-from", String(a)); await p.fill("#bulk-to", String(c)); if (int(0, 1)) await p.click("#bulk-skip-filler"); const w = int(0, 1); const sel = w ? "#bulk-watch" : "#bulk-unwatch"; if (await p.isDisabled(sel)) { await p.keyboard.press("Escape"); return "bulk (nothing to mark)"; } await p.click(sel); return `bulk ${w ? "watch" : "unwatch"} ${a}-${c}`; },
    rate: async () => { await closeAll(); const n = int(1, 220); await p.evaluate((k) => document.querySelector(`#ep-${k} .ep-info`).click(), n); const v = int(1, 5); await p.click(`#ep-sheet-stars .star[data-v="${v}"]`); if (int(0, 2) === 0) await p.click(`#ep-sheet-state [data-state="${pick(["none", "watched", "skipped"])}"]`); if (int(0, 3) === 0) await p.click("#ep-sheet-fav"); await p.keyboard.press("Escape"); return `rate ${n} ${v}`; },
    rateBar: async () => {
      const open = await p.evaluate(() => [...document.querySelectorAll("dialog[open]")].map((d) => d.id).join(","));
      if (!(await p.isVisible("#rate-prompt"))) return "rate bar (none)";
      try { await p.click(`#rate-stars .star[data-v="${int(1, 5)}"]`, { timeout: 3000 }); return "rate bar"; }
      catch (e) { // why couldn't it be tapped?
        const why = await p.evaluate(() => ({ hidden: document.getElementById("rate-prompt").hidden, top: (() => { const r = document.querySelector("#rate-stars .star").getBoundingClientRect(); const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return el ? (el.id || el.className || el.tagName) : null; })(), dialogs: [...document.querySelectorAll("dialog[open]")].map((d) => d.id).join(",") }));
        if (why.hidden) return "rate bar (faded out on its own)";
        if (why.dialogs) return "rate bar (behind " + why.dialogs + ")"; // e.g. the arc-complete celebration
        throw new Error("rate bar not tappable: " + JSON.stringify(why) + " dialogs before: " + open);
      }
    },
    arc: async () => { await closeAll(); const i = int(0, 31); const vis = await p.isVisible(`#arc-${i} .arc-head`); if (vis) await p.click(`#arc-${i} .arc-head`); return "arc " + i + (vis ? "" : " (hidden)"); },
    guideJump: async () => { await closeAll(); await p.click("#menu-open"); await p.click("#menu-guide"); const n = int(1, 220); await p.click(`#guide-map .cell[data-n="${n}"]`); return "map jump " + n; },
    reset: async () => { if (int(0, 4)) return "reset (skipped)"; await closeAll(); await p.click("#menu-open"); await p.click("#reset-button"); if (await p.isVisible("#reset-yes")) await p.click("#reset-yes"); else await p.click("#reset-cancel"); return "reset"; },
    reload: async () => { if (int(0, 5)) return "reload (skipped)"; await p.reload(); await p.waitForFunction(() => document.documentElement.classList.contains("ready")); return "reload"; },
    wrapped: async () => { await closeAll(); await p.click("#menu-open"); await p.click(pick(["#menu-wrapped", "#menu-top"])); await p.keyboard.press("Escape"); return "wrapped/top"; },
  };
  const names = Object.keys(actions);
  const weights = { tickRandom: 6, deckWatch: 5, deckSkip: 2, undo: 3, filter: 2, search: 2, menuSwitch: 2, bulk: 2, rate: 3, rateBar: 2, arc: 2, guideJump: 1, reset: 1, reload: 1, wrapped: 1 };
  const bag = names.flatMap((n) => Array(weights[n]).fill(n));
  for (let i = 0; i < STEPS; i++) {
    const name = pick(bag);
    let what;
    try { what = await actions[name](); } catch (e) { what = name + " FAILED: " + e.message.split("\n")[0]; problems.push(`step ${i}: action error ${what}`); }
    log.push(what);
    await p.waitForTimeout(30);
    // let any card flight finish before checking the card
    await p.waitForFunction(() => !document.querySelector("#deck-card.fly-right, #deck-card.fly-left"), null, { timeout: 2000 }).catch(() => {});
    const bad = await invariants();
    if (bad.length) { problems.push(`step ${i} after [${log.slice(-3).join(" → ")}]: ${bad.slice(0, 4).join("; ")}`); if (problems.length > 8) break; }
  }
  console.log(`seed ${SEED}: ${STEPS} steps, ${problems.length} problem(s), ${errors.length} JS error(s)`);
  process.exitCode = problems.length || errors.length ? 1 : 0;
  problems.slice(0, 8).forEach((x) => console.log("  -", x));
  [...new Set(errors)].slice(0, 5).forEach((x) => console.log("  !", x));
  await b.close();
})();
