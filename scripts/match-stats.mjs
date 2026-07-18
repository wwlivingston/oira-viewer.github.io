#!/usr/bin/env node
// scripts/match-stats.mjs
//
// Prints match-rate diagnostics: overall, by match kind, by stage, and (optionally)
// by year. Run it before and after tuning the fuzzy thresholds to see impact.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "public", "data");

function ruleKey(r) {
  return `${r.RIN}|${r.DATE_RECEIVED}|${r.DATE_COMPLETED}|${r.STAGE}`;
}

async function loadJson(name) {
  return JSON.parse(await fs.readFile(path.join(DATA_DIR, name), "utf8"));
}

function findRinMatch(rule, frIndex) {
  if (!rule.RIN || !rule.DATE_COMPLETED) return null;
  const cs = frIndex[rule.RIN] || [];
  for (const c of cs) if (c.d && c.d >= rule.DATE_COMPLETED) return c;
  return null;
}

function classifyRule(rule, frIndex, fuzzyMatches) {
  if (findRinMatch(rule, frIndex)) return "rin";
  if (rule.DATE_COMPLETED && rule.DATE_PUBLISHED && rule.DATE_PUBLISHED >= rule.DATE_COMPLETED) return "oira-reported";
  if (fuzzyMatches[ruleKey(rule)]) return "title-fuzzy";
  return "not-available";
}

async function main() {
  const frIndex = (await loadJson("fr-index.json").catch(() => ({ rins: {} }))).rins || {};
  const fuzzy = (await loadJson("fr-fuzzy-matches.json").catch(() => ({ matches: {} }))).matches || {};

  const files = (await fs.readdir(DATA_DIR)).filter((f) => /^completed-(\d{4}|ytd|30d)\.json$/.test(f));
  const seen = new Set();
  const rules = [];
  for (const f of files) {
    const j = JSON.parse(await fs.readFile(path.join(DATA_DIR, f), "utf8"));
    for (const r of j.rules || []) {
      const k = ruleKey(r);
      if (seen.has(k)) continue;
      seen.add(k);
      rules.push(r);
    }
  }

  const counts = { total: rules.length, rin: 0, "oira-reported": 0, "title-fuzzy": 0, "not-available": 0 };
  const byStage = {};
  const byYear = {};

  for (const r of rules) {
    const k = classifyRule(r, frIndex, fuzzy);
    counts[k]++;
    const s = r.STAGE || "(unknown)";
    byStage[s] = byStage[s] || { total: 0, rin: 0, "oira-reported": 0, "title-fuzzy": 0, "not-available": 0 };
    byStage[s].total++;
    byStage[s][k]++;
    const y = (r.DATE_COMPLETED || "").slice(0, 4) || "(unknown)";
    byYear[y] = byYear[y] || { total: 0, matched: 0 };
    byYear[y].total++;
    if (k !== "not-available") byYear[y].matched++;
  }

  const matched = counts.rin + counts["oira-reported"] + counts["title-fuzzy"];
  const pct = (n) => `${((n / counts.total) * 100).toFixed(1)}%`;
  const bar = (n, max = 40) => "█".repeat(Math.round((n / counts.total) * max));

  console.log(`\nOverall match rate: ${((matched / counts.total) * 100).toFixed(1)}% (${matched}/${counts.total})\n`);
  console.log(`Breakdown by match kind:`);
  console.log(`  rin           ${bar(counts.rin).padEnd(40)} ${counts.rin.toString().padStart(6)}  ${pct(counts.rin)}`);
  console.log(`  oira-reported ${bar(counts["oira-reported"]).padEnd(40)} ${counts["oira-reported"].toString().padStart(6)}  ${pct(counts["oira-reported"])}`);
  console.log(`  title-fuzzy   ${bar(counts["title-fuzzy"]).padEnd(40)} ${counts["title-fuzzy"].toString().padStart(6)}  ${pct(counts["title-fuzzy"])}`);
  console.log(`  not-available ${bar(counts["not-available"]).padEnd(40)} ${counts["not-available"].toString().padStart(6)}  ${pct(counts["not-available"])}`);

  console.log(`\nBy STAGE:`);
  const stages = Object.entries(byStage).sort((a, b) => b[1].total - a[1].total);
  console.log("  " + "STAGE".padEnd(30) + " total   rin  oira  fuzzy   N/A   match%");
  for (const [stage, s] of stages) {
    const m = s.rin + s["oira-reported"] + s["title-fuzzy"];
    const rate = ((m / s.total) * 100).toFixed(0) + "%";
    console.log(
      "  " + stage.padEnd(30) +
      s.total.toString().padStart(6) +
      s.rin.toString().padStart(6) +
      s["oira-reported"].toString().padStart(6) +
      s["title-fuzzy"].toString().padStart(7) +
      s["not-available"].toString().padStart(6) +
      rate.padStart(9)
    );
  }

  console.log(`\nBy YEAR:`);
  const years = Object.entries(byYear).sort();
  for (const [y, v] of years) {
    const rate = ((v.matched / v.total) * 100).toFixed(0) + "%";
    console.log(`  ${y}  ${v.matched.toString().padStart(5)}/${v.total.toString().padEnd(5)}  ${rate}`);
  }
}

main().catch((err) => { console.error(err); process.exit(2); });
