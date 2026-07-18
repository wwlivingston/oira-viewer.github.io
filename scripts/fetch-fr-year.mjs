#!/usr/bin/env node
// scripts/fetch-fr-year.mjs YEAR
//
// One-shot FR historical backfill for a single calendar year.
// Writes public/data/fr-<year>.json containing every FR document from that
// year that lists at least one RIN.
//
// A typical year has ~80–100 pages at 1000 docs/page, of which ~2000–5000
// docs have RINs. With DEFAULT_DELAY_MS=250 between pages, one year takes
// ~25–35 seconds. 30 years of backfill takes ~15 minutes.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchDocumentsByDateRange, withRins, compact } from "./fr-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

const year = parseInt(process.argv[2], 10);
const currentYear = new Date().getFullYear();
if (!year || year < 2017 || year > currentYear) {
  console.error("Usage: node scripts/fetch-fr-year.mjs YEAR");
  console.error(`YEAR must be between 2017 and ${currentYear}.`);
  process.exit(1);
}

const from = `${year}-01-01`;
const to = year === currentYear ? new Date().toISOString().slice(0, 10) : `${year}-12-31`;

async function writeAtomic(filepath, content) {
  const tmp = `${filepath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filepath);
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  console.log(`Fetching FR documents from ${from} to ${to}`);

  const all = await fetchDocumentsByDateRange(from, to);
  const withR = withRins(all);
  const compacted = withR.map(compact);

  console.log(`  total docs: ${all.length}`);
  console.log(`  docs with RINs: ${compacted.length}`);

  if (!compacted.length) {
    console.error("No documents with RINs found. Not writing an empty file.");
    process.exit(2);
  }

  const generatedAt = new Date().toISOString();
  const payload = {
    source: `federalregister.gov/api/v1/documents (${from}..${to})`,
    year,
    generated_at: generatedAt,
    count: compacted.length,
    documents: compacted,
  };

  const outFile = `fr-${year}.json`;
  await writeAtomic(path.join(DATA_DIR, outFile), JSON.stringify(payload) + "\n");
  console.log(`✓ Wrote ${outFile} (${compacted.length} docs)`);

  // Update manifest.fr_years.<year>
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  let manifest = { generated_at: generatedAt, sources: {}, historical: {}, fr_years: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.fr_years = manifest.fr_years || {};
  } catch { /* first run */ }
  manifest.fr_years[year] = { file: outFile, count: compacted.length, updated_at: generatedAt };
  await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✓ manifest.fr_years.${year} updated`);
  console.log(`\nNext step: run \`node scripts/build-fr-index.mjs\` to rebuild fr-index.json`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
