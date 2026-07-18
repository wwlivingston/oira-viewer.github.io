// scripts/fr-filters.mjs
//
// A shared "should this FR doc count as a primary rulemaking action?" filter,
// used by both build-fr-index.mjs and build-fuzzy-matches.mjs.
//
// PRIMARY SIGNAL: the FR API's `action` field.
//
// This is a structured sentence describing what the doc *does*. Every FR doc
// carries one. Examples:
//
//   Primary rulemaking (KEEP):
//     "Proposed rule."
//     "Final rule."
//     "Interim final rule."
//     "Notice of proposed rulemaking."
//     "Direct final rule."
//
//   Administrative follow-ups (DROP):
//     "Proposed rule; extension of comment period."
//     "Proposed rule; reopening of comment period."
//     "Final rule; correction."
//     "Final rule; technical amendment."
//     "Notice of withdrawal."
//     "Final rule; delay of effective date."
//
// The action field is far more reliable than the title, which sometimes drops
// the action suffix. We check action first; title is a fallback for old data
// (or the rare case an action field is missing) but shouldn't be the primary
// signal going forward.
//
// The `subtype` field, when populated, is also a strong signal ("Correction",
// "Extension"). Rarely populated but definitive when it is.
//
// EDITING: add substrings to EXCLUDE_ACTION_PATTERNS to catch new phrasings.

// Action-field patterns. Matched as case-insensitive substrings against the
// normalized action string.
export const EXCLUDE_ACTION_PATTERNS = [
  "extension of comment period",
  "extension of the comment period",
  "extending comment period",
  "extending the comment period",
  "reopening of comment period",
  "reopening of the comment period",
  "reopening the comment period",
  "reopen comment period",
  "correction",           // covers "correction", "technical correction", "correcting amendment"
  "technical amendment",
  "withdrawal",           // covers "notice of withdrawal", "partial withdrawal"
  "delay of effective date",
  "delayed effective date",
  "delay of the effective date",
  "further delay",
  "stay of effective date",
];

// Subtype-field patterns. FR uses limited vocabulary here — usually null, but
// occasionally "Correction", "Extension", etc.
export const EXCLUDE_SUBTYPE_PATTERNS = [
  "correction",
  "extension",
  "withdrawal",
  "reopening",
  "amendment",
];

// Title-field patterns. Fallback signal — used only when action/subtype don't
// match. Kept narrow to avoid false positives on titles that legitimately
// include these words (e.g. rules named "...Corrections Act of 1984").
export const EXCLUDE_TITLE_SUBSTRINGS = [
  "extension of comment period",
  "extension of the comment period",
  "comment period extension",
  "reopening of comment period",
  "reopening the comment period",
  "reopening of the comment period",
];

function normalize(str) {
  return (str || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns true if the FR doc looks like an administrative follow-up.
 * Checks (in order): action → subtype → title.
 */
export function isAdministrativeFollowup(doc) {
  if (!doc) return false;

  // Primary: structured action field (present on all API responses that request it)
  const action = normalize(doc.a);
  if (action && EXCLUDE_ACTION_PATTERNS.some((pat) => action.includes(pat))) return true;

  // Secondary: subtype field (rare, but definitive)
  const subtype = normalize(doc.s);
  if (subtype && EXCLUDE_SUBTYPE_PATTERNS.some((pat) => subtype.includes(pat))) return true;

  // Fallback: title. Only used if action was missing (old data or listing endpoint quirk).
  const title = normalize(doc.l);
  if (title && EXCLUDE_TITLE_SUBSTRINGS.some((pat) => title.includes(pat))) return true;

  return false;
}

/**
 * Diagnostic: returns "field:pattern" showing which check matched, or null.
 */
export function whichExclusion(doc) {
  if (!doc) return null;
  const action = normalize(doc.a);
  if (action) {
    const p = EXCLUDE_ACTION_PATTERNS.find((pat) => action.includes(pat));
    if (p) return `action:"${p}"`;
  }
  const subtype = normalize(doc.s);
  if (subtype) {
    const p = EXCLUDE_SUBTYPE_PATTERNS.find((pat) => subtype.includes(pat));
    if (p) return `subtype:"${p}"`;
  }
  const title = normalize(doc.l);
  if (title) {
    const p = EXCLUDE_TITLE_SUBSTRINGS.find((pat) => title.includes(pat));
    if (p) return `title:"${p}"`;
  }
  return null;
}
