#!/usr/bin/env node
// scripts/build-fr-index.mjs
//
// Reads every public/data/fr-*.json file, builds a RIN → [FR pubs] index, and
// writes public/data/fr-index.json. Idempotent — safe to run anytime.
//
// Output shape:
//   {
//     "generated_at": "...",
//     "rin_count": 12345,
//     "doc_count": 34567,
//     "rins": {
//       "0910-AI34": [
//         { "d": "2020-03-15", "n": "2020-12345", "t": "Rule", "u": "https://..." },
//         ...
//       ]
//     }
//   }
//
// Within each RIN's list, entries are sorted ascending by publication date,
// so the client's "earliest FR pub after OIRA completion" match is a simple
// linear scan (or bisect on very hot paths).

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdministrativeFollowup, whichExclusion } from "./fr-filters.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

async function writeAtomic(filepath, content) {
  const tmp = `${filepath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filepath);
}

async function main() {
  const files = (await fs.readdir(DATA_DIR)).filter(
    (f) => /^fr-\d{4}\.json$/.test(f)
  ).sort();

  if (!files.length) {
    console.error("No fr-<year>.json files found. Nothing to index.");
    console.error("Run `node scripts/fetch-fr-year.mjs YEAR` first.");
    process.exit(1);
  }

  console.log(`Building index from ${files.length} year files:`);
  files.forEach((f) => console.log(`  · ${f}`));

  const rins = {};
  let totalDocs = 0;
  const excludeStats = {};   // pattern → count, for diagnostics
  let excludedDocs = 0;

  // Pass 1: authoritative RIN-scoped fetches from fr-by-rin.json.
  //
  // For every RIN present here, this is the source of truth: we fetched FR
  // directly by RIN, so the doc list is complete and every doc has the full
  // structured metadata (action, subtype, etc.). Any RIN covered here should
  // NOT be supplemented from the yearly listing files, because those may
  // contain the same doc with missing action/subtype fields — which would let
  // the filter fail on the fallback title check.
  const byRinCovered = new Set();
  let fromByRin = 0;
  try {
    const byRin = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-by-rin.json"), "utf8"));
    for (const [rin, docs] of Object.entries(byRin.rins || {})) {
      byRinCovered.add(rin);
      for (const d of docs) {
        if (isAdministrativeFollowup(d)) {
          excludedDocs++;
          const pat = whichExclusion(d);
          if (pat) excludeStats[pat] = (excludeStats[pat] || 0) + 1;
          continue;
        }
        if (!rins[rin]) rins[rin] = [];
        rins[rin].push({ d: d.d, n: d.n, t: d.t, u: d.u });
        fromByRin++;
      }
    }
    console.log(`  ${byRinCovered.size} RINs covered authoritatively (${fromByRin} entries)`);
  } catch {
    console.log(`  (fr-by-rin.json not present — run scripts/fetch-fr-by-rin.mjs for authoritative RIN data)`);
  }

  // Pass 2: yearly listing files (fr-<year>.json), for RINs NOT already covered
  // authoritatively.
  //
  // These files may lack the `action` field for docs fetched before v9. That's
  // OK for RINs where we have no authoritative source — the filter will do its
  // best with the title fallback. For RINs we DO have authoritative data for,
  // we skip entirely to avoid letting stale/incomplete listing data leak in.
  let fromYearly = 0;
  let skippedCoveredRins = 0;
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
    const docs = j.documents || [];
    totalDocs += docs.length;

    for (const doc of docs) {
      const rinList = doc.r || [];
      for (const rin of rinList) {
        // Skip if authoritative data already covers this RIN. Prevents stale
        // listing data (missing action field) from leaking extensions or
        // corrections into RINs whose by-rin data would have caught them.
        if (byRinCovered.has(rin)) {
          skippedCoveredRins++;
          continue;
        }
        if (isAdministrativeFollowup(doc)) {
          excludedDocs++;
          const pat = whichExclusion(doc);
          if (pat) excludeStats[pat] = (excludeStats[pat] || 0) + 1;
          continue;
        }
        if (!rins[rin]) rins[rin] = [];
        rins[rin].push({ d: doc.d, n: doc.n, t: doc.t, u: doc.u });
        fromYearly++;
      }
    }
  }
  console.log(`  ${fromYearly} entries from yearly files (for RINs without authoritative data)`);
  if (skippedCoveredRins) {
    console.log(`  skipped ${skippedCoveredRins} yearly-file entries because by-rin already covered their RIN`);
  }

  // Sort each RIN's docs by publication date ASC, dedup by document_number
  // (a doc could appear in adjacent years if the range crossed a boundary).
  let rinDocPairs = 0;
  for (const rin of Object.keys(rins)) {
    rins[rin].sort((a, b) => (a.d || "").localeCompare(b.d || ""));
    const seen = new Set();
    rins[rin] = rins[rin].filter((d) => {
      if (seen.has(d.n)) return false;
      seen.add(d.n);
      return true;
    });
    rinDocPairs += rins[rin].length;
  }

  const generatedAt = new Date().toISOString();
  const output = {
    generated_at: generatedAt,
    rin_count: Object.keys(rins).length,
    doc_count: rinDocPairs,
    rins,
  };

  const outPath = path.join(DATA_DIR, "fr-index.json");
  await writeAtomic(outPath, JSON.stringify(output));
  console.log(`\n✓ Wrote fr-index.json`);
  console.log(`  ${output.rin_count} unique RINs`);
  console.log(`  ${rinDocPairs} RIN→doc references (across ${totalDocs} source docs read)`);
  if (excludedDocs) {
    console.log(`\n  Excluded ${excludedDocs} administrative follow-ups:`);
    for (const [pat, n] of Object.entries(excludeStats).sort((a, b) => b[1] - a[1])) {
      console.log(`    "${pat}"`.padEnd(42) + ` ${n}`);
    }
  }

  // Update manifest.sources["fr-index"]
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  let manifest = { generated_at: generatedAt, sources: {}, historical: {}, fr_years: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.sources = manifest.sources || {};
  } catch { /* first run */ }
  manifest.sources["fr-index"] = {
    file: "fr-index.json",
    rin_count: output.rin_count,
    doc_count: output.doc_count,
    updated_at: generatedAt,
  };
  await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✓ manifest.sources["fr-index"] updated`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
