// scripts/fr-api.mjs
//
// Shared client for the public Federal Register API (federalregister.gov/api/v1).
// - Paginates through results (1000 docs/page maximum).
// - Rate-limits itself with a configurable delay between calls.
// - Retries on transient failures with exponential backoff.
// - Filters response fields at the API level to keep payloads small.
//
// FR API notes:
//   - Default anonymous rate limit is ~1000 req/hr per IP.
//   - "conditions[publication_date][gte]" and "[lte]" bound a date range.
//   - "regulation_id_numbers" comes back as an array (a single FR doc can list
//     multiple RINs, and a single RIN can appear across multiple FR docs).
//   - We request only the fields we care about to shrink the payload.

import { setTimeout as sleep } from "node:timers/promises";

const BASE = "https://www.federalregister.gov/api/v1";
const UA = "oira-viewer/1.0 (github.com/wwlivingston/oira-viewer; OIRA-FR correlation)";
const FIELDS = [
  "document_number",
  "publication_date",
  "regulation_id_numbers",
  "type",
  "subtype",           // sometimes populated with "Extension", "Correction", etc.
  "action",            // "Proposed rule.", "Proposed rule; extension of comment period.", "Final rule; correction.", ...
  "html_url",
  "title",
];

const DEFAULT_DELAY_MS = 250;
const REQUEST_TIMEOUT_MS = 45_000;

async function fetchOnce(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, Accept: "application/json" },
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (res.status === 429) return { __rateLimited: true, retryAfter: parseInt(res.headers.get("retry-after") || "10", 10) };
  if (res.status === 404) return { results: [], total_pages: 0 };
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return await res.json();
}

async function fetchWithRetry(url, { retries = 4, log = console.log } = {}) {
  let attempt = 0;
  while (attempt <= retries) {
    try {
      const result = await fetchOnce(url);
      if (result.__rateLimited) {
        const wait = Math.max(result.retryAfter * 1000, 5000 * Math.pow(2, attempt));
        log(`  rate limited (attempt ${attempt + 1}), waiting ${Math.round(wait / 1000)}s…`);
        await sleep(wait);
        attempt++;
        continue;
      }
      return result;
    } catch (err) {
      if (attempt >= retries) throw err;
      const wait = 1000 * Math.pow(2, attempt);
      log(`  request failed (${err.message}), retrying in ${wait / 1000}s…`);
      await sleep(wait);
      attempt++;
    }
  }
  throw new Error(`Exhausted retries for ${url}`);
}

/**
 * Fetch every FR document within a publication_date range (inclusive).
 * Returns an array of documents with the fields listed in FIELDS.
 */
export async function fetchDocumentsByDateRange(from, to, { delay = DEFAULT_DELAY_MS, log = console.log } = {}) {
  const results = [];
  let page = 1;
  const perPage = 1000;

  while (true) {
    const params = new URLSearchParams();
    params.append("conditions[publication_date][gte]", from);
    params.append("conditions[publication_date][lte]", to);
    params.append("per_page", String(perPage));
    params.append("page", String(page));
    FIELDS.forEach((f) => params.append("fields[]", f));
    const url = `${BASE}/documents.json?${params.toString()}`;

    log(`  page ${page}: fetching ${from}..${to}`);
    const data = await fetchWithRetry(url, { log });
    const docs = data.results || [];
    results.push(...docs);
    const totalPages = data.total_pages || 1;
    log(`    got ${docs.length} docs (running total ${results.length}, page ${page}/${totalPages})`);

    if (page >= totalPages || docs.length < perPage) break;
    page++;
    await sleep(delay);
  }
  return results;
}

/**
 * Fetch every FR document that lists a given RIN in its regulation_id_numbers.
 *
 * Distinct from fetchDocumentsByDateRange: that endpoint returns a *listing*
 * driven by publication_date and sometimes omits RINs even when they exist in
 * the doc metadata. This endpoint is driven by FR's authoritative RIN→docs
 * index and returns the correct linkage. Slower per-doc but truthful.
 *
 * Returns raw FR documents (same fields as fetchDocumentsByDateRange).
 */
export async function fetchDocumentsByRin(rin, { delay = DEFAULT_DELAY_MS, log = () => {} } = {}) {
  const results = [];
  let page = 1;
  const perPage = 100;

  while (true) {
    const params = new URLSearchParams();
    params.append("conditions[regulation_id_number]", rin);
    params.append("per_page", String(perPage));
    params.append("page", String(page));
    FIELDS.forEach((f) => params.append("fields[]", f));
    const url = `${BASE}/documents.json?${params.toString()}`;

    const data = await fetchWithRetry(url, { log });
    const docs = data.results || [];
    results.push(...docs);
    const totalPages = data.total_pages || 1;

    if (page >= totalPages || docs.length < perPage) break;
    page++;
    await sleep(delay);
  }
  return results;
}

/**
 * Keep only documents that list at least one RIN. Any FR doc without a RIN can't
 * be matched to an OIRA review anyway.
 */
export function withRins(docs) {
  return docs.filter(
    (d) => Array.isArray(d.regulation_id_numbers) && d.regulation_id_numbers.length > 0
  );
}

/**
 * Compact a raw FR API document into the on-disk shape we store.
 * Short field names keep the on-disk JSON (and, later, the browser payload) small.
 *   n: document_number
 *   d: publication_date (YYYY-MM-DD)
 *   t: type (Rule / Proposed Rule / Notice / etc.)
 *   s: subtype (usually null, occasionally "Correction" / "Extension")
 *   a: action (structured sentence: "Proposed rule.", "Proposed rule; extension of comment period.", etc.)
 *   u: html_url
 *   l: title
 *   r: regulation_id_numbers (array)
 */
export function compact(doc) {
  return {
    n: doc.document_number,
    d: doc.publication_date,
    t: doc.type,
    s: doc.subtype,
    a: doc.action,
    u: doc.html_url,
    l: doc.title,
    r: doc.regulation_id_numbers,
  };
}
