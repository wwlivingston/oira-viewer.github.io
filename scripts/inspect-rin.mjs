#!/usr/bin/env node
// scripts/inspect-rin.mjs <RIN>
//
// Shows the full picture for a single RIN: what FR docs exist in your yearly
// files, which get filtered by the exclusion list, what ends up in the RIN
// index, and any fuzzy match that was produced.
//
// Run this whenever a match looks wrong. Example:
//   node scripts/inspect-rin.mjs 2050-AH37

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdministrativeFollowup, whichExclusion } from "./fr-filters.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

const rin = process.argv[2];
if (!rin) {
  console.error("Usage: node scripts/inspect-rin.mjs <RIN>");
  console.error("Example: node scripts/inspect-rin.mjs 2050-AH37");
  process.exit(1);
}

console.log(`\nInspecting RIN: ${rin}\n`);

// 1. Raw yearly files — every FR doc that lists this RIN, filter status shown
console.log("─".repeat(70));
console.log("RAW FR DOCS TAGGED WITH THIS RIN (from fr-<year>.json files)");
console.log("─".repeat(70));
const yearFiles = (await fs.readdir(DATA_DIR)).filter((f) => /^fr-\d{4}\.json$/.test(f)).sort();
const raw = [];
for (const f of yearFiles) {
  const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
  for (const d of j.documents || []) {
    if ((d.r || []).includes(rin)) raw.push({ ...d, __from: f });
  }
}
raw.sort((a, b) => (a.d || "").localeCompare(b.d || ""));

if (!raw.length) {
  console.log(`  (no FR docs list this RIN)`);
} else {
  for (const d of raw) {
    const excluded = isAdministrativeFollowup(d);
    const marker = excluded ? "❌ EXCLUDED" : "✅ included";
    const reason = excluded ? ` (${whichExclusion(d)})` : "";
    console.log(`  ${d.d}  ${d.n.padEnd(14)}  ${marker}${reason}`);
    console.log(`             type:    ${d.t || "?"}${d.s ? ` / subtype: ${d.s}` : ""}`);
    console.log(`             action:  ${d.a || "(not captured — re-fetch to get this field)"}`);
    console.log(`             title:   ${(d.l || "").slice(0, 100)}`);
    console.log(`             url:     ${d.u || "(no url)"}`);
    console.log();
  }
}

// 2. Authoritative RIN-based fetch (if present)
console.log("─".repeat(70));
console.log("AUTHORITATIVE FR DOCS FROM fr-by-rin.json (RIN-scoped fetch)");
console.log("─".repeat(70));
try {
  const byRin = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-by-rin.json"), "utf8"));
  const entries = (byRin.rins || {})[rin] || [];
  if (!entries.length) {
    console.log(`  (no entries for this RIN — either fr-by-rin.json is missing this RIN,`);
    console.log(`   or FR reports no docs under this RIN when queried directly)`);
  } else {
    for (const d of entries) {
      const excluded = isAdministrativeFollowup(d);
      const marker = excluded ? "❌ EXCLUDED" : "✅ included";
      const reason = excluded ? ` (${whichExclusion(d)})` : "";
      console.log(`  ${d.d}  ${d.n.padEnd(14)}  ${marker}${reason}`);
      console.log(`             type:   ${d.t || "?"}${d.s ? ` / subtype: ${d.s}` : ""}`);
      console.log(`             action: ${d.a || "(not captured — re-fetch to get this field)"}`);
      console.log(`             title:  ${(d.l || "").slice(0, 100)}`);
    }
  }
} catch {
  console.log(`  (fr-by-rin.json not present — run: node scripts/fetch-fr-by-rin.mjs)`);
}

// 3. RIN index — what the client actually sees
console.log("\n" + "─".repeat(70));
console.log("WHAT'S IN fr-index.json FOR THIS RIN (what the client sees)");
console.log("─".repeat(70));
try {
  const idx = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-index.json"), "utf8"));
  const entries = idx.rins?.[rin];
  if (!entries || !entries.length) {
    console.log(`  (nothing indexed under this RIN)`);
  } else {
    for (const e of entries) {
      console.log(`  ${e.d}  ${e.n.padEnd(14)}  ${e.t || "?"}`);
    }
    console.log(`\n  Client will pick the earliest with d >= DATE_COMPLETED.`);
  }
  console.log(`\n  Index generated at: ${idx.generated_at}`);
} catch {
  console.log(`  (no fr-index.json — run build-fr-index.mjs first)`);
}

// 3. Fuzzy matches for any OIRA rule with this RIN
console.log("\n" + "─".repeat(70));
console.log("FUZZY MATCHES (fr-fuzzy-matches.json) FOR OIRA RULES WITH THIS RIN");
console.log("─".repeat(70));
try {
  const fuzzy = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-fuzzy-matches.json"), "utf8"));
  const hits = Object.entries(fuzzy.matches || {}).filter(([k]) => k.startsWith(rin + "|"));
  if (!hits.length) {
    console.log(`  (no fuzzy matches for this RIN — either the RIN index covered it, or no title match cleared the threshold)`);
  } else {
    for (const [key, m] of hits) {
      console.log(`  OIRA row: ${key}`);
      console.log(`    → matched ${m.n} on ${m.d} (score ${m.score})`);
    }
  }
} catch {
  console.log(`  (no fr-fuzzy-matches.json)`);
}

console.log("\n" + "─".repeat(70));
console.log("HOW TO READ THIS");
console.log("─".repeat(70));
console.log("  * If a doc shows ❌ EXCLUDED in the raw list, it should NOT appear in the");
console.log("    RIN index. If it still does, run: node scripts/build-fr-index.mjs");
console.log("  * If a doc is ✅ included but you think it's a follow-up, its title doesn't");
console.log("    match any pattern in scripts/fr-filters.mjs — add a substring there.");
console.log("  * If the RIN index looks right but production still shows the wrong doc,");
console.log("    it's a deploy or browser-cache issue — force-refresh, or verify the");
console.log("    committed fr-index.json in your repo matches what you see locally.\n");
