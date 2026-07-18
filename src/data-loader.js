// Loads pre-baked JSON snapshots from public/data. Everything the browser
// consumes comes from here — reginfo.gov is never contacted at runtime.
//
// The nightly cron in scripts/fetch-daily.mjs (and the one-shot
// scripts/fetch-year.mjs) is what actually talks to reginfo. This file just
// reads what those scripts wrote.

import { AGENCY_MAP } from "./agency-map.js";

// Vite exposes the deployment base path here. Works whether the site is
// served at "/" or at a subpath like "/oira/".
const BASE = import.meta.env.BASE_URL || "/";
const dataUrl = (name) => `${BASE}data/${name}`.replace(/\/\/+/g, "/");

// Simple in-memory cache. Snapshots are immutable within a page load.
const cache = new Map();

async function loadJson(name) {
  if (cache.has(name)) return cache.get(name);
  const res = await fetch(dataUrl(name), { cache: "force-cache" });
  if (!res.ok) throw new Error(`Failed to load ${name}: HTTP ${res.status}`);
  const json = await res.json();
  cache.set(name, json);
  return json;
}

// Dedup key must match the parser's (RIN | received | completed | stage).
function dedup(rules) {
  const seen = new Set();
  return rules.filter((r) => {
    const k = `${r.RIN}|${r.DATE_RECEIVED}|${r.DATE_COMPLETED}|${r.STAGE}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function loadManifest() {
  return loadJson("manifest.json");
}

export async function loadAgencies() {
  try {
    const j = await loadJson("agencies.json");
    // agencies.json takes precedence, then hardcoded fallback fills gaps.
    return { ...AGENCY_MAP, ...(j.agencies || {}) };
  } catch {
    return { ...AGENCY_MAP };
  }
}

export async function loadUnderReview() {
  const j = await loadJson("under-review.json");
  return { rules: j.rules || [], generatedAt: j.generated_at };
}

// YTD + last-30-days, merged & deduped. This is the "default" completed view.
export async function loadCompletedBase() {
  const [ytd, d30] = await Promise.all([
    loadJson("completed-ytd.json"),
    loadJson("completed-30d.json").catch(() => ({ rules: [] })), // 30d is nice-to-have
  ]);
  const merged = dedup([...(ytd.rules || []), ...(d30.rules || [])]);
  return { rules: merged, generatedAt: ytd.generated_at };
}

// Historical CY snapshots. Frozen once a year rolls over.
export async function loadHistoricalYears(years) {
  if (!years || years.length === 0) return [];
  const results = await Promise.allSettled(
    years.map((y) => loadJson(`completed-${y}.json`))
  );
  const rules = [];
  const failed = [];
  results.forEach((r, i) => {
    if (r.status === "fulfilled") rules.push(...(r.value.rules || []));
    else failed.push(years[i]);
  });
  if (failed.length) {
    console.warn(`Missing historical year files: ${failed.join(", ")}`);
  }
  return rules;
}

// Convenience: fetch base + a set of historical years, all deduped together.
export async function loadCompletedWithYears(years = []) {
  const [base, historical] = await Promise.all([
    loadCompletedBase(),
    loadHistoricalYears(years),
  ]);
  return {
    rules: dedup([...base.rules, ...historical]),
    generatedAt: base.generatedAt,
    yearsLoaded: new Set(years),
  };
}

/**
 * Discover all historical years that have committed data files, from the
 * manifest. Preferred over hardcoding a year range on the client — this way
 * the frontend automatically picks up whatever the backfill has produced
 * (2017-present, 2017-present, whatever).
 */
export async function loadAvailableHistoricalYears() {
  try {
    const m = await loadManifest();
    return Object.keys(m?.historical || {})
      .map((y) => parseInt(y, 10))
      .filter((y) => !isNaN(y))
      .sort((a, b) => a - b);
  } catch {
    return [];
  }
}

/**
 * Load the RIN → FR pubs index built by scripts/build-fr-index.mjs.
 * Returns the rins map ({}), or an empty map if the file is missing —
 * without the index, FR columns will show "Not Available" everywhere and
 * the rest of the app keeps working.
 */
export async function loadFrIndex() {
  try {
    const j = await loadJson("fr-index.json");
    return j.rins || {};
  } catch {
    return {};
  }
}

/**
 * Load the pre-computed fuzzy title matches built by
 * scripts/build-fuzzy-matches.mjs. Returns the matches map, or {} if
 * unavailable (graceful degradation — Layer 3 just becomes a no-op).
 */
export async function loadFuzzyMatches() {
  try {
    const j = await loadJson("fr-fuzzy-matches.json");
    return j.matches || {};
  } catch {
    return {};
  }
}
