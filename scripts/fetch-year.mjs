#!/usr/bin/env node
// scripts/fetch-year.mjs YEAR
//
// One-shot fetch of a single historical year (2017–2025).
// Writes public/data/completed-<year>.json and updates manifest.json.
//
// Run these once during backfill, then commit. The files don't change again
// after their year is closed (2017–2024 are permanent; 2025 becomes permanent
// on Jan 1, 2026).
//
// Usage: node scripts/fetch-year.mjs 2020
// Or via npm: npm run fetch:year -- 2020

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRules } from "./xml-to-json.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

const BASE = "https://www.reginfo.gov/public/do/XMLViewFileAction?f=";
const UA = "oira-viewer/1.0 (github.com/your-org/oira-viewer; historical backfill)";
const TIMEOUT_MS = 60_000;

const year = parseInt(process.argv[2], 10);
if (!year || year < 2017 || year > new Date().getFullYear()) {
  console.error("Usage: node scripts/fetch-year.mjs YEAR");
  console.error("YEAR must be between 2017 and the current year.");
  process.exit(1);
}

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

async function writeAtomic(filepath, content) {
  const tmp = `${filepath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filepath);
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const url = `${BASE}EO_RULE_COMPLETED_${year}.xml`;
  console.log(`Fetching ${url}`);

  const xml = await fetchWithTimeout(url);
  const rules = parseRules(xml);
  if (!rules.length) {
    console.error(`Parsed 0 rules for ${year}. Not writing an empty file.`);
    process.exit(2);
  }

  const generatedAt = new Date().toISOString();
  const payload = {
    source: `EO_RULE_COMPLETED_${year}.xml`,
    year,
    generated_at: generatedAt,
    count: rules.length,
    rules,
  };

  const outFile = `completed-${year}.json`;
  await writeAtomic(path.join(DATA_DIR, outFile), JSON.stringify(payload, null, 2) + "\n");
  console.log(`✓ Wrote ${outFile} (${rules.length} rules)`);

  // Update manifest.historical
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  let manifest = { generated_at: generatedAt, sources: {}, historical: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.historical = manifest.historical || {};
  } catch { /* first run */ }
  manifest.historical[year] = { file: outFile, count: rules.length, updated_at: generatedAt };
  await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`✓ manifest.historical.${year} updated`);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
