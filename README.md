# OIRA Regulatory Review Viewer

Static site for browsing rules currently under OIRA review and completed reviews, correlated with their Federal Register publications. Nightly snapshots are committed to the repo so the browser never has to hit reginfo.gov or the FR API at runtime — no CORS proxies, no rate limits, no live dependency.

## Architecture

```
Browser                          Static host (Vercel/Netlify/Pages/…)
────────  fetch same-origin JSON  ─────────────────────────────────
App.jsx  ────────────────►  /data/manifest.json
                            /data/under-review.json
                            /data/completed-ytd.json
                            /data/completed-30d.json
                            /data/agencies.json
                            /data/completed-2017.json … completed-<current>.json
                            /data/fr-2017.json … fr-<current>.json
                            /data/fr-index.json          ◄── the RIN→FR-pubs lookup
                                       ▲
                                       │ committed nightly by GitHub Actions
                                       │
                              scripts/fetch-daily.mjs    (nightly cron)
                              scripts/fetch-year.mjs YEAR
                              scripts/fetch-fr-year.mjs YEAR
                              scripts/build-fr-index.mjs
                                       │
                                       ▼
                             reginfo.gov + federalregister.gov
```

The client only ever reads static JSON. reginfo.gov is hit at most once per feed per day. The Federal Register API is hit at most twice per day during normal ops (once for yesterday's docs, once for the daily under-review/completed feeds — the second one is reginfo, not FR).

## The FR correlation

Each completed OIRA review has a **RIN** (Regulation Identifier Number) and a **DATE_COMPLETED**. The FR data pipeline builds an index: `RIN → sorted list of FR pubs`. At render time, the browser looks up each rule's RIN and picks the *earliest* FR publication with `publication_date >= DATE_COMPLETED`.

This correctly handles:

- **RINs with no FR match** (guidance docs, withdrawn rules, etc.) → shown as "Not Available" in the table, excluded from the FR-days average.
- **RINs used multiple times** — e.g. proposed rule → final rule for the same RIN. Each OIRA review row picks the FR pub that follows *its own* completion date.
- **Same-day match** — an FR pub on the same date as OIRA completion is treated as "slightly later" per spec.

## Setup (fresh checkout)

```bash
git clone <your-repo> oira-viewer
cd oira-viewer
npm install
```

### 1. Backfill historical years (one-time)

Reginfo XMLs and FR API both go back to 2017. Full backfill is ~15 minutes and only needs to happen once.

Local option (single machine):

```bash
npm run backfill:oira    # ~30s per year × 30 years = a few minutes
npm run backfill:fr      # ~30s per year × 30 years = ~15 minutes; also builds fr-index.json
```

CI option (recommended — avoids local rate variance):

```
Actions → Backfill historical data → Run workflow
  mode: all
  start_year: 2017
```

This writes `public/data/completed-<year>.json` and `public/data/fr-<year>.json` for every year 2017–present, then builds `fr-index.json`. Commit them once and forget them — historical files don't change after their year closes.

### 2. First daily fetch

```bash
npm run fetch:daily
```

Writes: `under-review.json`, `completed-ytd.json`, `completed-30d.json`, `agencies.json`, `fr-<current-year>.json` (yesterday's docs merged in), `fr-index.json` (rebuilt), and `manifest.json`.

### 3. Preview locally

```bash
npm run dev  # localhost:5173
```

### 4. Deploy

Push to a static host. Point build at `npm run build`, publish `dist/`.

### 5. Enable the nightly cron

`.github/workflows/daily.yml` is already wired up. Cron time is **12:00 UTC** (~08:00 ET), comfortably after the Federal Register's 06:00 ET publication window so yesterday's docs are always caught.

## What runs when

| Trigger | Script(s) | Files written |
|---|---|---|
| Nightly cron (12:00 UTC) | `fetch-daily.mjs` | `under-review.json`, `completed-ytd.json`, `completed-30d.json`, `agencies.json`, `fr-<current-year>.json` (merged), `fr-index.json` (rebuilt), `manifest.json` |
| Manual: single OIRA year | `fetch-year.mjs YEAR` | `completed-<YEAR>.json`, `manifest.json` |
| Manual: single FR year | `fetch-fr-year.mjs YEAR` | `fr-<YEAR>.json`, `manifest.json` |
| Manual: rebuild index | `build-fr-index.mjs` | `fr-index.json`, `manifest.json` |
| Manual: backfill everything | `Backfill historical data` workflow | All of the above for years 2017–present |

**Never overwritten by nightly:** historical `completed-<year>.json` and `fr-<year>.json` files for closed years. The nightly job only touches the *current* year's `fr-<year>.json` (merging yesterday's docs into it).

## Fail-safe behavior

- Every JSON write is atomic (`.tmp` → `rename`).
- If a **required** OIRA source (`under-review` or `completed-ytd`) fails, the workflow exits non-zero and does not commit — yesterday's data stays live.
- If the **FR pipeline** fails (network hiccup, API down), the OIRA data still commits. `fr-index.json` becomes stale but no worse; the client shows correct data for RINs already indexed, and "Not Available" for anything new.
- To wire up alerts on failure, uncomment the Slack step in `.github/workflows/daily.yml`.

## FR API details

- Base: `https://www.federalregister.gov/api/v1/documents.json`
- Bulk backfill queries by publication date range (~90 pages of 1000 docs per year), filters response client-side to docs with RINs. This is much more efficient than querying by RIN one at a time (~24k unique RINs would be 24k API calls; date-range is ~2700 calls for 30 years).
- Fields requested: `document_number, publication_date, regulation_id_numbers, type, html_url, title` — keeps response size small.
- Rate limiting: default 250ms delay between calls, exponential backoff on HTTP 429. Anonymous API allows ~1000 req/hr which is well above our ceiling.

## Customizing

- **Agency name overrides:** edit `AGENCY_MAP` in `src/agency-map.js`. This is the fallback if `agencies.json` is missing or stale.
- **Department groupings** (which sub-agency codes roll up under "Department of Agriculture", etc.): edit `AGENCY_GROUPS` in `src/agency-map.js`.
- **Historical year range:** the client discovers available years automatically from `manifest.historical`. To include a year, just make sure `completed-<year>.json` exists. To exclude, delete the file (and rebuild the manifest).

## Files worth knowing about

```
src/
├── App.jsx                     the viewer
├── data-loader.js              all data fetches go through here
├── fr-match.js                 RIN→FR-pub matching helpers
├── agency-map.js               fallback agency names + department groupings
├── main.jsx
└── components/MultiAgencySelect.jsx

scripts/
├── xml-to-json.mjs             reginfo XML parser
├── fr-api.mjs                  Federal Register API client (paginated, retry, rate-limited)
├── fetch-daily.mjs             the nightly cron entry point
├── fetch-year.mjs YEAR         one-shot OIRA yearly backfill (2017+)
├── fetch-fr-year.mjs YEAR      one-shot FR yearly backfill (2017+)
└── build-fr-index.mjs          derive fr-index.json from all fr-<year>.json files

public/data/                    committed JSON snapshots (this directory grows over time)

.github/workflows/
├── daily.yml                   nightly cron
└── backfill.yml                manual dispatch: OIRA-all, FR-all, or a single year
```

## Upstream endpoints

- **reginfo.gov XMLs:** `https://www.reginfo.gov/public/do/XMLViewFileAction?f=<file>` where `<file>` is `EO_RULES_UNDER_REVIEW.xml`, `EO_RULE_COMPLETED_YTD.xml`, `EO_RULE_COMPLETED_30_DAYS.xml`, `EO_RULE_COMPLETED_<YYYY>.xml`, or `AGY_AGENCY_LIST.xml`.
- **FR API:** `https://www.federalregister.gov/api/v1/documents.json` with `conditions[publication_date][gte|lte]` filters.
