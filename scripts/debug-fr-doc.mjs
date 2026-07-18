#!/usr/bin/env node
// scripts/debug-fr-doc.mjs <document_number>
//
// Pull the raw FR API record for a specific document, then compare against
// what's in our local fr-<year>.json and fr-by-rin.json files. This is the
// definitive tool for diagnosing "why did we match/miss this doc" cases.
//
// Example:
//   node scripts/debug-fr-doc.mjs 2026-06444

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdministrativeFollowup, whichExclusion } from "./fr-filters.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

const docNumber = process.argv[2];
if (!docNumber) {
  console.error("Usage: node scripts/debug-fr-doc.mjs <document_number>");
  process.exit(1);
}

// 1. Fetch from live FR API
console.log(`\nQuerying live FR API for ${docNumber}...\n`);
const url = `https://www.federalregister.gov/api/v1/documents/${docNumber}.json`;
const res = await fetch(url, { headers: { "User-Agent": "oira-viewer diagnostic" } });
if (!res.ok) {
  console.log(`FR API returned ${res.status} — document not found or API error.`);
  process.exit(2);
}
const live = await res.json();

console.log("─".repeat(70));
console.log("LIVE FR API RESPONSE (source of truth)");
console.log("─".repeat(70));
console.log(`  document_number:        ${live.document_number}`);
console.log(`  publication_date:       ${live.publication_date}`);
console.log(`  type:                   ${live.type}`);
console.log(`  subtype:                ${live.subtype ?? "(null)"}`);
console.log(`  action:                 ${live.action ?? "(null)"}`);
console.log(`  regulation_id_numbers:  ${JSON.stringify(live.regulation_id_numbers)}`);
console.log(`  title:                  ${(live.title || "").slice(0, 100)}`);
console.log(`  html_url:               ${live.html_url}`);

// Simulate what our compact() would produce, then run the filter
const asCompact = {
  n: live.document_number, d: live.publication_date, t: live.type,
  s: live.subtype, a: live.action, u: live.html_url, l: live.title,
  r: live.regulation_id_numbers,
};
const wouldExclude = isAdministrativeFollowup(asCompact);
console.log(`\n  → Filter says: ${wouldExclude ? "❌ EXCLUDE" : "✅ INCLUDE"} (${whichExclusion(asCompact) || "no pattern matched"})`);

// 2. Compare to what we have locally
console.log("\n" + "─".repeat(70));
console.log("LOCAL DATA (from committed public/data/*.json)");
console.log("─".repeat(70));

// Yearly file
const yearFiles = (await fs.readdir(DATA_DIR)).filter((f) => /^fr-\d{4}\.json$/.test(f));
let localYearly = null;
for (const f of yearFiles) {
  const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
  const found = (j.documents || []).find((d) => d.n === docNumber);
  if (found) { localYearly = { file: f, doc: found }; break; }
}
if (localYearly) {
  const d = localYearly.doc;
  console.log(`  Found in ${localYearly.file}:`);
  console.log(`    type:                 ${d.t || "(missing)"}`);
  console.log(`    subtype:              ${d.s ?? "(not captured — old data)"}`);
  console.log(`    action:               ${d.a ?? "(not captured — old data)"}`);
  console.log(`    regulation_id_numbers:${JSON.stringify(d.r)}`);
  console.log(`    title:                ${(d.l || "").slice(0, 100)}`);
  const yearlyExclude = isAdministrativeFollowup(d);
  console.log(`\n  → Filter (yearly): ${yearlyExclude ? "❌ EXCLUDE" : "✅ INCLUDE"} (${whichExclusion(d) || "no pattern matched"})`);
} else {
  console.log(`  Not found in any fr-<year>.json file`);
}

// by-rin file
try {
  const byRin = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-by-rin.json"), "utf8"));
  const hits = [];
  for (const [rin, docs] of Object.entries(byRin.rins || {})) {
    const found = docs.find((d) => d.n === docNumber);
    if (found) hits.push({ rin, doc: found });
  }
  if (hits.length) {
    console.log(`\n  Found in fr-by-rin.json under RIN(s): ${hits.map((h) => h.rin).join(", ")}`);
    const d = hits[0].doc;
    console.log(`    type:                 ${d.t || "(missing)"}`);
    console.log(`    subtype:              ${d.s ?? "(not captured — re-fetch with --refresh to update)"}`);
    console.log(`    action:               ${d.a ?? "(not captured — re-fetch with --refresh to update)"}`);
    console.log(`    title:                ${(d.l || "").slice(0, 100)}`);
    const byRinExclude = isAdministrativeFollowup(d);
    console.log(`\n  → Filter (by-rin): ${byRinExclude ? "❌ EXCLUDE" : "✅ INCLUDE"} (${whichExclusion(d) || "no pattern matched"})`);
  } else {
    console.log(`\n  Not found in fr-by-rin.json`);
  }
} catch { /* file may not exist */ }

// 3. Index check
console.log("\n" + "─".repeat(70));
console.log("CURRENT fr-index.json");
console.log("─".repeat(70));
try {
  const idx = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-index.json"), "utf8"));
  const rinsWithDoc = Object.entries(idx.rins || {}).filter(([_, docs]) => docs.some((d) => d.n === docNumber)).map(([r]) => r);
  if (rinsWithDoc.length) {
    console.log(`  Indexed under RIN(s): ${rinsWithDoc.join(", ")}  ← this is what the client will match on`);
  } else {
    console.log(`  Not indexed under any RIN.`);
  }
} catch { console.log(`  fr-index.json not present`); }

console.log("\n" + "─".repeat(70));
console.log("DIAGNOSIS");
console.log("─".repeat(70));
if (wouldExclude && localYearly && !localYearly.doc.a) {
  console.log("  Local data is missing the `action` field → filter can't distinguish");
  console.log("  extension/correction docs from primary rules.");
  console.log("");
  console.log("  Fix: re-fetch to capture the new action field:");
  console.log("    npm run fetch:fr-by-rin -- --refresh   (~19 min for full re-fetch)");
  console.log("    npm run build:fr-index                  (~10 sec)");
} else if (wouldExclude) {
  console.log("  Filter correctly identifies this doc as an administrative follow-up.");
  console.log("  If it's still appearing in matches, rebuild the index:");
  console.log("    npm run build:fr-index");
} else {
  console.log("  Filter says this is a primary rule — no exclusion applies.");
  console.log("  If matching it seems wrong, the issue is elsewhere (RIN linkage,");
  console.log("  date window, etc.). Run inspect-rin on the OIRA rule's RIN.");
}
console.log();
