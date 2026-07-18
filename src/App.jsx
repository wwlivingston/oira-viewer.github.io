import React, { useState, useMemo, useCallback, useEffect } from "react";
import { AGENCY_MAP, AGENCY_GROUPS, HIST_YEARS, ADMINS } from "./agency-map.js";
import {
  loadManifest,
  loadAgencies,
  loadUnderReview,
  loadCompletedBase,
  loadHistoricalYears,
  loadAvailableHistoricalYears,
  loadFrIndex,
  loadFuzzyMatches,
} from "./data-loader.js";
import { enrichWithFr } from "./fr-match.js";
import MultiAgencySelect from "./components/MultiAgencySelect.jsx";

// ─────────────────────────────────────────────────────────────
// Local helpers (same logic as the original artifact)
// ─────────────────────────────────────────────────────────────

function dedup(r) {
  const s = new Set();
  return r.filter((x) => {
    const k = `${x.RIN}|${x.DATE_RECEIVED}|${x.DATE_COMPLETED}|${x.STAGE}`;
    if (s.has(k)) return false;
    s.add(k);
    return true;
  });
}
function daysRcv(r) {
  if (!r.DATE_RECEIVED) return null;
  const d = Math.round((new Date() - new Date(r.DATE_RECEIVED)) / 864e5);
  return isNaN(d) ? null : d;
}
function daysCmp(r) {
  if (!r.DATE_RECEIVED || !r.DATE_COMPLETED) return null;
  const d = Math.round((new Date(r.DATE_COMPLETED) - new Date(r.DATE_RECEIVED)) / 864e5);
  return isNaN(d) ? null : d;
}
function med(a) {
  if (!a.length) return 0;
  const s = [...a].sort((x, y) => x - y),
    m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

const Badge = ({ children, color }) => (
  <span style={{display:"inline-block",padding:"2px 8px",borderRadius:12,fontSize:11,fontWeight:600,background:color,color:"#fff",marginRight:4,marginBottom:2,whiteSpace:"nowrap"}}>{children}</span>
);
const stageBg = (s) => {
  if (!s) return "#6b7280";
  if (s.includes("Interim")) return "#0891b2";
  if (s.includes("Final")) return "#2563eb";
  if (s === "Proposed Rule") return "#d97706";
  if (s === "Prerule") return "#7c3aed";
  if (s === "Notice") return "#059669";
  return "#6b7280";
};
const decBg = (d) => {
  if (d === "Withdrawn") return "#dc2626";
  if (d.includes("without")) return "#16a34a";
  if (d.includes("Judicial") || d.includes("Statutory")) return "#9333ea";
  return "#3b82f6";
};
const Stat = ({ label, value, sub, color = "#2563eb" }) => (
  <div style={{border:"1px solid #e5e7eb",borderRadius:8,padding:"14px 16px",textAlign:"center",minWidth:105}}>
    <div style={{fontSize:24,fontWeight:700,color}}>{value}</div>
    <div style={{fontSize:11,fontWeight:600,color:"#374151",marginTop:2}}>{label}</div>
    {sub && <div style={{fontSize:10,color:"#9ca3af",marginTop:2}}>{sub}</div>}
  </div>
);
const HBar = ({ items, maxVal, colorFn, lw = 180, bw = 160 }) => (
  <div>
    {items.map(([l, v], i) => (
      <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
        <div style={{width:lw,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",flexShrink:0}} title={l}>{l}</div>
        <div style={{width:bw,height:16,background:"#f3f4f6",borderRadius:4,overflow:"hidden",flexShrink:0}}>
          <div style={{width:`${maxVal?(v/maxVal)*100:0}%`,height:"100%",background:typeof colorFn==="function"?colorFn(l):colorFn,borderRadius:4,transition:"width 0.3s"}}/>
        </div>
        <div style={{fontSize:12,fontWeight:600,minWidth:36,textAlign:"right"}}>{v}</div>
      </div>
    ))}
  </div>
);

// ─────────────────────────────────────────────────────────────
// Main app
// ─────────────────────────────────────────────────────────────

export default function App() {
  const [feed, setFeed] = useState("review");
  const [dataMap, setDataMap] = useState({ review: [], completed: [] });
  const [agy, setAgy] = useState(AGENCY_MAP);
  const [loaded, setLoaded] = useState({ review: false, completed: false });
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState(null);
  const [manifest, setManifest] = useState(null);
  const [loadedYears, setLoadedYears] = useState(new Set());
  const [frIndex, setFrIndex] = useState({});
  const [fuzzyMatches, setFuzzyMatches] = useState({});

  const [search, setSearch] = useState("");
  const [stageF, setStageF] = useState("All");
  const [decisionF, setDecisionF] = useState("All");
  const [majorF, setMajorF] = useState("All");
  const [sortKey, setSortKey] = useState("DATE_COMPLETED");
  const [sortDir, setSortDir] = useState("desc");
  const [expanded, setExpanded] = useState(null);
  const [tab, setTab] = useState("table");
  const [dashAgys, setDashAgys] = useState([]);
  const [metric, setMetric] = useState("both");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [activeAdmin, setActiveAdmin] = useState(null);

  const isCompleted = feed === "completed";
  const FC = isCompleted
    ? { label: "Completed Reviews", color: "#059669", bg: "#ecfdf5" }
    : { label: "Under Review", color: "#2563eb", bg: "#eff6ff" };
  const rawData = dataMap[feed];
  // On the completed tab, decorate each rule with FR fields (FR_PUB_DATE,
  // FR_DOC_NUMBER, FR_TYPE, FR_URL, DAYS_TO_FR). On the under-review tab it's
  // a no-op — pass-through the raw rows. Recomputes only when raw data or
  // the FR index changes, not on every filter tweak.
  const data = useMemo(() => {
    if (!isCompleted) return rawData;
    return rawData.map((r) => enrichWithFr(r, frIndex, fuzzyMatches));
  }, [rawData, frIndex, fuzzyMatches, isCompleted]);
  const getName = useCallback((c) => agy[c] || c, [agy]);
  const calcDays = isCompleted ? daysCmp : daysRcv;
  const daysLabel = isCompleted ? "Days to Completion" : "Days in Review";
  const daysSub = isCompleted ? "received → completed" : "since received";

  // On mount, load manifest + agencies in parallel
  useEffect(() => {
    (async () => {
      try {
        const [m, a] = await Promise.all([loadManifest(), loadAgencies()]);
        setManifest(m);
        setAgy(a);
      } catch (e) {
        // Manifest missing is OK if user uploads XML manually — surface as a soft warning.
        console.warn("Manifest load failed:", e.message);
      }
    })();
  }, []);

  // Auto-load the current feed when switched to (if not already loaded)
  useEffect(() => {
    if (loaded[feed] || loading) return;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        if (feed === "review") {
          setStatus("Loading rules under review…");
          const { rules } = await loadUnderReview();
          setDataMap((p) => ({ ...p, review: rules }));
          setLoaded((p) => ({ ...p, review: true }));
        } else {
          // Discover which historical years are available from the manifest,
          // then load everything (base + all years + FR index) in parallel.
          setStatus("Loading all completed reviews + FR match layers…");
          const availableYears = await loadAvailableHistoricalYears();
          const [base, historical, fr, fuzzy] = await Promise.all([
            loadCompletedBase(),
            loadHistoricalYears(availableYears),
            loadFrIndex(),
            loadFuzzyMatches(),
          ]);
          // dedup uses the same key as the parser/loader.
          const seen = new Set();
          const combined = [...base.rules, ...historical].filter((r) => {
            const k = `${r.RIN}|${r.DATE_RECEIVED}|${r.DATE_COMPLETED}|${r.STAGE}`;
            if (seen.has(k)) return false;
            seen.add(k);
            return true;
          });
          setDataMap((p) => ({ ...p, completed: combined }));
          setLoaded((p) => ({ ...p, completed: true }));
          setLoadedYears(new Set(availableYears));
          setFrIndex(fr);
          setFuzzyMatches(fuzzy);
        }
      } catch (e) {
        setError(
          `${e.message}. Data files may not have been generated yet — run \`npm run fetch:daily\` locally or wait for the nightly workflow.`
        );
      } finally {
        setLoading(false);
        setStatus("");
      }
    })();
  }, [feed, loaded, loading]);

  // Optional: file upload override (useful for local testing before the cron runs)
  const handleFile = (e, type) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (ev) => {
      const text = ev.target.result;
      if (type === "json") {
        try {
          const j = JSON.parse(text);
          const rules = j.rules || (Array.isArray(j) ? j : []);
          if (!rules.length) throw new Error("No rules found in JSON.");
          if (feed === "completed") {
            setDataMap((p) => ({ ...p, completed: dedup([...p.completed, ...rules]) }));
            setLoaded((p) => ({ ...p, completed: true }));
          } else {
            setDataMap((p) => ({ ...p, review: rules }));
            setLoaded((p) => ({ ...p, review: true }));
          }
          setError(null);
        } catch (err) {
          setError(`Bad JSON: ${err.message}`);
        }
      }
    };
    reader.readAsText(file);
  };

  const setAdmin = (a) => {
    if (activeAdmin === a.id) {
      setActiveAdmin(null);
      setDateFrom("");
      setDateTo("");
      return;
    }
    setActiveAdmin(a.id);
    setDateFrom(a.from);
    setDateTo(a.to === "2099-12-31" ? "" : a.to);
    // No load needed — all available years are already in memory.
  };

  const switchFeed = (f) => {
    setFeed(f);
    setExpanded(null);
  };

  const stages = useMemo(() => [...new Set(data.map((d) => d.STAGE))].filter(Boolean).sort(), [data]);
  const decisions = useMemo(() => [...new Set(data.map((d) => d.DECISION))].filter(Boolean).sort(), [data]);
  const allAgys = useMemo(
    () =>
      [...new Set(data.map((r) => r.AGENCY_CODE))]
        .map((c) => ({ code: c, name: getName(c) }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    [data, getName]
  );

  const filtered = useMemo(() => {
    let d = data.filter((r) => {
      const q = search.toLowerCase();
      if (
        q &&
        !r.TITLE.toLowerCase().includes(q) &&
        !r.RIN.toLowerCase().includes(q) &&
        !r.AGENCY_CODE.includes(q) &&
        !getName(r.AGENCY_CODE).toLowerCase().includes(q)
      )
        return false;
      if (stageF !== "All" && r.STAGE !== stageF) return false;
      if (decisionF !== "All" && r.DECISION !== decisionF) return false;
      if (majorF === "Yes" && r.MAJOR !== "Yes") return false;
      if (majorF === "No" && r.MAJOR !== "No") return false;
      if (isCompleted && dateFrom) { if (!r.DATE_RECEIVED || r.DATE_RECEIVED < dateFrom) return false; }
      if (isCompleted && dateTo)   { if (!r.DATE_RECEIVED || r.DATE_RECEIVED > dateTo) return false; }
      if (dashAgys.length > 0 && !dashAgys.includes(r.AGENCY_CODE)) return false;
      return true;
    });
    d.sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      // Nulls / undefineds always sort to the bottom regardless of direction
      // (otherwise "Not Available" rows would clump at one end unpredictably).
      const aNull = av === null || av === undefined || av === "";
      const bNull = bv === null || bv === undefined || bv === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      // Numeric compare for DAYS_TO_FR, string compare otherwise (works for
      // ISO date strings too, since they lex-sort correctly).
      const cmp = sortKey === "DAYS_TO_FR"
        ? av - bv
        : (av < bv ? -1 : av > bv ? 1 : 0);
      return sortDir === "asc" ? cmp : -cmp;
    });
    return d;
  }, [data, search, stageF, decisionF, majorF, sortKey, sortDir, getName, dateFrom, dateTo, dashAgys, isCompleted]);

  const doSort = (k) => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir("asc"); }
  };
  const arrow = (k) => (sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "");

  const majCount = filtered.filter((r) => r.MAJOR === "Yes").length;
  const wdCount = filtered.filter((r) => r.DECISION === "Withdrawn").length;

  const agyStats = useMemo(() => { const m={}; filtered.forEach(r=>{const n=getName(r.AGENCY_CODE);m[n]=(m[n]||0)+1;}); return Object.entries(m).sort((a,b)=>b[1]-a[1]).slice(0,15); }, [filtered, getName]);

  const gDays = useMemo(() => {
    const v = filtered.map(calcDays).filter((x) => x !== null);
    if (!v.length) return { avg:0, med:0, min:0, max:0, n:0 };
    return { avg: Math.round(v.reduce((a,b)=>a+b,0)/v.length), med: med(v), min: Math.min(...v), max: Math.max(...v), n: v.length };
  }, [filtered, calcDays]);

  // Days-to-FR-publication metric. Nulls (no FR match) are excluded from the
  // average, per the "Not Available" rule. Sub-label also reports the mix of
  // match kinds so you can tell what fraction is authoritative.
  const gDaysFr = useMemo(() => {
    if (!isCompleted) return null;
    let sum = 0, count = 0, byRin = 0, byOira = 0, byFuzzy = 0, noFr = 0;
    const arr = [];
    for (const r of filtered) {
      if (r.DAYS_TO_FR !== null && r.DAYS_TO_FR !== undefined) {
        arr.push(r.DAYS_TO_FR);
        sum += r.DAYS_TO_FR; count++;
        if (r.FR_MATCH_KIND === "rin") byRin++;
        else if (r.FR_MATCH_KIND === "oira-reported") byOira++;
        else if (r.FR_MATCH_KIND === "title-fuzzy") byFuzzy++;
      } else {
        noFr++;
      }
    }
    if (!count) return { avg: 0, med: 0, n: 0, noFr, byRin, byOira, byFuzzy };
    return { avg: Math.round(sum / count), med: med(arr), n: count, noFr, byRin, byOira, byFuzzy };
  }, [filtered, isCompleted]);

  const agyDays = useMemo(() => {
    const m = {};
    filtered.forEach((r) => { const d = calcDays(r); if (d===null) return; const n = getName(r.AGENCY_CODE); if(!m[n]) m[n]=[]; m[n].push(d); });
    return Object.entries(m).map(([name, v]) => ({
      name,
      avg: Math.round(v.reduce((a,b)=>a+b,0)/v.length),
      med: med(v),
      count: v.length,
      min: Math.min(...v),
      max: Math.max(...v),
    })).sort((a, b) => b.avg - a.avg);
  }, [filtered, getName, calcDays]);

  const stageDays = useMemo(() => {
    const m = {};
    filtered.forEach((r) => { const d = calcDays(r); if (d===null) return; if(!m[r.STAGE]) m[r.STAGE]=[]; m[r.STAGE].push(d); });
    return Object.entries(m).map(([s, v]) => ({
      stage: s,
      avg: Math.round(v.reduce((a,b)=>a+b,0)/v.length),
      med: med(v),
      count: v.length,
    })).sort((a, b) => b.avg - a.avg);
  }, [filtered, calcDays]);

  const histo = useMemo(() => {
    const v = filtered.map(calcDays).filter((x) => x !== null);
    const bk = isCompleted
      ? [{l:"0–7d",a:0,b:7},{l:"8–14d",a:8,b:14},{l:"15–30d",a:15,b:30},{l:"31–60d",a:31,b:60},{l:"61–90d",a:61,b:90},{l:"91–120d",a:91,b:120},{l:"121–180d",a:121,b:180},{l:"180+d",a:181,b:Infinity}]
      : [{l:"0–30d",a:0,b:30},{l:"31–60d",a:31,b:60},{l:"61–90d",a:61,b:90},{l:"91–120d",a:91,b:120},{l:"121–180d",a:121,b:180},{l:"181–270d",a:181,b:270},{l:"271–365d",a:271,b:365},{l:"365+d",a:366,b:Infinity}];
    return bk.map((k) => ({ label: k.l, count: v.filter((x) => x >= k.a && x <= k.b).length }));
  }, [filtered, calcDays, isCompleted]);

  const inp = { padding: "8px 12px", border: "1px solid #d1d5db", borderRadius: 6, fontSize: 13, background: "#fff" };
  const card = { border: "1px solid #e5e7eb", borderRadius: 8, padding: 16 };

  const FeedTabs = () => (
    <div style={{display:"flex",gap:0,marginBottom:20,borderBottom:"3px solid #e5e7eb"}}>
      {[["review","Under Review","#2563eb","#eff6ff"],["completed","Completed Reviews","#059669","#ecfdf5"]].map(([k,l,c,bg]) => (
        <button key={k} onClick={() => switchFeed(k)} style={{padding:"10px 24px",border:"none",borderBottom:`3px solid ${feed===k?c:"transparent"}`,marginBottom:-3,background:feed===k?bg:"none",fontWeight:feed===k?700:400,color:feed===k?c:"#6b7280",cursor:"pointer",fontSize:14,borderRadius:"8px 8px 0 0",transition:"all 0.15s"}}>
          {l}{loaded[k] && <span style={{marginLeft:6,fontSize:11,background:feed===k?c:"#d1d5db",color:"#fff",borderRadius:10,padding:"1px 7px"}}>{dataMap[k].length}</span>}
        </button>
      ))}
    </div>
  );

  const SnapshotStamp = () => {
    if (!manifest?.generated_at) return null;
    const d = new Date(manifest.generated_at);
    return (
      <span style={{fontSize:11,color:"#9ca3af"}}>
        Snapshot: {d.toISOString().slice(0, 10)} {d.toISOString().slice(11, 16)} UTC
      </span>
    );
  };

  // ── LOADING ──
  if (loading && !loaded[feed]) {
    return (
      <div style={{fontFamily:"system-ui,sans-serif",maxWidth:750,margin:"40px auto",padding:24}}>
        <FeedTabs />
        <div style={{display:"flex",flexDirection:"column",alignItems:"center",gap:8,padding:32}}>
          <div style={{width:20,height:20,border:"3px solid #e5e7eb",borderTop:`3px solid ${FC.color}`,borderRadius:"50%",animation:"spin 0.8s linear infinite"}}/>
          <span style={{color:"#6b7280",fontSize:13}}>{status || "Loading…"}</span>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
        </div>
      </div>
    );
  }

  // ── ERROR (no data at all) ──
  if (error && !loaded[feed]) {
    return (
      <div style={{fontFamily:"system-ui,sans-serif",maxWidth:750,margin:"40px auto",padding:24}}>
        <FeedTabs />
        <div style={{padding:16,background:"#fef2f2",border:"1px solid #fecaca",borderRadius:8,color:"#dc2626",fontSize:13,marginBottom:16}}>{error}</div>
        <label style={{display:"block",padding:16,border:"2px dashed #d1d5db",borderRadius:8,textAlign:"center",cursor:"pointer",fontSize:13,color:"#6b7280"}}>
          <div style={{fontWeight:600,marginBottom:4,color:"#374151"}}>Upload JSON snapshot manually</div>
          Drop a *.json file produced by scripts/fetch-daily.mjs
          <input type="file" accept=".json" onChange={(e) => handleFile(e, "json")} style={{display:"none"}}/>
        </label>
      </div>
    );
  }

  // ── MAIN VIEW ──
  return (
    <div style={{fontFamily:"system-ui,sans-serif",maxWidth:1300,margin:"0 auto",padding:16}}>
      <FeedTabs />

      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8,marginBottom:12}}>
        <div>
          <h2 style={{margin:0,fontSize:20,fontWeight:700,color:FC.color}}>{FC.label}</h2>
          <p style={{margin:"2px 0 0",fontSize:13,color:"#6b7280"}}>
            {data.length} total · {filtered.length} shown · {majCount} major · {wdCount} withdrawn
            {isCompleted && loadedYears.size > 0 && ` · includes ${loadedYears.size} historical year${loadedYears.size>1?"s":""}`}
          </p>
          <div style={{marginTop:2}}><SnapshotStamp /></div>
        </div>
      </div>

      {isCompleted && (
        <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
          <span style={{fontSize:12,fontWeight:600,color:"#6b7280"}}>Administration:</span>
          {ADMINS.map((a) => (
            <button key={a.id} onClick={() => setAdmin(a)} style={{padding:"5px 16px",borderRadius:20,border:`2px solid ${a.color}`,background:activeAdmin===a.id?a.color:"transparent",color:activeAdmin===a.id?"#fff":a.color,fontSize:12,fontWeight:600,cursor:"pointer",transition:"all 0.15s"}}>
              {a.label}
            </button>
          ))}
          {(dateFrom || dateTo || activeAdmin) && <button onClick={() => { setActiveAdmin(null); setDateFrom(""); setDateTo(""); }} style={{fontSize:11,color:"#dc2626",background:"none",border:"none",cursor:"pointer"}}>Clear dates</button>}
        </div>
      )}

      <div style={{display:"flex",gap:0,marginBottom:16,borderBottom:"2px solid #e5e7eb"}}>
        {[["table","Table"],["dashboard","Dashboard"]].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} style={{padding:"8px 20px",border:"none",borderBottom:tab===k?`2px solid ${FC.color}`:"2px solid transparent",marginBottom:-2,background:"none",fontWeight:tab===k?600:400,color:tab===k?FC.color:"#6b7280",cursor:"pointer",fontSize:13}}>{l}</button>
        ))}
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12,alignItems:"flex-start"}}>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search title, RIN, agency…" style={{...inp,flex:"1 1 200px"}}/>
        <select value={stageF} onChange={(e) => setStageF(e.target.value)} style={inp}><option value="All">All Stages</option>{stages.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={decisionF} onChange={(e) => setDecisionF(e.target.value)} style={inp}><option value="All">All Decisions</option>{decisions.map((s) => <option key={s}>{s}</option>)}</select>
        <select value={majorF} onChange={(e) => setMajorF(e.target.value)} style={inp}><option value="All">Major: All</option><option value="Yes">Major Only</option><option value="No">Non-Major</option></select>
      </div>

      <div style={{display:"flex",flexWrap:"wrap",gap:8,marginBottom:12,alignItems:"flex-start"}}>
        <MultiAgencySelect options={allAgys} selected={dashAgys} onChange={setDashAgys} accentColor={FC.color} getName={getName} groups={AGENCY_GROUPS}/>
        {isCompleted && (
          <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{fontSize:12,color:"#6b7280"}}>Received between:</span>
            <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setActiveAdmin(null); }} style={{...inp,width:140}}/>
            <span style={{fontSize:12,color:"#9ca3af"}}>to</span>
            <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setActiveAdmin(null); }} style={{...inp,width:140}}/>
          </div>
        )}
      </div>

      <div style={{fontSize:12,color:"#6b7280",marginBottom:8}}>
        {filtered.length} result{filtered.length !== 1 ? "s" : ""}
        {dashAgys.length > 0 && ` · ${dashAgys.length} agenc${dashAgys.length>1?"ies":"y"} selected`}
        {dateFrom && ` · received from ${dateFrom}`}
        {dateTo && ` · received through ${dateTo}`}
      </div>

      {tab === "dashboard" && (
        <div>
          {/* 1. Stat cards */}
          <div style={{display:"flex",flexWrap:"wrap",gap:12,marginBottom:24}}>
            <Stat label="Total" value={filtered.length} color="#374151"/>
            <Stat label={`Avg ${daysLabel}`} value={gDays.avg} sub={daysSub} color={FC.color}/>
            <Stat label="Median" value={gDays.med} color="#7c3aed"/>
            <Stat label={isCompleted ? "Fastest" : "Min"} value={`${gDays.min}d`} color="#059669"/>
            <Stat label={isCompleted ? "Slowest" : "Max"} value={`${gDays.max}d`} color="#dc2626"/>
            <Stat label="Major" value={majCount} color="#ea580c"/>
            {isCompleted && gDaysFr && (
              <Stat
                label="Avg Days to FR Pub"
                value={gDaysFr.n ? gDaysFr.avg : "—"}
                sub={
                  gDaysFr.n
                    ? `${gDaysFr.byRin} RIN · ${gDaysFr.byOira} OIRA · ${gDaysFr.byFuzzy} fuzzy · ${gDaysFr.noFr} N/A`
                    : "no FR matches"
                }
                color="#0891b2"
              />
            )}
          </div>

          {/* 2. {daysLabel} by Stage */}
          <div style={{...card,marginBottom:20}}>
            <div style={{fontWeight:600,fontSize:14,marginBottom:14}}>{daysLabel} by Stage</div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{borderBottom:"2px solid #e5e7eb"}}><th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>Stage</th><th style={{textAlign:"center",padding:"6px 8px",fontWeight:600}}>Rules</th><th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>Average</th><th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>Median</th></tr></thead>
              <tbody>{stageDays.map((s, i) => {
                const mxS = Math.max(...stageDays.map((x) => x.avg), 1),
                  mxSM = Math.max(...stageDays.map((x) => x.med), 1);
                return (
                  <tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
                    <td style={{padding:"6px 8px"}}><Badge color={stageBg(s.stage)}>{s.stage}</Badge></td>
                    <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{s.count}</td>
                    <td style={{padding:"6px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:120,height:14,background:"#f3f4f6",borderRadius:3,overflow:"hidden"}}><div style={{width:`${(s.avg/mxS)*100}%`,height:"100%",background:FC.color,borderRadius:3}}/></div><span style={{fontWeight:600}}>{s.avg}d</span></div></td>
                    <td style={{padding:"6px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:120,height:14,background:"#f3f4f6",borderRadius:3,overflow:"hidden"}}><div style={{width:`${(s.med/mxSM)*100}%`,height:"100%",background:"#8b5cf6",borderRadius:3}}/></div><span style={{fontWeight:600}}>{s.med}d</span></div></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>

          {/* 3. Side-by-side: Top Agencies (left) | {daysLabel} Distribution (right) */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(340px,1fr))",gap:16,marginBottom:20}}>
            <div style={card}>
              <div style={{fontWeight:600,fontSize:14,marginBottom:12}}>Top Agencies</div>
              <HBar items={agyStats} maxVal={agyStats[0]?.[1] || 1} colorFn={() => FC.color} lw={180} bw={140}/>
            </div>
            <div style={card}>
              <div style={{fontWeight:600,fontSize:14,marginBottom:12}}>{daysLabel} Distribution</div>
              <HBar items={histo.map((b) => [b.label, b.count])} maxVal={Math.max(...histo.map((b) => b.count), 1)} colorFn={() => FC.color} lw={90} bw={160}/>
            </div>
          </div>

          {/* 4. {daysLabel} by Agency (moved to bottom) */}
          <div style={{...card,marginBottom:20}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:8}}>
              <div style={{fontWeight:600,fontSize:14}}>{daysLabel} by Agency</div>
              <div style={{display:"flex",gap:4}}>
                {[["both","Avg + Median"],["avg","Average"],["med","Median"]].map(([k,l]) => (
                  <button key={k} onClick={() => setMetric(k)} style={{padding:"4px 12px",border:"1px solid #d1d5db",borderRadius:6,fontSize:11,cursor:"pointer",background:metric===k?FC.color:"#fff",color:metric===k?"#fff":"#374151",fontWeight:metric===k?600:400}}>{l}</button>
                ))}
              </div>
            </div>
            <div style={{overflowX:"auto"}}>
              <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                <thead><tr style={{borderBottom:"2px solid #e5e7eb"}}>
                  <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>Agency</th>
                  <th style={{textAlign:"center",padding:"6px 8px",fontWeight:600}}>Rules</th>
                  {(metric === "avg" || metric === "both") && <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>Average</th>}
                  {(metric === "med" || metric === "both") && <th style={{textAlign:"left",padding:"6px 8px",fontWeight:600}}>Median</th>}
                  <th style={{textAlign:"center",padding:"6px 8px",fontWeight:600}}>Min</th>
                  <th style={{textAlign:"center",padding:"6px 8px",fontWeight:600}}>Max</th>
                </tr></thead>
                <tbody>{agyDays.map((a, i) => {
                  const mxA = Math.max(...agyDays.map((x) => x.avg), 1),
                    mxM = Math.max(...agyDays.map((x) => x.med), 1);
                  return (
                    <tr key={i} style={{borderBottom:"1px solid #f3f4f6"}}>
                      <td style={{padding:"6px 8px",maxWidth:220,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={a.name}>{a.name}</td>
                      <td style={{padding:"6px 8px",textAlign:"center",fontWeight:600}}>{a.count}</td>
                      {(metric === "avg" || metric === "both") && <td style={{padding:"6px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:120,height:14,background:"#f3f4f6",borderRadius:3,overflow:"hidden",flexShrink:0}}><div style={{width:`${(a.avg/mxA)*100}%`,height:"100%",background:FC.color,borderRadius:3}}/></div><span style={{fontWeight:600,minWidth:30}}>{a.avg}d</span></div></td>}
                      {(metric === "med" || metric === "both") && <td style={{padding:"6px 8px"}}><div style={{display:"flex",alignItems:"center",gap:6}}><div style={{width:120,height:14,background:"#f3f4f6",borderRadius:3,overflow:"hidden",flexShrink:0}}><div style={{width:`${(a.med/mxM)*100}%`,height:"100%",background:"#8b5cf6",borderRadius:3}}/></div><span style={{fontWeight:600,minWidth:30}}>{a.med}d</span></div></td>}
                      <td style={{padding:"6px 8px",textAlign:"center",color:"#059669"}}>{a.min}d</td>
                      <td style={{padding:"6px 8px",textAlign:"center",color:"#dc2626"}}>{a.max}d</td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === "table" && (
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
            <thead><tr style={{background:"#f9fafb",borderBottom:"2px solid #e5e7eb"}}>
              {[
                ["AGENCY_CODE","Agency"],
                ["RIN","RIN"],
                ["TITLE","Title"],
                ["STAGE","Stage"],
                ["DATE_RECEIVED","Received"],
                ["DATE_COMPLETED","Completed"],
                ["DECISION","Decision"],
                ...(isCompleted ? [["FR_PUB_DATE","FR Publication"],["DAYS_TO_FR","Days to FR"]] : []),
              ].map(([k, l]) => (
                <th key={k} onClick={() => doSort(k)} style={{padding:"8px 10px",textAlign:"left",cursor:"pointer",whiteSpace:"nowrap",userSelect:"none",fontWeight:600,fontSize:12,color:"#374151"}}>{l}{arrow(k)}</th>
              ))}
            </tr></thead>
            <tbody>{filtered.map((r, i) => (
              <React.Fragment key={`${r.RIN}-${r.DATE_RECEIVED}-${i}`}>
                <tr onClick={() => setExpanded(expanded === i ? null : i)} style={{borderBottom:"1px solid #f3f4f6",cursor:"pointer",background:expanded===i?FC.bg:"transparent"}}>
                  <td style={{padding:"8px 10px",fontSize:12,minWidth:80}}>
                    <div style={{fontFamily:"monospace",fontSize:11,color:"#6b7280"}}>{r.AGENCY_CODE}</div>
                    <div style={{fontSize:11,fontWeight:500,color:"#374151",maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}} title={getName(r.AGENCY_CODE)}>{getName(r.AGENCY_CODE)}</div>
                  </td>
                  <td style={{padding:"8px 10px",fontFamily:"monospace",fontSize:12,whiteSpace:"nowrap"}}>{r.RIN}</td>
                  <td style={{padding:"8px 10px",maxWidth:340}}>
                    <div style={{fontWeight:500}}>{r.TITLE}</div>
                    <div style={{marginTop:2}}>
                      {r.MAJOR === "Yes" && <Badge color="#dc2626">MAJOR</Badge>}
                      {r.HOMELAND_SECURITY === "Yes" && <Badge color="#ea580c">DHS</Badge>}
                      {r.INTERNATIONAL_IMPACTS === "Yes" && <Badge color="#7c3aed">INT'L</Badge>}
                      {r.HEALTH_CARE_ACT === "Yes" && <Badge color="#0d9488">ACA</Badge>}
                      {r.DODD_FRANK_ACT === "Yes" && <Badge color="#4f46e5">DODD-FRANK</Badge>}
                      {r.FEDERALISM_IMPLICATIONS === "Yes" && <Badge color="#b45309">FED</Badge>}
                    </div>
                  </td>
                  <td style={{padding:"8px 10px"}}><Badge color={stageBg(r.STAGE)}>{r.STAGE}</Badge></td>
                  <td style={{padding:"8px 10px",whiteSpace:"nowrap",fontSize:12}}>{r.DATE_RECEIVED}</td>
                  <td style={{padding:"8px 10px",whiteSpace:"nowrap",fontSize:12}}>{r.DATE_COMPLETED || "—"}</td>
                  <td style={{padding:"8px 10px"}}>{r.DECISION ? <Badge color={decBg(r.DECISION)}>{r.DECISION}</Badge> : "—"}</td>
                  {isCompleted && (
                    <td style={{padding:"8px 10px",whiteSpace:"nowrap",fontSize:12}}>
                      {r.FR_PUB_DATE ? (() => {
                        // Match kind determines styling. All three kinds show the date,
                        // but rin has a solid link, oira-reported and fuzzy get subtle
                        // markers so you can always tell at a glance which is which.
                        const kind = r.FR_MATCH_KIND;
                        if (kind === "rin" && r.FR_URL) {
                          return <a href={r.FR_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{color:FC.color,textDecoration:"none",fontWeight:500}}>{r.FR_PUB_DATE}</a>;
                        }
                        if (kind === "oira-reported") {
                          return <span title="OIRA-reported publication date (no linked FR document)" style={{color:"#b45309",textDecoration:"underline dashed #b4530980",textUnderlineOffset:3,fontWeight:500}}>{r.FR_PUB_DATE}<sup style={{fontSize:9,marginLeft:2,color:"#b45309"}}>†</sup></span>;
                        }
                        if (kind === "title-fuzzy") {
                          const s = r.FR_MATCH_SCORE ? ` (score ${r.FR_MATCH_SCORE})` : "";
                          return (
                            <span title={`Fuzzy title match${s} — verify manually`}>
                              <span style={{color:"#6b7280",marginRight:2}}>~</span>
                              {r.FR_URL
                                ? <a href={r.FR_URL} target="_blank" rel="noopener noreferrer" onClick={(e) => e.stopPropagation()} style={{color:"#7c3aed",textDecoration:"underline dashed #7c3aed80",textUnderlineOffset:3,fontWeight:500}}>{r.FR_PUB_DATE}</a>
                                : <span style={{color:"#7c3aed",textDecoration:"underline dashed",textUnderlineOffset:3,fontWeight:500}}>{r.FR_PUB_DATE}</span>}
                            </span>
                          );
                        }
                        return r.FR_PUB_DATE;
                      })() : <span style={{color:"#9ca3af",fontStyle:"italic"}}>Not Available</span>}
                    </td>
                  )}
                  {isCompleted && (
                    <td style={{padding:"8px 10px",whiteSpace:"nowrap",fontSize:12,textAlign:"right"}}>
                      {r.DAYS_TO_FR !== null && r.DAYS_TO_FR !== undefined
                        ? <span style={{fontWeight:600}}>{r.DAYS_TO_FR}d</span>
                        : <span style={{color:"#9ca3af",fontStyle:"italic"}}>Not Available</span>}
                    </td>
                  )}
                </tr>
                {expanded === i && (
                  <tr style={{background:"#f8fafc"}}><td colSpan={isCompleted ? 9 : 7} style={{padding:"12px 24px"}}>
                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:"8px 24px",fontSize:12}}>
                      <div><strong>Agency:</strong> {getName(r.AGENCY_CODE)}</div>
                      <div><strong>{daysLabel}:</strong> {calcDays(r) ?? "—"}</div>
                      {!isCompleted && r.DATE_COMPLETED && <div><strong>Days to Completion:</strong> {daysCmp(r) ?? "—"}</div>}
                      {isCompleted && (
                        <>
                          <div><strong>FR Publication:</strong> {r.FR_PUB_DATE ? (r.FR_URL ? <a href={r.FR_URL} target="_blank" rel="noopener noreferrer" style={{color:FC.color}}>{r.FR_PUB_DATE}</a> : r.FR_PUB_DATE) : <span style={{color:"#9ca3af"}}>Not Available</span>}</div>
                          <div><strong>Days to FR Pub:</strong> {r.DAYS_TO_FR !== null && r.DAYS_TO_FR !== undefined ? `${r.DAYS_TO_FR}d` : <span style={{color:"#9ca3af"}}>Not Available</span>}</div>
                          {r.FR_MATCH_KIND && (
                            <div><strong>FR Match Source:</strong>{" "}
                              {r.FR_MATCH_KIND === "rin" && <span style={{color:FC.color}}>RIN (authoritative)</span>}
                              {r.FR_MATCH_KIND === "oira-reported" && <span style={{color:"#b45309"}}>OIRA-reported date</span>}
                              {r.FR_MATCH_KIND === "title-fuzzy" && <span style={{color:"#7c3aed"}}>Title similarity{r.FR_MATCH_SCORE ? ` (score ${r.FR_MATCH_SCORE})` : ""}</span>}
                            </div>
                          )}
                          {r.FR_DOC_NUMBER && <div><strong>FR Doc #:</strong> {r.FR_DOC_NUMBER}</div>}
                          {r.FR_TYPE && <div><strong>FR Type:</strong> {r.FR_TYPE}</div>}
                        </>
                      )}
                      <div><strong>Legal Deadline:</strong> {r.LEGAL_DEADLINE || "None"}</div>
                      <div><strong>Economically Significant:</strong> {r.ECONOMICALLY_SIGNIFICANT}</div>
                      <div><strong>Major:</strong> {r.MAJOR || "—"}</div>
                      <div><strong>Homeland Security:</strong> {r.HOMELAND_SECURITY}</div>
                      <div><strong>International:</strong> {r.INTERNATIONAL_IMPACTS}</div>
                      <div><strong>Health Care Act:</strong> {r.HEALTH_CARE_ACT}</div>
                      <div><strong>Dodd-Frank:</strong> {r.DODD_FRANK_ACT}</div>
                      <div><strong>Pandemic:</strong> {r.PANDEMIC_RESPONSE}</div>
                      <div><strong>Unfunded Mandates:</strong> {r.UNFUNDED_MANDATES || "No"}</div>
                      <div><strong>Federalism:</strong> {r.FEDERALISM_IMPLICATIONS}</div>
                      <div><strong>TCJA:</strong> {r.TCJA}</div>
                      <div><strong>Reg Flex:</strong> {r.REGULATORY_FLEXIBILITY_ANALYSIS || "—"}</div>
                      <div><strong>Small Entities:</strong> {r.SMALL_ENTITIES_AFFECTED || "—"}</div>
                      {r.DATE_PUBLISHED && <div><strong>OIRA-reported Publication:</strong> {r.DATE_PUBLISHED}</div>}
                    </div>
                  </td></tr>
                )}
              </React.Fragment>
            ))}</tbody>
          </table>
          {!filtered.length && <div style={{padding:32,textAlign:"center",color:"#9ca3af"}}>No matching rules.</div>}
        </div>
      )}
    </div>
  );
}
