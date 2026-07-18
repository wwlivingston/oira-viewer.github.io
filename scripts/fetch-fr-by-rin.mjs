#!/usr/bin/env node
// scripts/fetch-fr-by-rin.mjs [--only-missing] [--refresh]
//
// Fetch FR documents authoritatively — queried by RIN rather than by date range.
//
// Why this exists: the FR listing endpoint (used by fetch-fr-year.mjs) is fast
// and covers many years cheaply, but has been observed to return
// regulation_id_numbers as an empty array for some docs whose RIN metadata is
// actually populated in FR's database. The single-doc and RIN-scoped endpoints
// return the correct RIN in every case we've tested. This script uses the
// RIN-scoped endpoint to gather the ground truth for every RIN mentioned in
// OIRA data.
//
// Output: public/data/fr-by-rin.json
//   { generated_at, rin_count, doc_count, rins: { <RIN>: [{n,d,t,s,a,u,l,r}, ...] } }
//
// Cost: ~1 request per unique RIN at 250ms each. ~4500 RINs = ~19 minutes.
//
// Flags:
//   --only-missing   Only fetch RINs that aren't already in fr-by-rin.json.
//                    Use this for daily incremental — skips RINs already covered.
//   --refresh        Ignore the cache and re-fetch every RIN. Use this when the
//                    schema changed (e.g. adding new fields like action/subtype)
//                    to backfill the new fields.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";
import { fetchDocumentsByRin, compact } from "./fr-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");
const OUT_FILE = path.join(DATA_DIR, "fr-by-rin.json");

const onlyMissing = process.argv.includes("--only-missing");
const refresh = process.argv.includes("--refresh");
if (onlyMissing && refresh) {
  console.error("Cannot use --only-missing and --refresh together.");
  process.exit(1);
}

async function writeAtomic(filepath, content) {
  const tmp = `${filepath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filepath);
}

async function loadOiraRins() {
  const files = (await fs.readdir(DATA_DIR)).filter((f) =>
    /^completed-(\d{4}|ytd|30d)\.json$/.test(f)
  );
  const rins = new Set();
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
    for (const r of j.rules || []) {
      if (r.RIN && /^\d{4}-[A-Z0-9]{4}$/i.test(r.RIN)) rins.add(r.RIN);
    }
  }
  return [...rins].sort();
}

async function loadExisting() {
  try {
    const j = JSON.parse(await fs.readFile(OUT_FILE, "utf8"));
    return j.rins || {};
  } catch {
    return {};
  }
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  console.log("Loading RINs from OIRA data...");
  const allRins = await loadOiraRins();
  console.log(`  ${allRins.length} unique OIRA RINs`);

  const existing = refresh ? {} : await loadExisting();
  const targets = onlyMissing
    ? allRins.filter((r) => !existing[r])
    : allRins;

  console.log(
    refresh
      ? `  ${targets.length} to fetch (--refresh: ignoring cache)`
      : onlyMissing
        ? `  ${targets.length} to fetch (${allRins.length - targets.length} already cached)`
        : `  ${targets.length} to fetch (refreshing all)`
  );

  const rins = { ...existing };
  let totalDocs = 0;
  const t0 = Date.now();
  let done = 0;

  for (const rin of targets) {
    done++;
    try {
      const docs = await fetchDocumentsByRin(rin);
      const compacted = docs.map(compact);
      rins[rin] = compacted;
      totalDocs += compacted.length;
    } catch (err) {
      console.error(`  ${rin}: ${err.message} (leaving prior data untouched)`);
    }

    if (done % 25 === 0 || done === targets.length) {
      const rate = done / ((Date.now() - t0) / 1000);
      const remaining = targets.length - done;
      const etaSec = Math.round(remaining / Math.max(rate, 0.1));
      const etaMin = Math.floor(etaSec / 60);
      console.log(
        `  progress: ${done}/${targets.length}` +
        `  (${rate.toFixed(1)} rin/s, eta ${etaMin}m ${etaSec % 60}s)`
      );
    }
  }

  const generatedAt = new Date().toISOString();
  let allDocCount = 0;
  for (const r of Object.values(rins)) allDocCount += r.length;

  const output = {
    generated_at: generatedAt,
    rin_count: Object.keys(rins).length,
    doc_count: allDocCount,
    rins,
  };
  await writeAtomic(OUT_FILE, JSON.stringify(output));
  console.log(`\n✓ Wrote fr-by-rin.json`);
  console.log(`  ${output.rin_count} RINs, ${output.doc_count} docs`);
  console.log(`  Fetched ${totalDocs} new docs across ${targets.length} RIN queries`);
  console.log(`  Elapsed: ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  // Update manifest
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  let manifest = { generated_at: generatedAt, sources: {}, historical: {}, fr_years: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.sources = manifest.sources || {};
  } catch { /* first run */ }
  manifest.sources["fr-by-rin"] = {
    file: "fr-by-rin.json",
    rin_count: output.rin_count,
    doc_count: output.doc_count,
    updated_at: generatedAt,
  };
  await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

main().catch((err) => { console.error("Fatal:", err); process.exit(2); });
