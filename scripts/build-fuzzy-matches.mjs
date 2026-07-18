#!/usr/bin/env node
// scripts/build-fuzzy-matches.mjs
//
// For every OIRA completed review that failed to match by RIN AND has no
// usable OIRA DATE_PUBLISHED, attempt a title-similarity match against FR
// documents published within a temporal window after the OIRA completion date.
//
// Runs once per day (nightly, after build-fr-index.mjs) or on manual backfill.
// Output: public/data/fr-fuzzy-matches.json — a map from OIRA rule key to
// the matched FR pub with a confidence score. The client reads this file and
// falls back to it after RIN + OIRA-reported layers fail.
//
// Match algorithm:
//   1. Tokenize both titles (lowercase, strip punctuation, drop stopwords + tokens <4 chars)
//   2. Filter FR docs to publication_date in [DATE_COMPLETED, DATE_COMPLETED + WINDOW_DAYS]
//   3. Compute a hybrid similarity score:
//        - jaccard = |A ∩ B| / |A ∪ B|
//        - coverage = |A ∩ B| / min(|A|, |B|)     (rewards short-in-long containment)
//   4. Accept the top scorer if it clears MIN_JACCARD or (MIN_COVERAGE with |A ∩ B| ≥ MIN_OVERLAP)
//
// Thresholds are conservative — better a Not Available than a false match.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isAdministrativeFollowup } from "./fr-filters.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

// ────────── Tunables ──────────
const WINDOW_DAYS  = 180;   // FR pub must be within this many days after OIRA completion
const MIN_JACCARD  = 0.35;  // OR
const MIN_COVERAGE = 0.65;  //   coverage AND
const MIN_OVERLAP  = 3;     //   at least this many tokens in common
const MIN_TOKENS   = 3;     // skip rules/docs with too few meaningful tokens

// Common stopwords stripped before matching. Kept short — extending it further
// mostly hurts recall for regulations with common domain words in their titles.
const STOPWORDS = new Set([
  "the","and","for","from","that","this","with","under","upon","into","also",
  "such","other","must","shall","would","which","were","been","being","their",
  "these","those","there","when","where","what","some","only","more","than",
  "then","them","they","have","has","had","not","but","was","are","its","per",
  "certain","related","proposed","final","rule","notice","new","act","law",
  "amendments","amendment","amended","amending","revisions","revision","revised",
  "modification","modifications","update","updates","updated","technical",
  "correction","corrections","extension","period","comment","comments","request",
  "requirements","requirement","provisions","provision","implementation",
  "regarding","concerning","related","regarding","subject","reopening","reopen",
]);

function tokenize(str) {
  if (!str) return new Set();
  return new Set(
    str.toLowerCase()
       .replace(/[^\w\s]/g, " ")
       .split(/\s+/)
       .filter((t) => t.length >= 4 && !STOPWORDS.has(t))
  );
}

function similarity(aSet, bSet) {
  if (!aSet.size || !bSet.size) return { jaccard: 0, coverage: 0, overlap: 0 };
  let overlap = 0;
  for (const t of aSet) if (bSet.has(t)) overlap++;
  const union = aSet.size + bSet.size - overlap;
  const jaccard = overlap / union;
  const coverage = overlap / Math.min(aSet.size, bSet.size);
  return { jaccard, coverage, overlap };
}

async function loadOiraRules() {
  const files = (await fs.readdir(DATA_DIR)).filter((f) =>
    /^completed-(\d{4}|ytd|30d)\.json$/.test(f)
  );
  const seen = new Set();
  const rules = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
    for (const r of j.rules || []) {
      const key = `${r.RIN}|${r.DATE_RECEIVED}|${r.DATE_COMPLETED}|${r.STAGE}`;
      if (seen.has(key)) continue;
      seen.add(key);
      rules.push(r);
    }
  }
  return rules;
}

async function loadFrDocs() {
  const files = (await fs.readdir(DATA_DIR))
    .filter((f) => /^fr-\d{4}\.json$/.test(f))
    .sort();
  const docs = [];
  let excluded = 0;
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
    for (const d of j.documents || []) {
      // Skip administrative follow-ups (extensions, corrections, …) so they
      // can't be picked as fuzzy matches for a primary rulemaking review.
      if (isAdministrativeFollowup(d)) { excluded++; continue; }
      docs.push(d);
    }
  }
  if (excluded) console.log(`  (excluded ${excluded} administrative follow-up docs from candidate pool)`);
  // Sort ascending by publication_date so we can slice temporal windows fast.
  docs.sort((a, b) => (a.d || "").localeCompare(b.d || ""));
  return docs;
}

function addDaysISO(iso, days) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function firstIndexAtOrAfter(sortedDocs, dateStr) {
  // Binary search for the first index with d >= dateStr.
  let lo = 0, hi = sortedDocs.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if ((sortedDocs[mid].d || "") < dateStr) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

async function main() {
  console.log("Loading OIRA rules and FR docs...");
  const [oiraRules, frDocs] = await Promise.all([loadOiraRules(), loadFrDocs()]);
  console.log(`  OIRA completed rules: ${oiraRules.length}`);
  console.log(`  FR docs indexed:      ${frDocs.length}`);

  // Load fr-index.json to know which OIRA rules ALREADY have a RIN match
  // and can be skipped (Layer 1 already covers them).
  let frIndex = {};
  try {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, "fr-index.json"), "utf8"));
    frIndex = j.rins || {};
  } catch {
    console.log("  (no fr-index.json — will run fuzzy on everything)");
  }

  // Pre-tokenize FR titles once. Store [{n, d, t, u, tokens}, ...]
  console.log("Tokenizing FR titles...");
  const frTokenized = frDocs.map((d) => ({
    n: d.n, d: d.d, t: d.t, u: d.u, l: d.l,
    tokens: tokenize(d.l),
  }));

  console.log(`Running fuzzy match (window ${WINDOW_DAYS} days)...`);
  const matches = {};
  let skippedRinCovered = 0;
  let skippedOiraCovered = 0;
  let skippedNoDate = 0;
  let skippedShortTitle = 0;
  let attempted = 0;
  let matched = 0;

  const t0 = Date.now();
  for (const r of oiraRules) {
    if (!r.DATE_COMPLETED) { skippedNoDate++; continue; }

    // Skip if RIN match will succeed
    if (r.RIN && frIndex[r.RIN]) {
      const hit = frIndex[r.RIN].some((c) => c.d && c.d >= r.DATE_COMPLETED);
      if (hit) { skippedRinCovered++; continue; }
    }

    // Skip if OIRA-reported DATE_PUBLISHED will succeed
    if (r.DATE_PUBLISHED && r.DATE_PUBLISHED >= r.DATE_COMPLETED) {
      skippedOiraCovered++;
      continue;
    }

    const ruleTokens = tokenize(r.TITLE);
    if (ruleTokens.size < MIN_TOKENS) { skippedShortTitle++; continue; }

    attempted++;
    const startDate = r.DATE_COMPLETED;
    const endDate = addDaysISO(r.DATE_COMPLETED, WINDOW_DAYS);
    const startIdx = firstIndexAtOrAfter(frTokenized, startDate);

    let best = null;
    for (let i = startIdx; i < frTokenized.length; i++) {
      const doc = frTokenized[i];
      if (!doc.d || doc.d > endDate) break;
      if (doc.tokens.size < MIN_TOKENS) continue;

      const s = similarity(ruleTokens, doc.tokens);
      const passes =
        s.jaccard >= MIN_JACCARD ||
        (s.coverage >= MIN_COVERAGE && s.overlap >= MIN_OVERLAP);
      if (!passes) continue;

      // Composite score to break ties — favor high coverage AND high jaccard
      const score = 0.6 * s.jaccard + 0.4 * s.coverage;
      if (!best || score > best.score) {
        best = {
          n: doc.n, d: doc.d, t: doc.t, u: doc.u,
          score: Math.round(score * 1000) / 1000,
        };
      }
    }

    if (best) {
      const key = `${r.RIN}|${r.DATE_RECEIVED}|${r.DATE_COMPLETED}|${r.STAGE}`;
      matches[key] = best;
      matched++;
    }
  }
  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

  console.log(`\nMatch summary:`);
  console.log(`  Skipped (RIN match already covers): ${skippedRinCovered}`);
  console.log(`  Skipped (OIRA-reported covers):     ${skippedOiraCovered}`);
  console.log(`  Skipped (no completion date):       ${skippedNoDate}`);
  console.log(`  Skipped (title too short):          ${skippedShortTitle}`);
  console.log(`  Attempted fuzzy match:              ${attempted}`);
  console.log(`  Fuzzy matches accepted:             ${matched} (${(matched / Math.max(attempted, 1) * 100).toFixed(1)}%)`);
  console.log(`  Elapsed:                            ${elapsed}s`);

  const output = {
    generated_at: new Date().toISOString(),
    thresholds: { WINDOW_DAYS, MIN_JACCARD, MIN_COVERAGE, MIN_OVERLAP, MIN_TOKENS },
    match_count: matched,
    matches,
  };
  const outPath = path.join(DATA_DIR, "fr-fuzzy-matches.json");
  await fs.writeFile(outPath + ".tmp", JSON.stringify(output));
  await fs.rename(outPath + ".tmp", outPath);
  console.log(`\n✓ Wrote fr-fuzzy-matches.json`);

  // Update manifest
  const manifestPath = path.join(DATA_DIR, "manifest.json");
  let manifest = { generated_at: new Date().toISOString(), sources: {}, historical: {}, fr_years: {} };
  try {
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.sources = manifest.sources || {};
  } catch { /* first run */ }
  manifest.sources["fr-fuzzy-matches"] = {
    file: "fr-fuzzy-matches.json",
    match_count: matched,
    updated_at: new Date().toISOString(),
  };
  await fs.writeFile(manifestPath + ".tmp", JSON.stringify(manifest, null, 2) + "\n");
  await fs.rename(manifestPath + ".tmp", manifestPath);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(2);
});
