/* compare.js — Two-school comparison with requested tweaks (no shrink, better labels & hover partners) */
(function(){
  const DEFAULT_TYPES = new Set(["article","review","book","book-chapter"]);
  const PCA_OPACITY = 0.6;

  const clampYear = (y) => (!y ? 2021 : (y<1990?1990:(y>2100?2100:y)));
  const toInt   = (x) => { const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; };
  const debounce = (fn, wait=120) => { let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), wait); }; };
  const normalizeID = (id) => {
    const s = String(id||'').trim()
      .replace(/^[Hh][Tt][Tt][Pp][Ss]?:\/\/(?:www\.)?openalex\.org\/(?:authors\/)?/, '')
      .trim();
    return /^A\d{4,}$/.test(s) ? s : '';
  };

  function fetchJSON(url){ return fetch(url).then(r=>r.json()); }
  function fetchCSV(url){ return fetch(url).then(r=>{ if(!r.ok) throw new Error("CSV not found: "+url); return r.text(); }); }

  function parseCSV(text){
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (!lines.length) return [];
    const headers = splitRow(lines[0]);
    return lines.slice(1).map(line => {
      const cells = splitRow(line);
      const o = {};
      headers.forEach((h,i)=> o[h] = (cells[i] ?? "").trim());
      return o;
    });
  }
  function splitRow(s){
    const out=[], N=s.length; let i=0, cur="", inQ=false;
    while(i<N){
      const c=s[i];
      if (c === '"'){ inQ = !inQ; i++; continue; }
      if (c === ',' && !inQ){ out.push(cur); cur=""; i++; continue; }
      cur += c; i++;
    }
    out.push(cur);
    return out;
  }
  function unique(arr){ return Array.from(new Set(arr.filter(Boolean))); }
  function setDot(id, color){ const el=document.getElementById(id); if (el) el.style.background=color; }

  function normalizeType(t){
    const s = String(t||"").toLowerCase().trim();
    if (s === "journal-article" || s === "journal article") return "article";
    if (s === "review-article"  || s === "review article")  return "review";
    return s;
  }
  function normalizeRoster(rows){
  const byID = new Map();
  rows.forEach(r => {
    const id = normalizeID(r.OpenAlexID);
    if (!id) return;
    const score = ((r.Display_name||'').trim()?1:0) + ((r.Name||'').trim()?1:0) + ((r.Email||'').trim()?1:0);
    const prev = byID.get(id);
    if (!prev || score > prev?._score){ byID.set(id, {...r, _score: score}); }
  });
  rows.length = 0;
  byID.forEach(r => {
    const nm = (r.Display_name||r.Name||'').trim();
    rows.push({ ...r, OpenAlexID: normalizeID(r.OpenAlexID), Appointment:String(r.Appointment||'').trim(), Level:String(r.Level||'').trim(), Category:String(r.Category||'').trim(), Name:nm });
  });
}
  function buildTopicHaystack(p){
    const t1 = (p["primary_topic__display_name"] || "").trim();
    return unique([t1]);
  }
  function buildConceptHaystack(p){
    const raw = (p["concepts_list"] || "").trim();
    if (!raw) return [];
    return unique(raw.split(";").map(s=>s.trim()).filter(Boolean));
  }
  
function normalizePubs(rows){
  rows.forEach(p => {
    p.publication_year = toInt(p.publication_year || p.year);
    p.type = normalizeType(p.type || p.display_type);
    const srcs = [];
    if (typeof p["cohort_union_author_ids"] === "string" && p["cohort_union_author_ids"].trim()) srcs.push(p["cohort_union_author_ids"]);
    else if (typeof p["authorships__author__id"] === "string" && p["authorships__author__id"].trim()) srcs.push(p["authorships__author__id"]);
    else if (typeof p["authors_ids"] === "string" && p["authors_ids"].trim()) srcs.push(p["authors_ids"]);
    else if (typeof p["authors_id_list"] === "string" && p["authors_id_list"].trim()) srcs.push(p["authors_id_list"]);
    let listIDs = [];
    srcs.forEach(s => { listIDs = listIDs.concat(String(s).split(/[|;,]\s*/)); });
    listIDs = listIDs.map(normalizeID).filter(Boolean);
    p._all_author_ids = listIDs;
    p._topic_haystack   = buildTopicHaystack(p);
    p._concept_haystack = buildConceptHaystack(p);
    p._work_id = String(p.id || p.work_id || "")
      .replace(/^https?:\/\/openalex\.org\/works\//i,"")
      .replace(/^https?:\/\/openalex\.org\//i,'')
      .trim();
  });
}


  function headcount(roster, fullTimeOnly){
    if (!fullTimeOnly) return roster.length;
    const n = roster.filter(r => /^full\s*-?\s*time/i.test(String(r.Appointment||""))).length;
    return n || roster.length;
  }
  function filterToRoster(pubs, roster, yMin, yMax, types){
    const allowed = new Set(roster.map(r => normalizeID(r.OpenAlexID)));
    return pubs.filter(p => {
      if (p.publication_year < yMin || p.publication_year > yMax) return false;
      if (types && !types.has(String(p.type||"other").toLowerCase())) return false;
      const ids = Array.isArray(p._all_author_ids) ? p._all_author_ids : [];
      return ids.some(id => allowed.has(id));
    });
  }

  
function crossSchoolPubs(pubsA, pubsB, rosterA, rosterB){
  const setA = new Set(rosterA.map(r=>normalizeID(r.OpenAlexID)));
  const setB = new Set(rosterB.map(r=>normalizeID(r.OpenAlexID)));
  const byWork = new Map();
  function add(list, tag){
    list.forEach(p => {
      const k = p._work_id; if (!k) return;
      const ids = Array.isArray(p._all_author_ids) ? p._all_author_ids : [];
      if (!ids.length) return;
      const entry = byWork.get(k) || { Afile:{a:new Set(), b:new Set()}, Bfile:{a:new Set(), b:new Set()} };
      const bucket = (tag==='A'? entry.Afile : entry.Bfile);
      ids.forEach(id => { if (setA.has(id)) bucket.a.add(id); if (setB.has(id)) bucket.b.add(id); });
      byWork.set(k, entry);
    });
  }
  add(pubsA, 'A'); add(pubsB, 'B');
  const out = [];
  byWork.forEach(entry => {
    const coA = (entry.Afile.a.size && entry.Afile.b.size);
    const coB = (entry.Bfile.a.size && entry.Bfile.b.size);
    if (!coA && !coB) return;
    const aIDs = new Set(), bIDs = new Set();
    if (coA){ entry.Afile.a.forEach(x=>aIDs.add(x)); entry.Afile.b.forEach(x=>bIDs.add(x)); }
    if (coB){ entry.Bfile.a.forEach(x=>aIDs.add(x)); entry.Bfile.b.forEach(x=>bIDs.add(x)); }
    if (aIDs.size && bIDs.size){ out.push({ _aIDs: Array.from(aIDs), _bIDs: Array.from(bIDs) }); }
  });
  return out;
}

  function crossPairsSummaryList(crossList, rosterA, rosterB){
    const nameOf = new Map([...rosterA, ...rosterB].map(r => [normalizeID(r.OpenAlexID), r.Name||r.OpenAlexID]));
    const pairCount = new Map();
    crossList.forEach(v => {
      v._aIDs.forEach(a => v._bIDs.forEach(b => {
        const k = a < b ? a+"|"+b : b+"|"+a;
        pairCount.set(k, (pairCount.get(k)||0)+1);
      }));
    });
    return Array.from(pairCount.entries())
      .sort((a,b)=>b[1]-a[1])
      .map(([k,n]) => {
        const [x,y] = k.split("|");
        return { a: nameOf.get(x)||x, b: nameOf.get(y)||y, n };
      });
  }

  function termDocFreq(pubs, source){
    // Document frequency: number of papers in which a term appears at least once
    const df = new Map();
    pubs.forEach(p => {
      const terms = source==="topics" ? p._topic_haystack : p._concept_haystack;
      const seen = new Set();
      terms.forEach(t => {
        const k = String(t||"").toLowerCase();
        if (!k || seen.has(k)) return;
        seen.add(k);
        df.set(k, (df.get(k)||0)+1);
      });
    });
    return df;
  }

  function ensureExportToolbar(divId, baseName){
    const host = document.getElementById(divId);
    if (!host || host.__exportsWired) return;
    const bar = document.createElement('div');
    bar.className = 'export-toolbar btn-group';
    bar.style.gap = '6px';
    bar.style.margin = '6px 0';
    const mk = (label, fmt) => {
      const b = document.createElement('button');
      b.className = 'btn export';
      b.textContent = label;
      b.addEventListener('click', () => Plotly.downloadImage(host, {format: fmt, filename: baseName || divId}));
      return b;
    };
    const htmlBtn = document.createElement('button');
    htmlBtn.className = 'btn export';
    htmlBtn.textContent = 'HTML';
    htmlBtn.addEventListener('click', () => {
      try {
        // Clone current data & layout, but ensure generous margins & automargin for exported file
        const clonedLayout = (host.layout ? JSON.parse(JSON.stringify(host.layout)) : {});
        clonedLayout.margin = clonedLayout.margin || {t:40,r:30,b:100,l:60};
        if (clonedLayout.xaxis){ clonedLayout.xaxis.automargin = true; clonedLayout.xaxis.tickangle = clonedLayout.xaxis.tickangle ?? -30; }
        if (clonedLayout.yaxis){ clonedLayout.yaxis.automargin = true; }
        const json = { data: (host.data ? JSON.parse(JSON.stringify(host.data)) : []),
                       layout: clonedLayout };
        const title = (clonedLayout && clonedLayout.title && clonedLayout.title.text) || (baseName || divId);
        const tpl = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>${(title||'plot').replace(/</g,'&lt;')}</title><script src="https://cdn.plot.ly/plotly-latest.min.js"></script></head><body><div id="plot" style="width:100%;height:100vh;"></div><script>var payload=${JSON.stringify(json)}; Plotly.newPlot('plot', payload.data, payload.layout, {responsive:true});</script></body></html>`;
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([tpl], {type:'text/html'}));
        a.download = (baseName || divId) + ".html";
        document.body.appendChild(a); a.click(); setTimeout(()=>{URL.revokeObjectURL(a.href); a.remove();},0);
      } catch(e){ console.warn('HTML export failed', e); }
    });
    host.parentElement && host.parentElement.insertBefore(bar, host);
    bar.appendChild(mk('PNG','png'));
    bar.appendChild(mk('SVG','svg'));
    bar.appendChild(htmlBtn);
    host.__exportsWired = true;
  }

  function ensurePcaSearch(){
    let input = document.getElementById('pca-search');
    const pcaDiv = document.getElementById('pca');
    if (!pcaDiv) return;
    if (!input){
      input = document.createElement('input');
      input.type = 'search';
      input.placeholder = 'Search author…';
      input.id = 'pca-search';
      input.style.margin = '4px 0';
      pcaDiv.parentElement && pcaDiv.parentElement.insertBefore(input, pcaDiv);
    }
    if (input.__wired) return;
    input.addEventListener('input', function(){
      const q = (input.value || '').trim().toLowerCase();
      const gd = document.getElementById('pca');
      if (!gd || !gd.data) return;
      for (let idx=0; idx<gd.data.length; idx++){
        const tr = gd.data[idx];
        const labels = (tr.text || []).map(s => String(s||'').toLowerCase());
        const baseSize  = new Array(labels.length).fill(10);
        const baseOpac  = new Array(labels.length).fill(PCA_OPACITY);
        const size = !q ? baseSize : baseSize.map((sz,i)=> labels[i].includes(q) ? Math.max(sz*1.8, 14) : Math.max(Math.round(sz*0.7), 6));
        const opac = !q ? baseOpac : baseOpac.map((op,i)=> labels[i].includes(q) ? 1.0 : 0.15);
        Plotly.restyle(gd, {'marker.size':[size], 'marker.opacity':[opac]}, [idx]);
      }
    });
    input.__wired = true;
  }

  function renderYearBars(fA, fB, yMin, yMax, denomA, denomB, metaA, metaB){
    const years = []; for(let y=yMin;y<=yMax;y++) years.push(y);
    const cnt = (list, y) => list.filter(p=>p.publication_year===y).length;
    const yA = years.map(y => cnt(fA,y) / (denomA||1));
    const yB = years.map(y => cnt(fB,y) / (denomB||1));
    const trA = {name: metaA.label || "A", x:years, y:yA, type:"bar", marker:{color:metaA.color}, opacity:1.0};
    const trB = {name: metaB.label || "B", x:years, y:yB, type:"bar", marker:{color:metaB.color}, opacity:0.9};
    Plotly.newPlot("pubByYear", [trA, trB], {
      barmode:"group",
      margin:{t:28,r:18,b:50,l:60},
      yaxis:{title: (denomA===1 && denomB===1) ? "Publications" : "Publications (per capita)", automargin:true},
      xaxis:{title:"Year", dtick:1, automargin:true}
    }, {displayModeBar:true, responsive:true});
    ensureExportToolbar('pubByYear', 'compare_publications');
  }

  function buildNetwork(crossPubs, rosterA, rosterB){
    const mapA = new Map(rosterA.map(r => [normalizeID(r.OpenAlexID), (r.Name||'').trim()]));
    const mapB = new Map(rosterB.map(r => [normalizeID(r.OpenAlexID), (r.Name||'').trim()]));
    const pairMap = new Map();
    crossPubs.forEach(p => {
      p._aIDs.forEach(a => p._bIDs.forEach(b => {
        const key = a+"|"+b;
        const rec = pairMap.get(key) || { aid:a, bid:b, count:0 };
        rec.count += 1;
        pairMap.set(key, rec);
      }));
    });
    // Build adjacency for hover partners
    const partnersA = new Map(); // aid -> [{name,count}]
    const partnersB = new Map(); // bid -> [{name,count}]
    pairMap.forEach(({aid,bid,count}) => {
      const bn = mapB.get(bid) || bid;
      const an = mapA.get(aid) || aid;
      const listA = partnersA.get(aid) || []; listA.push({name: bn, count}); partnersA.set(aid, listA);
      const listB = partnersB.get(bid) || []; listB.push({name: an, count}); partnersB.set(bid, listB);
    });

    const nodeA = new Map(), nodeB = new Map();
    pairMap.forEach(({aid,bid}) => {
      if (!nodeA.has(aid)) nodeA.set(aid, { id: aid, name: mapA.get(aid) || aid });
      if (!nodeB.has(bid)) nodeB.set(bid, { id: bid, name: mapB.get(bid) || bid });
    });
    const aIDs = Array.from(nodeA.keys());
    const bIDs = Array.from(nodeB.keys());
    const pos = new Map();
    const r = 1.0;
    aIDs.forEach((id,i)=>{
      const t = Math.PI * (0.75 + 0.5 * (i + 1) / (aIDs.length + 1)); // 135..225°
      pos.set(id, { x: r*Math.cos(t), y: r*Math.sin(t) });
    });
    bIDs.forEach((id,i)=>{
      const t = -Math.PI/4 + (Math.PI/2) * (i + 1) / (bIDs.length + 1); // -45..45°
      pos.set(id, { x: r*Math.cos(t), y: r*Math.sin(t) });
    });
    const edges = Array.from(pairMap.values()).map(e => ({
      ...e,
      aName: nodeA.get(e.aid)?.name || e.aid,
      bName: nodeB.get(e.bid)?.name || e.bid,
      mx: (pos.get(e.aid).x + pos.get(e.bid).x)/2,
      my: (pos.get(e.aid).y + pos.get(e.bid).y)/2
    }));
    return {nodeA, nodeB, aIDs, bIDs, pos, edges, partnersA, partnersB};
  }

  function renderNetwork(crossPubs, A, B){
    const g = buildNetwork(crossPubs, A.roster, B.roster);
    const edgeTrace = {
      name: 'edges',
      type: 'scattergl',
      mode: 'lines',
      x: g.edges.flatMap(e => [g.pos.get(e.aid).x, g.pos.get(e.bid).x, null]),
      y: g.edges.flatMap(e => [g.pos.get(e.aid).y, g.pos.get(e.bid).y, null]),
      line: { width: 1, color: 'rgba(0,0,0,0.18)' },
      hoverinfo: 'skip',
      showlegend: false
    };
    const edgeHover = {
      name: 'edgeHover',
      type: 'scattergl',
      mode: 'markers',
      x: g.edges.map(e => e.mx),
      y: g.edges.map(e => e.my),
      marker: { size: 12, opacity: 0.01, color: 'rgba(0,0,0,0.01)' },
      text: g.edges.map(e => `${e.aName} ↔ ${e.bName} (${e.count})`),
      hovertemplate: '%{text}<extra>Cross-pair</extra>',
      showlegend: false
    };
    function nodes(ids, color, nameMap, partnersMap, partnerSchoolLabel){
      const xs=[], ys=[], labels=[], customs=[];
      ids.forEach(id => {
        const p=g.pos.get(id); xs.push(p.x); ys.push(p.y);
        const nm = nameMap.get(id)?.name || id;
        labels.push(nm);
        const partners = (partnersMap.get(id) || []).sort((a,b)=>b.count-a.count).slice(0,8)
          .map(x => `${x.name} (${x.count})`).join(', ');
        customs.push(partners ? `${partnerSchoolLabel} partners: ${partners}` : `No cross-school partners`);
      });
      return {type:'scattergl', mode:'markers+text', x:xs, y:ys, text:labels, textposition:'top center',
              marker:{size:10, opacity:0.95, line:{width:0}, color}, hovertemplate:'%{text}<br>%{customdata}<extra></extra>', customdata: customs};
    }
    const data = [
      edgeTrace, edgeHover,
      nodes(g.aIDs, A.meta.color || '#2563eb', g.nodeA, g.partnersA, B.meta.label || 'B'),
      nodes(g.bIDs, B.meta.color || '#059669', g.nodeB, g.partnersB, A.meta.label || 'A')
    ];
    Plotly.newPlot('xNetwork', data, {
      margin:{t:30,r:20,b:30,l:20},
      xaxis:{visible:false},
      yaxis:{visible:false},
      hovermode:'closest',
      showlegend:false
    }, {responsive:true});
    ensureExportToolbar('xNetwork', 'compare_network');
  }

  function renderOverlapAndEnrichment(dfA, dfB, denomA, denomB, metaA, metaB){
    const keys = Array.from(new Set([...dfA.keys(), ...dfB.keys()]));
    const arr = keys.map(k => {
      const a = (dfA.get(k)||0) / (denomA||1);
      const b = (dfB.get(k)||0) / (denomB||1);
      return {k, a, b, total:a+b, l2fc: Math.log2((a+1e-9)/(b+1e-9))};
    }).sort((x,y)=> y.total - x.total);
    const presentA = new Set([...dfA.entries()].filter(([_,v])=>v>0).map(([k])=>k));
    const presentB = new Set([...dfB.entries()].filter(([_,v])=>v>0).map(([k])=>k));
    const inter = new Set([...presentA].filter(k=>presentB.has(k)));
    const union = new Set([...presentA, ...presentB]);
    const jaccard = union.size ? inter.size/union.size : 0;
    const ov = document.getElementById("overlapPct");
    if (ov) ov.textContent = `${(100*jaccard).toFixed(1)}%`;

    const topA = arr.filter(x=>x.l2fc>0).slice(0,10);
    const topB = arr.filter(x=>x.l2fc<0).slice(0,10);
    const shared = arr.slice(0,15);
    const li = (x) => `<li>${x.k} — ${metaA.label||'A'}:${x.a.toFixed(2)}, ${metaB.label||'B'}:${x.b.toFixed(2)}</li>`;
    const liA = (x) => `<li>${x.k} <span class="muted">(log2FC vs ${metaB.label||'B'}: ${x.l2fc.toFixed(2)})</span></li>`;
    const liB = (x) => `<li>${x.k} <span class="muted">(log2FC vs ${metaA.label||'A'}: ${(-x.l2fc).toFixed(2)})</span></li>`;
    const setHTML = (id, html) => { const el=document.getElementById(id); if (el) el.innerHTML = html; };
    setHTML('sharedList', shared.map(li).join(""));
    setHTML('distinctA', topA.map(liA).join(""));
    setHTML('distinctB', topB.map(liB).join(""));
    // Update headings to include school names
    const da = document.getElementById('distinctA_title');
    const db = document.getElementById('distinctB_title');
    if (da) da.textContent = `Distinct to ${metaA.label||'A'} (Top 10 by log2FC)`;
    if (db) db.textContent = `Distinct to ${metaB.label||'B'} (Top 10 by log2FC)`;
    const tl = document.getElementById('topicListsTitle');
    if (tl) tl.textContent = `Top shared & distinct topics — ${metaA.label||'A'} vs ${metaB.label||'B'}`;

    // Bar chart with better margins/labels
    const top5A = topA.slice(0,5), top5B = topB.slice(0,5);
    const tr1 = {type:"bar", name: metaA.label||"A", x: top5A.map(d=>d.k), y: top5A.map(d=>d.l2fc), marker:{color: metaA.color||"#2563eb"}, opacity:0.95};
    const tr2 = {type:"bar", name: metaB.label||"B", x: top5B.map(d=>d.k), y: top5B.map(d=>Math.abs(d.l2fc)), marker:{color: metaB.color||"#059669"}, opacity:0.85};
    Plotly.newPlot("enrichment", [tr1, tr2], {
      barmode:"group",
      margin:{t:34,r:20,b:110,l:70},
      xaxis:{tickangle:-30, automargin:true},
      yaxis:{title:"log2 fold-change (per-capita)", automargin:true}
    }, {responsive:true});
    ensureExportToolbar('enrichment', 'compare_enrichment');
  }

  function renderPCA(A, B, yMin, yMax, source){
    function authorTerms(pubs, roster){
      const allowed = new Set(roster.map(r=>normalizeID(r.OpenAlexID)));
      const byAuthor = new Map();
      pubs.forEach(p => {
        if (p.publication_year < yMin || p.publication_year > yMax) return;
        const ids = p._all_author_ids && p._all_author_ids.length ? p._all_author_ids : [normalizeID(p.author_openalex_id)].filter(Boolean);
        const terms = source==="topics" ? p._topic_haystack : p._concept_haystack;
        ids.forEach(id => {
          if (!allowed.has(id)) return;
          let set = byAuthor.get(id); if (!set){ set = new Set(); byAuthor.set(id,set); }
          terms.forEach(t => set.add(String(t||"").toLowerCase()));
        });
      });
      return byAuthor;
    }
    const aA = authorTerms(A.perAuthor?.length ? A.perAuthor : A.dedup, A.roster);
    const aB = authorTerms(B.perAuthor?.length ? B.perAuthor : B.dedup, B.roster);
    const ids = [...aA.keys(), ...aB.keys()];
    const M = ids.length;
    if (M<3){
      document.getElementById("pcaMeta").textContent = "Too few authors for PCA.";
      Plotly.purge("pca"); return;
    }
    const termsIndex = new Map();
    const rows = [];
    ids.forEach(id => {
      const set = aA.get(id) || aB.get(id) || new Set();
      Array.from(set).forEach(t => { if(!termsIndex.has(t)) termsIndex.set(t, termsIndex.size); });
      rows.push(new Set(Array.from(set).map(t => termsIndex.get(t))));
    });
    const D = Array(M).fill(null).map(()=>Array(M).fill(0));
    for (let i=0;i<M;i++){
      for (let j=i+1;j<M;j++){
        const si = rows[i], sj = rows[j];
        const inter = [...si].filter(x=>sj.has(x)).length;
        const uni = new Set([...si, ...sj]).size || 1;
        const dist = 1 - (inter/uni);
        D[i][j]=D[j][i]=dist;
      }
    }
    const coords = mdsClassic(D, 2);
    const nameOf = new Map([...A.roster, ...B.roster].map(r => [normalizeID(r.OpenAlexID), r.Name||r.OpenAlexID]));
    const belongA = new Set(aA.keys()), belongB = new Set(aB.keys());
    const ptsA = [], ptsB = [];
    coords.forEach((xy, idx)=>{
      const id = ids[idx];
      const point = { x: xy[0], y: xy[1], text: (nameOf.get(id)||id), customdata: id };
      if (belongA.has(id)) ptsA.push(point); else ptsB.push(point);
    });
    Plotly.newPlot("pca", [
      {name: A.meta.label||"A", type:"scatter", mode:"markers",
       x: ptsA.map(p=>p.x), y: ptsA.map(p=>p.y), text: ptsA.map(p=>p.text),
       customdata: ptsA.map(p=>p.customdata), marker:{size:10, line:{width:0}, opacity:PCA_OPACITY, color:A.meta.color||"#2563eb"}},
      {name: B.meta.label||"B", type:"scatter", mode:"markers",
       x: ptsB.map(p=>p.x), y: ptsB.map(p=>p.y), text: ptsB.map(p=>p.text),
       customdata: ptsB.map(p=>p.customdata), marker:{size:10, line:{width:0}, opacity:PCA_OPACITY, color:B.meta.color||"#059669"}}
    ], {margin:{t:28,r:18,b:50,l:60}, hovermode:"closest"}, {responsive:true});
    ensureExportToolbar('pca', 'compare_pca');
    ensurePcaSearch();
    document.getElementById("pcaMeta").textContent = `Authors: ${A.meta.label||'A'}=${ptsA.length}, ${B.meta.label||'B'}=${ptsB.length}. Terms=${termsIndex.size}.`;
    const pcaTitle = document.getElementById('pca-title');
    if (pcaTitle) pcaTitle.textContent = `Author–topic PCA — ${A.meta.label||'A'} vs ${B.meta.label||'B'}`;
  }

  function mdsClassic(D, dim){
    const n = D.length;
    const D2 = D.map(row => row.map(v => v*v));
    const rowMean = D2.map(r => r.reduce((a,b)=>a+b,0)/n);
    const colMean = Array(n).fill(0);
    for (let j=0;j<n;j++){ colMean[j] = D2.reduce((a,row)=>a+row[j],0)/n; }
    const totalMean = rowMean.reduce((a,b)=>a+b,0)/n;
    const B = Array(n).fill(null).map(()=>Array(n).fill(0));
    for (let i=0;i<n;i++){
      for (let j=0;j<n;j++){
        B[i][j] = -0.5 * (D2[i][j] - rowMean[i] - colMean[j] + totalMean);
      }
    }
    function dot(a,b){ let s=0; for (let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
    function mult(M, v){ const out=Array(n).fill(0); for (let i=0;i<n;i++){ let s=0; for (let j=0;j<n;j++) s+=M[i][j]*v[j]; out[i]=s; } return out; }
    function gs(V){
      const U = [];
      for (const v of V){
        let u = v.slice();
        for (const w of U){
          const proj = dot(u,w)/Math.max(dot(w,w),1e-12);
          for (let i=0;i<n;i++) u[i]-=proj*w[i];
        }
        const norm = Math.sqrt(Math.max(dot(u,u),1e-12));
        for (let i=0;i<n;i++) u[i]/=norm;
        U.push(u);
      }
      return U;
    }
    let V = gs([Array(n).fill(0).map(()=>Math.random()), Array(n).fill(0).map(()=>Math.random())]);
    for (let t=0;t<120;t++) V = gs(V.map(v => mult(B,v)));
    const vals = V.map(v => dot(v, mult(B,v)));
    const lambda = vals.map(v=>Math.max(v,0));
    const coords = Array(n).fill(null).map(()=>Array(dim).fill(0));
    for (let i=0;i<n;i++){
      for (let d=0; d<dim; d++){
        coords[i][d] = V[d][i] * Math.sqrt(lambda[d]||0);
      }
    }
    return coords;
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const cfg = await fetchJSON("compare_config.json");
    const schoolKeys = Object.keys(cfg.schools);
    const selA = document.getElementById("schoolA");
    const selB = document.getElementById("schoolB");
    schoolKeys.forEach(k => {
      const o1 = new Option(cfg.schools[k].label || k, k);
      const o2 = new Option(cfg.schools[k].label || k, k);
      selA.add(o1); selB.add(o2);
    });
    selA.value = cfg.defaults?.A || schoolKeys[0];
    selB.value = cfg.defaults?.B || (schoolKeys[1] || schoolKeys[0]);
    document.getElementById("yearMin").value = cfg.defaults?.yearMin || 2021;
    document.getElementById("yearMax").value = cfg.defaults?.yearMax || 2025;
    setDot("dotA", cfg.schools[selA.value].color || "#2563eb");
    setDot("dotB", cfg.schools[selB.value].color || "#059669");

    document.getElementById("swap-btn").addEventListener("click", (e)=>{
      e.preventDefault();
      const a = selA.value, b = selB.value;
      selA.value = b; selB.value = a;
      update();
    });
    selA.addEventListener("change", ()=>{ setDot("dotA", cfg.schools[selA.value].color||"#2563eb"); update(); });
    selB.addEventListener("change", ()=>{ setDot("dotB", cfg.schools[selB.value].color||"#059669"); update(); });
    ["perCapita","fullTimeOnly","useTopics","normalizeTypes","yearMin","yearMax"].forEach(id=>{
      const ctl = document.getElementById(id);
      ctl && ctl.addEventListener("input", debounce(update, 120));
    });
    document.getElementById("reset").addEventListener("click", ()=>{
      document.getElementById("perCapita").checked = true;    // default ON
      document.getElementById("fullTimeOnly").checked = true;
      document.getElementById("useTopics").checked = true;
      document.getElementById("normalizeTypes").checked = true;
      document.getElementById("yearMin").value = cfg.defaults?.yearMin || 2021;
      document.getElementById("yearMax").value = cfg.defaults?.yearMax || 2025;
      selA.value = cfg.defaults?.A || schoolKeys[0];
      selB.value = cfg.defaults?.B || (schoolKeys[1] || schoolKeys[0]);
      update();
    });

    const cache = new Map();
    async function loadSchool(key){
      if (cache.has(key)) return cache.get(key);
      const sc = cfg.schools[key];
      const [roster, perAuthor, dedup] = await Promise.all([
        fetchCSV(sc.roster).then(parseCSV),
        fetchCSV(sc.perAuthor).then(parseCSV).catch(()=>[]),
        fetchCSV(sc.dedup).then(parseCSV)
      ]);
      normalizeRoster(roster);
      normalizePubs(dedup);
      if (perAuthor?.length) normalizePubs(perAuthor);
      const pkg = { roster, perAuthor, dedup, meta: sc };
      cache.set(key, pkg);
      return pkg;
    }

    async function update(){
      const [A, B] = await Promise.all([loadSchool(selA.value), loadSchool(selB.value)]);
      const yMin = clampYear(+document.getElementById("yearMin").value || 2021);
      const yMax = clampYear(+document.getElementById("yearMax").value || 2025);
      const perCapita = document.getElementById("perCapita").checked;
      const fullTimeOnly = document.getElementById("fullTimeOnly").checked;
      const useTopics = document.getElementById("useTopics").checked;
      const normTypes = document.getElementById("normalizeTypes").checked;
      const types = normTypes ? DEFAULT_TYPES : null;

      const denomA = headcount(A.roster, fullTimeOnly);
      const denomB = headcount(B.roster, fullTimeOnly);
      document.getElementById("nameA").textContent = A.meta.label || selA.value;
      document.getElementById("nameB").textContent = B.meta.label || selB.value;
      document.getElementById("denomA").textContent = denomA;
      document.getElementById("denomB").textContent = denomB;

      // Update captions/titles with school names
      const xnetTitle = document.getElementById('xnetwork-title');
      if (xnetTitle) xnetTitle.textContent = `Cross-school co-authorship network — ${A.meta.label||'A'} ↔ ${B.meta.label||'B'}`;
      const enrTitle = document.getElementById('enrichment-title');
      if (enrTitle) enrTitle.textContent = `Strengths & gaps — ${A.meta.label||'A'} vs ${B.meta.label||'B'}`;

      const fA = filterToRoster(A.dedup, A.roster, yMin, yMax, types);
      const fB = filterToRoster(B.dedup, B.roster, yMin, yMax, types);

      const crossPubs = crossSchoolPubs(fA, fB, A.roster, B.roster);
      document.getElementById("xschoolPubs").textContent = crossPubs.length;

      const pairs = crossPairsSummaryList(crossPubs, A.roster, B.roster);
      const ul = document.getElementById('xschoolPairs');
      if (ul){
        ul.innerHTML = pairs.slice(0,200).map(p => `<li>${p.a} ↔ ${p.b} <span class="muted">(${p.n})</span></li>`).join('');
      }

      renderYearBars(fA, fB, yMin, yMax, perCapita ? denomA : 1, perCapita ? denomB : 1, A.meta, B.meta);

      const source = useTopics ? "topics" : "concepts";
      const dfA = termDocFreq(fA, source);
      const dfB = termDocFreq(fB, source);
      renderOverlapAndEnrichment(dfA, dfB, perCapita ? denomA : 1, perCapita ? denomB : 1, A.meta, B.meta);

      renderPCA(A, B, yMin, yMax, source);
      renderNetwork(crossPubs, A, B);

      document.getElementById("loading-banner")?.classList.add("hidden");
    }

    update().catch(err => {
      console.error(err);
      const lb = document.getElementById("loading-banner");
      if (lb) lb.textContent = "Failed to load data.";
    });
  });
})();
