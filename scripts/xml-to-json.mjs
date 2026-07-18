// Shared XML parser used by fetch-daily.mjs and fetch-year.mjs.
// Uses @xmldom/xmldom so the same querySelector logic from the browser works in Node.

import { DOMParser } from "@xmldom/xmldom";

// Fields extracted from each <REGACT> element in reginfo XML.
const FIELDS = [
  "AGENCY_CODE","RIN","TITLE","STAGE","ECONOMICALLY_SIGNIFICANT",
  "DATE_RECEIVED","LEGAL_DEADLINE","DATE_COMPLETED","DECISION","MAJOR",
  "HOMELAND_SECURITY","INTERNATIONAL_IMPACTS","HEALTH_CARE_ACT","DODD_FRANK_ACT",
  "PANDEMIC_RESPONSE","UNFUNDED_MANDATES","FEDERALISM_IMPLICATIONS","TCJA",
  "REGULATORY_FLEXIBILITY_ANALYSIS","SMALL_ENTITIES_AFFECTED","DATE_PUBLISHED",
];

// xmldom doesn't ship a full querySelector — walk children by tag name.
function firstChildByTag(el, tag) {
  const nodes = el.getElementsByTagName(tag);
  return nodes && nodes.length ? nodes[0] : null;
}
function textOf(el, tag) {
  const n = firstChildByTag(el, tag);
  return n && n.textContent ? n.textContent.trim() : "";
}

const parserOpts = { onError: () => {} }; // silence xmldom's noisy warnings

export function parseRules(xml) {
  const doc = new DOMParser(parserOpts).parseFromString(xml, "text/xml");
  const acts = doc.getElementsByTagName("REGACT");
  const out = [];
  for (let i = 0; i < acts.length; i++) {
    const act = acts[i];
    const o = {};
    for (const f of FIELDS) o[f] = textOf(act, f);
    out.push(o);
  }
  return out;
}

export function parseAgencies(xml) {
  const doc = new DOMParser(parserOpts).parseFromString(xml, "text/xml");
  const map = {};
  const tags = ["AGENCY", "agency"];
  for (const tag of tags) {
    const nodes = doc.getElementsByTagName(tag);
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];
      const code =
        textOf(node, "AGENCY_CODE") || textOf(node, "agency_code");
      const name =
        textOf(node, "AGENCY_NAME") || textOf(node, "agency_name") ||
        textOf(node, "NAME") || textOf(node, "name");
      if (code && name) map[code] = name;
    }
  }
  return map;
}

// Same dedup rule used in the browser.
export function dedup(rules) {
  const seen = new Set();
  return rules.filter((r) => {
    const k = `${r.RIN}|${r.DATE_RECEIVED}|${r.DATE_COMPLETED}|${r.STAGE}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
