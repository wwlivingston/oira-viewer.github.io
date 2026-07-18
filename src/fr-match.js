// FR matching helpers.
//
// Match precedence (highest to lowest confidence):
//   1. "rin"           — RIN appears in FR's regulation_id_numbers array, and
//                        an FR pub exists on/after DATE_COMPLETED. Authoritative.
//   2. "oira-reported" — OIRA's own DATE_PUBLISHED field is populated and >= DATE_COMPLETED.
//                        High confidence but only carries a date (no doc #, no URL).
//   3. "title-fuzzy"   — Title similarity match within a temporal window,
//                        pre-computed server-side and looked up here. Includes
//                        a confidence score so the UI can render accordingly.
//   null               — No match; display "Not Available"; exclude from averages.

export const MATCH_KIND_RIN = "rin";
export const MATCH_KIND_OIRA = "oira-reported";
export const MATCH_KIND_FUZZY = "title-fuzzy";

/** Stable identity for an OIRA rule row. Must match the dedup key used in App.jsx. */
export function ruleKey(rule) {
  return `${rule.RIN}|${rule.DATE_RECEIVED}|${rule.DATE_COMPLETED}|${rule.STAGE}`;
}

/** Layer 1: authoritative RIN-based match. Same semantics as before. */
export function matchFrPub(rule, frIndex) {
  if (!rule || !rule.RIN || !rule.DATE_COMPLETED) return null;
  const candidates = frIndex[rule.RIN];
  if (!candidates || !candidates.length) return null;
  const cutoff = rule.DATE_COMPLETED;
  for (const c of candidates) {
    if (c.d && c.d >= cutoff) return { ...c, kind: MATCH_KIND_RIN };
  }
  return null;
}

/** Days between DATE_COMPLETED and matched FR pub date. */
export function daysToFr(rule, frMatch) {
  if (!frMatch || !frMatch.d || !rule.DATE_COMPLETED) return null;
  const d = Math.round((new Date(frMatch.d) - new Date(rule.DATE_COMPLETED)) / 864e5);
  return isNaN(d) ? null : d;
}

/**
 * Enrich a rule with FR fields, cascading through the three match layers.
 *
 * @param {Object} rule
 * @param {Object} frIndex        - RIN → sorted FR pubs
 * @param {Object} fuzzyMatches   - { ruleKey → { d, n, t, u, score } }
 */
export function enrichWithFr(rule, frIndex, fuzzyMatches = {}) {
  // Layer 1: RIN match
  let m = matchFrPub(rule, frIndex);

  // Layer 2: OIRA-reported DATE_PUBLISHED, only if it's on/after completion
  if (!m && rule.DATE_COMPLETED && rule.DATE_PUBLISHED && rule.DATE_PUBLISHED >= rule.DATE_COMPLETED) {
    m = {
      d: rule.DATE_PUBLISHED,
      n: null, t: null, u: null,
      kind: MATCH_KIND_OIRA,
    };
  }

  // Layer 3: pre-computed fuzzy title match
  if (!m) {
    const fm = fuzzyMatches[ruleKey(rule)];
    if (fm) m = { ...fm, kind: MATCH_KIND_FUZZY };
  }

  return {
    ...rule,
    FR_PUB_DATE:     m ? m.d : null,
    FR_DOC_NUMBER:   m ? m.n : null,
    FR_TYPE:         m ? m.t : null,
    FR_URL:          m ? m.u : null,
    FR_MATCH_KIND:   m ? m.kind : null,
    FR_MATCH_SCORE:  m && m.score !== undefined ? m.score : null,
    DAYS_TO_FR:      daysToFr(rule, m),
  };
}
