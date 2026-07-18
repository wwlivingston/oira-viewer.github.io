import React, { useState, useMemo, useRef } from "react";

// Multi-select dropdown with parent agency groups (departments).
// `groups` is a { [groupName]: [code, ...] } map.
export default function MultiAgencySelect({ options, selected, onChange, accentColor, getName, groups = {} }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const ref = useRef(null);

  const { groupedList, ungrouped } = useMemo(() => {
    const codeSet = new Set(options.map((o) => o.code));
    const grps = [];
    const grouped = new Set();
    Object.entries(groups).forEach(([grpName, codes]) => {
      const present = codes.filter((c) => codeSet.has(c));
      if (present.length) {
        grps.push({
          name: grpName,
          codes: present,
          children: present.map((c) => ({ code: c, name: getName(c) })),
        });
        present.forEach((c) => grouped.add(c));
      }
    });
    const ung = options.filter((o) => !grouped.has(o.code));
    return {
      groupedList: grps.sort((a, b) => a.name.localeCompare(b.name)),
      ungrouped: ung,
    };
  }, [options, getName, groups]);

  const matchQ = (text) => text.toLowerCase().includes(q.toLowerCase());
  const filtGroups = groupedList
    .map((g) => ({
      ...g,
      children: g.children.filter((c) => !q || matchQ(c.name) || matchQ(c.code) || matchQ(g.name)),
      nameMatch: matchQ(g.name),
    }))
    .filter((g) => g.nameMatch || g.children.length > 0);
  const filtUng = ungrouped.filter((o) => !q || matchQ(o.name) || matchQ(o.code));

  const isGroupSelected = (g) => g.codes.every((c) => selected.includes(c));
  const isGroupPartial = (g) => g.codes.some((c) => selected.includes(c)) && !isGroupSelected(g);
  const toggleGroup = (g) => {
    if (isGroupSelected(g)) onChange(selected.filter((c) => !g.codes.includes(c)));
    else onChange([...new Set([...selected, ...g.codes])]);
  };
  const toggleCode = (code) =>
    onChange(selected.includes(code) ? selected.filter((c) => c !== code) : [...selected, code]);

  const selSummary = useMemo(() => {
    const chips = [];
    const accounted = new Set();
    groupedList.forEach((g) => {
      if (isGroupSelected(g)) {
        chips.push(g.name);
        g.codes.forEach((c) => accounted.add(c));
      }
    });
    selected.filter((c) => !accounted.has(c)).forEach((c) => chips.push(getName(c)));
    return chips;
  }, [selected, groupedList, getName]);

  return (
    <div ref={ref} style={{position:"relative",minWidth:300,flex:"1 1 300px"}}>
      <div onClick={() => setOpen(!open)} style={{padding:"7px 12px",border:"1px solid #d1d5db",borderRadius:6,fontSize:13,background:"#fff",cursor:"pointer",display:"flex",alignItems:"center",gap:6,minHeight:36,flexWrap:"wrap"}}>
        {selected.length === 0 && <span style={{color:"#9ca3af"}}>All Agencies</span>}
        {selSummary.slice(0, 3).map((label) => (
          <span key={label} style={{background:accentColor+"18",color:accentColor,fontSize:11,padding:"1px 8px",borderRadius:10,fontWeight:600,whiteSpace:"nowrap",maxWidth:180,overflow:"hidden",textOverflow:"ellipsis",display:"inline-block"}}>{label}</span>
        ))}
        {selSummary.length > 3 && <span style={{fontSize:11,color:"#6b7280"}}>+{selSummary.length - 3} more</span>}
        <span style={{marginLeft:"auto",fontSize:10,color:"#9ca3af"}}>{open ? "▲" : "▼"}</span>
      </div>
      {open && (
        <div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:50,background:"#fff",border:"1px solid #d1d5db",borderRadius:8,marginTop:4,boxShadow:"0 8px 24px rgba(0,0,0,0.12)",maxHeight:400,display:"flex",flexDirection:"column"}}>
          <div style={{padding:8,borderBottom:"1px solid #f3f4f6",display:"flex",gap:6}}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agencies or departments…" style={{flex:1,padding:"6px 10px",border:"1px solid #e5e7eb",borderRadius:4,fontSize:12}} autoFocus/>
            {selected.length > 0 && <button onClick={() => onChange([])} style={{fontSize:11,color:"#dc2626",background:"none",border:"none",cursor:"pointer",whiteSpace:"nowrap"}}>Clear all</button>}
          </div>
          <div style={{overflowY:"auto",flex:1}}>
            {filtGroups.map((g) => (
              <div key={g.name}>
                <div onClick={() => toggleGroup(g)} style={{padding:"7px 12px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:isGroupSelected(g) ? accentColor+"0d" : "#f9fafb",borderBottom:"1px solid #f3f4f6",fontWeight:600}}>
                  <span style={{width:16,height:16,border:`2px solid ${isGroupSelected(g) ? accentColor : isGroupPartial(g) ? accentColor : "#d1d5db"}`,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:isGroupSelected(g) ? accentColor : isGroupPartial(g) ? accentColor+"40" : "transparent",color:"#fff",fontSize:10,fontWeight:700}}>
                    {isGroupSelected(g) ? "✓" : isGroupPartial(g) ? "—" : ""}
                  </span>
                  <span>{g.name}</span>
                  <span style={{marginLeft:"auto",fontSize:10,color:"#9ca3af",fontWeight:400}}>{g.codes.length} sub-agencies</span>
                </div>
                {g.children.map((c) => (
                  <div key={c.code} onClick={(e) => { e.stopPropagation(); toggleCode(c.code); }} style={{padding:"5px 12px 5px 36px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:selected.includes(c.code) ? accentColor+"08" : "transparent"}}>
                    <span style={{width:14,height:14,border:`2px solid ${selected.includes(c.code) ? accentColor : "#d1d5db"}`,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:selected.includes(c.code) ? accentColor : "transparent",color:"#fff",fontSize:9,fontWeight:700}}>{selected.includes(c.code) ? "✓" : ""}</span>
                    <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#4b5563"}}>{c.name}</span>
                    <span style={{marginLeft:"auto",fontFamily:"monospace",fontSize:10,color:"#9ca3af"}}>{c.code}</span>
                  </div>
                ))}
              </div>
            ))}
            {filtUng.length > 0 && filtGroups.length > 0 && <div style={{padding:"6px 12px",fontSize:11,color:"#9ca3af",fontWeight:600,background:"#f9fafb",borderTop:"1px solid #e5e7eb"}}>Independent Agencies</div>}
            {filtUng.map((o) => (
              <div key={o.code} onClick={() => toggleCode(o.code)} style={{padding:"6px 12px",fontSize:12,cursor:"pointer",display:"flex",alignItems:"center",gap:8,background:selected.includes(o.code) ? accentColor+"0d" : "transparent"}}>
                <span style={{width:16,height:16,border:`2px solid ${selected.includes(o.code) ? accentColor : "#d1d5db"}`,borderRadius:3,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,background:selected.includes(o.code) ? accentColor : "transparent",color:"#fff",fontSize:10,fontWeight:700}}>{selected.includes(o.code) ? "✓" : ""}</span>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{o.name}</span>
                <span style={{marginLeft:"auto",fontFamily:"monospace",fontSize:10,color:"#9ca3af"}}>{o.code}</span>
              </div>
            ))}
            {!filtGroups.length && !filtUng.length && <div style={{padding:12,fontSize:12,color:"#9ca3af",textAlign:"center"}}>No agencies match</div>}
          </div>
        </div>
      )}
    </div>
  );
}
