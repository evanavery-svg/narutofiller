#!/usr/bin/env node
// Sanity-checks data/episodes.js: exactly 220 episodes, numbered 1–220,
// no gaps or duplicates, valid types, every episode has an arc. Prints a count per type.
// Usage: node tools/validate-data.js
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const src = fs.readFileSync(path.join(__dirname, "..", "data", "episodes.js"), "utf8");
const ctx = {};
vm.runInNewContext(src + "\nthis.EPISODES = EPISODES;", ctx);
const eps = ctx.EPISODES;

const TYPES = ["canon", "mixed", "filler", "anime-canon"];
const errors = [];
if (eps.length !== 220) errors.push(`expected 220 episodes, found ${eps.length}`);
const seen = new Set();
eps.forEach((e, i) => {
  if (!Number.isInteger(e.number) || e.number < 1 || e.number > 220) errors.push(`bad number at index ${i}: ${e.number}`);
  if (seen.has(e.number)) errors.push(`duplicate episode ${e.number}`);
  seen.add(e.number);
  if (e.number !== i + 1) errors.push(`out of order at index ${i}: ${e.number}`);
  if (!TYPES.includes(e.type)) errors.push(`episode ${e.number}: invalid type "${e.type}"`);
  if (typeof e.title !== "string" || !e.title.trim()) errors.push(`episode ${e.number}: missing title`);
  if (typeof e.arc !== "string" || !e.arc.trim()) errors.push(`episode ${e.number}: missing arc`);
});
for (let n = 1; n <= 220; n++) if (!seen.has(n)) errors.push(`missing episode ${n}`);

const counts = Object.fromEntries(TYPES.map((t) => [t, eps.filter((e) => e.type === t).length]));
console.log(`Episodes: ${eps.length}`);
for (const t of TYPES) console.log(`  ${t.padEnd(12)} ${counts[t]}`);
const arcs = new Set(eps.map((e) => e.arc));
console.log(`Arcs: ${arcs.size} (${eps.filter((e) => e.arc === "Standalone").length} standalone episodes)`);
if (errors.length) {
  console.error("\nFAILED:\n  " + errors.join("\n  "));
  process.exit(1);
}
console.log("\nOK: 220 episodes, numbered 1–220, no gaps or duplicates.");
