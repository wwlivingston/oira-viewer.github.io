#!/usr/bin/env node
// scripts/fetch-daily.mjs
//
// Nightly ingest. Fetches from reginfo.gov exactly ONCE per source, plus
// yesterday's Federal Register docs from federalregister.gov.
//
// reginfo.gov:
//   - EO_RULES_UNDER_REVIEW.xml   → public/data/under-review.json
//   - EO_RULE_COMPLETED_YTD.xml   → public/data/completed-ytd.json
//   - EO_RULE_COMPLETED_30_DAYS.xml → public/data/completed-30d.json
//   - AGY_AGENCY_LIST.xml         → public/data/agencies.json
//
// federalregister.gov:
//   - Yesterday's documents  → merged into public/data/fr-<current-year>.json
//   - Rebuilds public/data/fr-index.json from all fr-<year>.json files
//
// Fail-safe: if a fetch or parse fails, the existing file is left alone
// (write to a tmp file first, only rename on successful validation).
//
// Exit code: 0 = at least under-review + YTD succeeded. Non-zero otherwise.
// Historical years live in fetch-year.mjs / fetch-fr-year.mjs — this script
// never overwrites them.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseRules, parseAgencies } from "./xml-to-json.mjs";
import { fetchDocumentsByDateRange, withRins, compact } from "./fr-api.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

const BASE = "https://www.reginfo.gov/public/do/XMLViewFileAction?f=";
const SOURCES = [
  { name: "under-review",   file: "EO_RULES_UNDER_REVIEW.xml",     out: "under-review.json",   parser: "rules",    required: true  },
  { name: "completed-ytd",  file: "EO_RULE_COMPLETED_YTD.xml",     out: "completed-ytd.json",  parser: "rules",    required: true  },
  { name: "completed-30d",  file: "EO_RULE_COMPLETED_30_DAYS.xml", out: "completed-30d.json",  parser: "rules",    required: false },
  { name: "agencies",       file: "AGY_AGENCY_LIST.xml",           out: "agencies.json",       parser: "agencies", required: false },
];

const UA = "oira-viewer/1.0 (github.com/your-org/oira-viewer; static-site snapshot job)";
const TIMEOUT_MS = 30_000;

async function fetchWithTimeout(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept": "application/xml, text/xml, */*" },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    if (!text.includes("<?xml") && !text.includes("<REGACT") && !text.includes("<AGENCY")) {
      throw new Error("response does not look like reginfo XML");
    }
    return text;
  } finally {
    clearTimeout(t);
  }
}

async function writeAtomic(filepath, content) {
  const tmp = `${filepath}.tmp`;
  await fs.writeFile(tmp, content, "utf8");
  await fs.rename(tmp, filepath);
}

async function processSource(src, generatedAt) {
  const url = BASE + src.file;
  console.log(`→ ${src.name}: fetching ${url}`);
  const xml = await fetchWithTimeout(url);

  let payload;
  if (src.parser === "rules") {
    const rules = parseRules(xml);
    if (!rules.length) throw new Error("parsed 0 rules");
    payload = { source: src.file, generated_at: generatedAt, count: rules.length, rules };
    console.log(`  parsed ${rules.length} rules`);
  } else {
    const agencies = parseAgencies(xml);
    const count = Object.keys(agencies).length;
    if (!count) throw new Error("parsed 0 agencies");
    payload = { source: src.file, generated_at: generatedAt, count, agencies };
    console.log(`  parsed ${count} agencies`);
  }

  const outPath = path.join(DATA_DIR, src.out);
  await writeAtomic(outPath, JSON.stringify(payload, null, 2) + "\n");
  console.log(`  wrote ${src.out}`);
  return { name: src.name, file: src.out, count: payload.count };
}

async function processFrDaily(generatedAt) {
  // Pull yesterday's FR docs. FR publishes at 06:00 ET; running this after ~08:00 ET
  // (12:00 UTC) reliably catches the fresh issue.
  const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  console.log(`\n→ FR daily: fetching documents for ${yesterday}`);

  const docs = await fetchDocumentsByDateRange(yesterday, yesterday);
  const withR = withRins(docs);
  const compacted = withR.map(compact);
  console.log(`  ${docs.length} FR docs, ${compacted.length} with RINs`);

  if (!compacted.length) {
    console.log(`  (nothing to merge; some days have no rulemaking docs — this is fine)`);
    return { name: "fr-daily", added: 0 };
  }

  // Merge into fr-<current-year>.json. Dedup by document_number.
  const yr = new Date(yesterday).getUTCFullYear();
  const yearFile = path.join(DATA_DIR, `fr-${yr}.json`);
  let existing = { source: "federalregister.gov", year: yr, generated_at: generatedAt, count: 0, documents: [] };
  try {
    existing = JSON.parse(await fs.readFile(yearFile, "utf8"));
  } catch { /* first day of a new year — create fresh */ }

  const seen = new Set((existing.documents || []).map((d) => d.n));
  let added = 0;
  for (const d of compacted) {
    if (!seen.has(d.n)) {
      existing.documents.push(d);
      seen.add(d.n);
      added++;
    }
  }
  existing.count = existing.documents.length;
  existing.generated_at = generatedAt;

  await writeAtomic(yearFile, JSON.stringify(existing) + "\n");
  console.log(`  merged ${added} new docs into fr-${yr}.json (total ${existing.count})`);
  return { name: "fr-daily", file: `fr-${yr}.json`, added, total: existing.count };
}

async function rebuildFrIndex(generatedAt) {
  console.log(`\n→ Rebuilding fr-index.json`);
  const files = (await fs.readdir(DATA_DIR)).filter((f) => /^fr-\d{4}\.json$/.test(f)).sort();
  if (!files.length) {
    console.log(`  no fr-<year>.json files present, skipping`);
    return null;
  }
  // Shell out to build-fr-index.mjs so we don't duplicate the exclusion logic.
  const { spawn } = await import("node:child_process");
  await new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.resolve(__dirname, "build-fr-index.mjs")], { stdio: "inherit" });
    p.on("close", (code) => code === 0 ? resolve() : reject(new Error(`build-fr-index exited ${code}`)));
  });
  // Read back the resulting file for manifest reporting.
  const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-index.json"), "utf8"));
  return { name: "fr-index", file: "fr-index.json", rin_count: j.rin_count, doc_count: j.doc_count };
}

async function rebuildFuzzyMatches(generatedAt) {
  console.log(`\n→ Rebuilding fr-fuzzy-matches.json`);
  // Re-use build-fuzzy-matches.mjs by spawning it as a child process. Doing it
  // inline would mean duplicating ~200 lines of tokenization/scoring logic;
  // the shell-out is cleaner and lets us test the builder independently.
  const { spawn } = await import("node:child_process");
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [path.resolve(__dirname, "build-fuzzy-matches.mjs")], {
      stdio: "inherit",
    });
    p.on("close", (code) => {
      if (code === 0) resolve({ name: "fr-fuzzy-matches", ok: true });
      else {
        console.error(`  build-fuzzy-matches exited ${code} — continuing`);
        resolve({ name: "fr-fuzzy-matches", ok: false });
      }
    });
  });
}

async function main() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const generatedAt = new Date().toISOString();

  const results = { ok: [], failed: [] };
  for (const src of SOURCES) {
    try {
      const r = await processSource(src, generatedAt);
      results.ok.push(r);
    } catch (err) {
      console.error(`✗ ${src.name} failed: ${err.message}`);
      results.failed.push({ name: src.name, required: src.required, error: err.message });
    }
  }

  // FR daily is optional — failure here should not block committing OIRA data.
  let frDaily = null;
  let frIndex = null;
  try {
    frDaily = await processFrDaily(generatedAt);
    // Enrich with authoritative RIN-scoped fetches for any OIRA RINs we haven't
    // seen yet. --only-missing keeps daily runs fast (typically <1 min).
    console.log(`\n→ Enriching FR data via RIN-scoped API (--only-missing)`);
    const { spawn } = await import("node:child_process");
    await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.resolve(__dirname, "fetch-fr-by-rin.mjs"), "--only-missing"], { stdio: "inherit" });
      p.on("close", () => resolve());  // non-fatal — proceed even if it fails
    });
    frIndex = await rebuildFrIndex(generatedAt);
    // Fuzzy matches depend on both the FR index AND the OIRA data being fresh,
    // so it runs last. It also depends on nothing external (pure compute over
    // committed files), so we don't need to guard it beyond the try/catch.
    await rebuildFuzzyMatches(generatedAt);
  } catch (err) {
    console.error(`✗ FR pipeline failed: ${err.message}`);
    results.failed.push({ name: "fr-daily", required: false, error: err.message });
  }

  // Merge with existing manifest so historical entries survive.
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  let manifest = { generated_at: generatedAt, sources: {}, historical: {}, fr_years: {} };
  try {
    const existing = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.historical = existing.historical || {};
    manifest.fr_years = existing.fr_years || {};
    manifest.sources = existing.sources || {};
  } catch { /* first run */ }
  manifest.generated_at = generatedAt;
  for (const r of results.ok) {
    manifest.sources[r.name] = { file: r.file, count: r.count, updated_at: generatedAt };
  }
  if (frDaily && frDaily.file) {
    const yr = new Date().getUTCFullYear();
    manifest.fr_years[yr] = { file: frDaily.file, count: frDaily.total, updated_at: generatedAt };
  }
  if (frIndex) {
    manifest.sources["fr-index"] = { file: frIndex.file, rin_count: frIndex.rin_count, doc_count: frIndex.doc_count, updated_at: generatedAt };
  }
  await writeAtomic(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
  console.log(`\n✓ manifest updated (${results.ok.length} sources ok, ${results.failed.length} failed)`);

  // Fail the workflow if a required source failed — this prevents committing
  // a broken snapshot and lets the alert path kick in.
  const requiredFail = results.failed.filter((f) => f.required);
  if (requiredFail.length) {
    console.error(`\nRequired sources failed: ${requiredFail.map((f) => f.name).join(", ")}`);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
