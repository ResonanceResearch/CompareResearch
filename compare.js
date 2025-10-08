
/* compare.js — Two‑school comparison built to reuse single‑school outputs.
   Assumes a config JSON at compare_config.json mapping keys -> file paths:
   {
     "schools": {
        "UCVM": {
           "label": "UCVM",
           "color": "#2563eb",
           "roster": "data/UCVM/roster_with_metrics.csv",
           "perAuthor": "data/UCVM/openalex_all_authors_last5y_key_fields_dedup_per_author.csv",
           "dedup": "data/UCVM/openalex_all_authors_last5y_key_fields_dedup.csv"
        },
        "OVC": {
           "label": "OVC",
           "color": "#059669",
           "roster": "data/OVC/roster_with_metrics.csv",
           "perAuthor": "data/OVC/openalex_all_authors_last5y_key_fields_dedup_per_author.csv",
           "dedup": "data/OVC/openalex_all_authors_last5y_key_fields_dedup.csv"
        }
     },
     "defaults": { "A": "UCVM", "B": "OVC", "yearMin": 2021, "yearMax": 2025 }
   }
*/
(function(){
  const DEFAULT_TYPES = new Set(["article","review","book","book-chapter"]);
  const OPA = 0.35; // default marker opacity for non-focused
  const PCA_OPA = 0.6;

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
    selB.value = cfg.defaults?.B || schoolKeys[1] || schoolKeys[0];

    document.getElementById("yearMin").value = cfg.defaults?.yearMin || 2021;
    document.getElementById("yearMax").value = cfg.defaults?.yearMax || 2025;

    const setDot = (id, color) => { const el = document.getElementById(id); if (el) el.style.background = color; };
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
      document.getElementById(id).addEventListener("input", debounce(update, 120));
    });
    document.getElementById("reset").addEventListener("click", ()=>{
      document.getElementById("perCapita").checked = false;
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
      const keyA = selA.value, keyB = selB.value;
      const [A, B] = await Promise.all([loadSchool(keyA), loadSchool(keyB)]);
      // year bounds
      const yMin = clampYear(+document.getElementById("yearMin").value || 2021);
      const yMax = clampYear(+document.getElementById("yearMax").value || 2025);
      const perCapita = document.getElementById("perCapita").checked;
      const fullTimeOnly = document.getElementById("fullTimeOnly").checked;
      const useTopics = document.getElementById("useTopics").checked;
      const normTypes = document.getElementById("normalizeTypes").checked;

      const types = normTypes ? DEFAULT_TYPES : null;

      // Denominators
      const denomA = headcount(A.roster, fullTimeOnly);
      const denomB = headcount(B.roster, fullTimeOnly);
      document.getElementById("nameA").textContent = A.meta.label || keyA;
      document.getElementById("nameB").textContent = B.meta.label || keyB;
      document.getElementById("denomA").textContent = denomA;
      document.getElementById("denomB").textContent = denomB;

      // Filtered pubs by window + type + author in roster
      const fA = filterToRoster(A.dedup, A.roster, yMin, yMax, types);
      const fB = filterToRoster(B.dedup, B.roster, yMin, yMax, types);

      // KPI: cross-school coauth pubs (any pub with at least one author from A and one from B)
      const crossPubs = crossSchoolPubs(fA, fB, A.roster, B.roster);
      // Cross‑school network & expandable pairs table
      try {
        renderXSchoolNetwork(crossPubs, A, B);
        renderXSchoolPairs(crossPubs, A, B);
      } catch(e){ console.warn("Network render failed:", e); }

      // Ensure PCA search UI (highlight without recomputing PCA)
      try { ensurePcaSearchUI(); } catch(_) {}

      // Wire export buttons (PNG, SVG, HTML) for all charts
      try { wireCompareExports(); } catch(_) {}

      document.getElementById("xschoolPubs").textContent = crossPubs.length;
      document.getElementById("xschoolPairs").textContent = crossPairsSummary(crossPubs, A.roster, B.roster);

      // PUBS BY YEAR (grouped)
      renderYearBars(fA, fB, yMin, yMax, perCapita ? denomA : 1, perCapita ? denomB : 1, A.meta.color, B.meta.color);

      // TOPIC ENRICHMENT & OVERLAP
      const source = useTopics ? "topics" : "concepts";
      const dfA = termDocFreq(fA, source);
      const dfB = termDocFreq(fB, source);
      renderOverlapAndEnrichment(dfA, dfB, perCapita ? denomA : 1, perCapita ? denomB : 1, A.meta, B.meta);

      // PCA — author by topic sets, color by school
      renderPCA(A, B, yMin, yMax, source);

      document.getElementById("loading-banner")?.classList.add("hidden");
    }

    // Initial render
    update().catch(err => { console.error(err); document.getElementById("loading-banner").textContent = "Failed to load data."; });
  });

  // ---------------- utilities ----------------
  function debounce(fn, ms){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,a),ms); }; }
  function clampYear(y){ if(!y) return 2021; if (y<1990) return 1990; if (y>2100) return 2100; return y; }
  function normalizeID(id){ return String(id||'').replace(/^https?:\/\/openalex\.org\/authors\//i,'').replace(/^https?:\/\/openalex\.org\//i,'').trim(); }
  function fetchCSV(path){ return fetch(path).then(r=>{ if(!r.ok) throw new Error("CSV not found: "+path); return r.text(); }); }
  function fetchJSON(path){ return fetch(path).then(r=>r.json()); }

  function parseCSV(text){
    // Simple, robust CSV parser for your existing exports (no commas in numeric cols, quotes ok)
    const lines = text.split(/\r?\n/).filter(Boolean);
    if(!lines.length) return [];
    const headers = lines[0].split(",").map(h=>h.trim());
    return lines.slice(1).map(line => {
      const cells = splitCSV(line, headers.length);
      const o = {};
      headers.forEach((h,i)=> o[h] = cells[i] ?? "");
      return o;
    });
  }
  function splitCSV(line, nCols){
    // supports quotes and embedded commas
    const out=[], s=line; let i=0, cur="", inQ=false;
    while(i<s.length){
      const c=s[i];
      if(c=='"'){ inQ = !inQ; i++; continue; }
      if(c=="," && !inQ){ out.push(cur); cur=""; i++; continue; }
      cur+=c; i++;
    }
    out.push(cur);
    while(out.length<nCols) out.push("");
    return out.map(x=>x.trim());
  }

  function toInt(x){ const n = Number(x); return Number.isFinite(n) ? Math.round(n) : 0; }
  function toFloat(x){ const n = Number(x); return Number.isFinite(n) ? n : NaN; }

  // ---------------- normalization reused from single‑school ----------------
  function normalizeRoster(rows){
    rows.forEach(r => {
      r.OpenAlexID = normalizeID(r.OpenAlexID);
      r.Appointment = String(r.Appointment||"").trim();
      r.Level = String(r.Level||"").trim();
      r.Category = String(r.Category||"").trim();
      // RG columns (RG1..RGN) handled elsewhere if needed
    });
  }
  function normalizeType(t){
    const s = String(t||"").toLowerCase().trim();
    if (s === "journal-article" || s === "journal article") return "article";
    if (s === "review-article" || s === "review article") return "review";
    return s;
  }
   function normalizePubs(rows){
     rows.forEach(p => {
       p.publication_year = toInt(p.publication_year || p.year);
       p.type = normalizeType(p.type || p.display_type);
   
       // All OpenAlex author IDs on this paper (preferred)
       const rawList = String(p["authorships__author__id"] || "").trim();
       const listIDs = rawList
         ? rawList.split("|").map(normalizeID).filter(Boolean)
         : [];
   
       // Fallback (per-author exports)
       const single = normalizeID(p.author_openalex_id || p.OpenAlexID || p.author_id);
   
       // Canonical: array of author IDs for this row
       p._all_author_ids = listIDs.length ? listIDs : (single ? [single] : []);
   
       // Pre-tokenize terms
       p._topic_haystack   = buildTopicHaystack(p);
       p._concept_haystack = buildConceptHaystack(p);
     });
   }


   function buildTopicHaystack(p){
     // Single curated topic from your export
     const t1 = (p["primary_topic__display_name"] || "").trim();
     return unique([t1]).filter(Boolean);
   }
   
   function buildConceptHaystack(p){
     // Semicolon-separated list
     const raw = (p["concepts_list"] || "").trim();
     if (!raw) return [];
     return unique(raw.split(";").map(s => s.trim()).filter(Boolean));
   }

  function unique(arr){ return Array.from(new Set(arr.filter(Boolean))); }

  // ---------------- filtering & denominators ----------------
  function headcount(roster, fullTimeOnly){
    if(!fullTimeOnly) return roster.length;
    return roster.filter(r => /^full\s*-?\s*time/i.test(String(r.Appointment||""))).length || roster.length;
  }
   function filterToRoster(pubs, roster, yMin, yMax, types){
     const allowed = new Set(roster.map(r => normalizeID(r.OpenAlexID)));
     return pubs.filter(p => {
       if (p.publication_year < yMin || p.publication_year > yMax) return false;
       if (types && !types.has(String(p.type||"other").toLowerCase())) return false;
       const ids = Array.isArray(p._all_author_ids) ? p._all_author_ids : [];
       // keep if ANY paper author is in this school’s roster
       return ids.some(id => allowed.has(id));
     });
   }

  // ---------------- cross‑school pubs & pairs ----------------
  function crossSchoolPubs(pubsA, pubsB, rosterA, rosterB){
    const setIdsA = new Set(rosterA.map(r=>normalizeID(r.OpenAlexID)));
    const setIdsB = new Set(rosterB.map(r=>normalizeID(r.OpenAlexID)));

    // Make a map work_id -> authors(normalized) from A or B across both lists
    const m = new Map();
    const wid = p => String(p.id || p.work_id || "").replace(/^https?:\/\/openalex\.org\/works\//i,"").replace(/^https?:\/\/openalex\.org\//i,'');
    function addList(list){
      list.forEach(p => {
        const k = wid(p);
        if(!k) return;
        const ids = (String(p["authorships__author__id"]||"").split("|").map(normalizeID));
        const cur = m.get(k) || { a:false, b:false, aIDs:new Set(), bIDs:new Set(), sample:p };
        ids.forEach(id => {
          if (setIdsA.has(id)) { cur.a = true; cur.aIDs.add(id); }
          if (setIdsB.has(id)) { cur.b = true; cur.bIDs.add(id); }
        });
        m.set(k, cur);
      });
    }
    addList(pubsA); addList(pubsB);
    return Array.from(m.values())
     .filter(v => v.a && v.b)
     .map(v => ({
       _aIDs: Array.from(v.aIDs),
       _bIDs: Array.from(v.bIDs)
     }));
  }
  function crossPairsSummary(crossList, rosterA, rosterB){
    const nameOf = new Map([...rosterA, ...rosterB].map(r => [normalizeID(r.OpenAlexID), r.Name||r.OpenAlexID]));
    const pairCount = new Map(); // key "AID|BID" with sorted
       crossList.forEach(v => {
          const aList = Array.isArray(v._aIDs) ? v._aIDs : (Array.isArray(v.aIDs) ? v.aIDs : []);
          const bList = Array.isArray(v._bIDs) ? v._bIDs : (Array.isArray(v.bIDs) ? v.bIDs : []);
          aList.forEach(aid => bList.forEach(bid => {
      
        const k = aid < bid ? aid+"|"+bid : bid+"|"+aid;
        pairCount.set(k, (pairCount.get(k)||0)+1);
      }));
    });
    const arr = Array.from(pairCount.entries()).sort((a,b)=>b[1]-a[1]).slice(0,8);
    return arr.map(([k,n])=>{
      const [a,b] = k.split("|");
      return `${nameOf.get(a)||a} ↔ ${nameOf.get(b)||b} (${n})`;
    }).join("; ");
  }

  // ---------------- pubs by year chart ----------------
  function renderYearBars(fA, fB, yMin, yMax, denomA, denomB, colorA, colorB){
    const yRange = [];
    for (let y=yMin; y<=yMax; y++) yRange.push(y);
    const count = (list, year) => list.filter(p=>p.publication_year===year).length;
    const yA = yRange.map(y => count(fA,y) / (denomA||1));
    const yB = yRange.map(y => count(fB,y) / (denomB||1));
    const trA = {name:"A", x:yRange, y:yA, type:"bar", marker:{color:colorA}, opacity:1.0};
    const trB = {name:"B", x:yRange, y:yB, type:"bar", marker:{color:colorB}, opacity:0.9};
    Plotly.newPlot("pubByYear", [trA, trB], {
      barmode:"group", margin:{t:28,r:18,b:40,l:50},
      yaxis:{title: denomA===1 && denomB===1? "Publications": "Publications (per capita)"},
      xaxis:{title:"Year", dtick:1}
    }, {displayModeBar:true, responsive:true});
    const meta = document.getElementById("pubMeta");
    meta.textContent = `Window ${yMin}–${yMax}. Totals: A=${fA.length}${denomA!==1?" (per‑capita shown)":""}, B=${fB.length}${denomB!==1?" (per‑capita shown)":""}`;
  }

  // ---------------- term DF, overlap, enrichment ----------------
  function termDocFreq(pubs, source){
    const df = new Map();
    pubs.forEach(p => {
      const terms = source==="topics" ? p._topic_haystack : p._concept_haystack;
      const seen = new Set();
      terms.forEach(t => {
        const k = String(t||"").toLowerCase();
        if(!k || seen.has(k)) return;
        seen.add(k);
        df.set(k, (df.get(k)||0)+1);
      });
    });
    return df;
  }
  function renderOverlapAndEnrichment(dfA, dfB, denomA, denomB, metaA, metaB){
    const keys = unique([...dfA.keys(), ...dfB.keys()]);
    const arr = keys.map(k => {
      const a = (dfA.get(k)||0) / (denomA||1);
      const b = (dfB.get(k)||0) / (denomB||1);
      const total = a+b, jacc = total? (Math.min(a,b)/Math.max(a,b)) : 0;
      return {k, a, b, total, l2fc: Math.log2((a+1e-9)/(b+1e-9))};
    }).sort((x,y)=> y.total - x.total);
    // overlap = jaccard over presence (not weighted)
    const presentA = new Set([...dfA.entries()].filter(([k,v])=>v>0).map(([k])=>k));
    const presentB = new Set([...dfB.entries()].filter(([k,v])=>v>0).map(([k])=>k));
    const inter = new Set([...presentA].filter(k=>presentB.has(k)));
    const union = new Set([...presentA, ...presentB]);
    const jaccard = union.size ? (inter.size/union.size) : 0;
    const ov = document.getElementById("overlapPct");
    ov.textContent = `${(100*jaccard).toFixed(1)}%`;

    // Top distinct by |log2FC|
    const topA = arr.filter(x=>x.l2fc>0).slice(0,10);
    const topB = arr.filter(x=>x.l2fc<0).slice(0,10);
    document.getElementById("sharedList").innerHTML = arr.slice(0,15).map(x=>`<li>${x.k} — A:${x.a.toFixed(2)}, B:${x.b.toFixed(2)}</li>`).join("");
    document.getElementById("distinctA").innerHTML = topA.map(x=>`<li>${x.k} <span class="muted">(log2FC vs B: ${x.l2fc.toFixed(2)})</span></li>`).join("");
    document.getElementById("distinctB").innerHTML = topB.map(x=>`<li>${x.k} <span class="muted">(log2FC vs A: ${(-x.l2fc).toFixed(2)})</span></li>`).join("");

    // Simple bar chart of top5 per side
    const top5A = topA.slice(0,5), top5B = topB.slice(0,5);
    const tr1 = {type:"bar", name: metaA.label||"A", x: top5A.map(d=>d.k), y: top5A.map(d=>d.l2fc), marker:{color: metaA.color||"#2563eb"}, opacity:0.95};
    const tr2 = {type:"bar", name: metaB.label||"B", x: top5B.map(d=>d.k), y: top5B.map(d=>Math.abs(d.l2fc)), marker:{color: metaB.color||"#059669"}, opacity:0.80};
    Plotly.newPlot("enrichment", [tr1, tr2], {
      barmode:"group", margin:{t:30,r:20,b:80,l:50}, xaxis:{tickangle:-25}, yaxis:{title:"log2 fold‑change (per‑capita)"}}, {responsive:true});
  }

  // ---------------- PCA ----------------
  function renderPCA(A, B, yMin, yMax, source){
    // Build author -> set of terms (topics/concepts) for window
   function authorTerms(pubs, roster){
     const allowed = new Set(roster.map(r=>normalizeID(r.OpenAlexID)));
     const byAuthor = new Map();
     pubs.forEach(p => {
       if (p.publication_year < yMin || p.publication_year > yMax) return;
   
       const ids = Array.isArray(p._all_author_ids) && p._all_author_ids.length
         ? p._all_author_ids
            : [normalizeID(p.author_openalex_id)].filter(Boolean);
      
          const terms = source==="topics" ? p._topic_haystack : p._concept_haystack;
      
          ids.forEach(id => {
            if (!allowed.has(id)) return;
            let set = byAuthor.get(id);
            if (!set) { set = new Set(); byAuthor.set(id, set); }
            terms.forEach(t => set.add(String(t||"").toLowerCase()));
          });
        });
        return byAuthor;
      }

    const aA = authorTerms(A.perAuthor?.length ? A.perAuthor : A.dedup, A.roster);
    const aB = authorTerms(B.perAuthor?.length ? B.perAuthor : B.dedup, B.roster);

    // Union authors + compute Jaccard distances
    const ids = [...aA.keys(), ...aB.keys()];
    const M = ids.length;
    if (M<3){ document.getElementById("pcaMeta").textContent = "Too few authors for PCA."; Plotly.purge("pca"); return; }

    const termsIndex = new Map();
    // Build binary matrix (authors x terms) for Jaccard PCA
    let row = 0;
    const X = [];
    ids.forEach(id => {
      const set = aA.get(id) || aB.get(id) || new Set();
      const arr = Array.from(set);
      arr.forEach(t => { if(!termsIndex.has(t)) termsIndex.set(t, termsIndex.size); });
      X.push(set);
      row++;
    });
    const P = termsIndex.size;
    // Convert to sparse binary matrix (rows of indices)
    const rows = X.map(set => Array.from(set).map(t => termsIndex.get(t)));

    // Compute pairwise Jaccard distances and then classical MDS to 2D
    const D = Array(M).fill(null).map(()=>Array(M).fill(0));
    for (let i=0;i<M;i++){
      for (let j=i+1;j<M;j++){
        const si = new Set(rows[i]); const sj = new Set(rows[j]);
        const inter = new Set([...si].filter(x=>sj.has(x))).size;
        const uni = new Set([...si, ...sj]).size || 1;
        const dist = 1 - (inter/uni);
        D[i][j]=D[j][i]=dist;
      }
    }
    const coords = mdsClassic(D, 2); // [[x,y], ...]

    // Color & hover by school
    const nameOf = new Map([...A.roster, ...B.roster].map(r => [normalizeID(r.OpenAlexID), r.Name||r.OpenAlexID]));
    const belongA = new Set(aA.keys());
    const belongB = new Set(aB.keys());

    const ptsA = []; const ptsB = [];
    coords.forEach((xy, idx)=>{
      const id = ids[idx];
      const point = { x: xy[0], y: xy[1], text: (nameOf.get(id)||id), customdata: id };
      if (belongA.has(id)) ptsA.push(point);
      else ptsB.push(point);
    });
    Plotly.newPlot("pca", [
      {name: A.meta.label||"A", type:"scatter", mode:"markers",
       x: ptsA.map(p=>p.x), y: ptsA.map(p=>p.y), text: ptsA.map(p=>p.text),
       customdata: ptsA.map(p=>p.customdata), marker:{size:10, line:{width:0}, opacity:PCA_OPA, color:A.meta.color||"#2563eb"}},
      {name: B.meta.label||"B", type:"scatter", mode:"markers",
       x: ptsB.map(p=>p.x), y: ptsB.map(p=>p.y), text: ptsB.map(p=>p.text),
       customdata: ptsB.map(p=>p.customdata), marker:{size:10, line:{width:0}, opacity:PCA_OPA, color:B.meta.color||"#059669"}}
    ], {margin:{t:28,r:18,b:40,l:50}, hovermode:"closest"}, {responsive:true});
    document.getElementById("pcaMeta").textContent = `Authors: A=${ptsA.length}, B=${ptsB.length}. Terms=${P}.`;
  }

  function mdsClassic(D, dim){
    // Classical MDS: double-centering then eigen-decomp of B = -0.5 * J D^2 J
    const n = D.length;
    // compute squared distances and row/col/total means
    const D2 = D.map(row => row.map(v => v*v));
    const rowMean = D2.map(r => r.reduce((a,b)=>a+b,0)/n);
    const colMean = Array(n).fill(0);
    for (let j=0;j<n;j++){ colMean[j] = D2.reduce((a,row)=>a+row[j],0)/n; }
    const totalMean = rowMean.reduce((a,b)=>a+b,0)/n;
    // B matrix
    const B = Array(n).fill(null).map(()=>Array(n).fill(0));
    for (let i=0;i<n;i++){
      for (let j=0;j<n;j++){
        B[i][j] = -0.5 * (D2[i][j] - rowMean[i] - colMean[j] + totalMean);
      }
    }
    // power iteration for top-2 eigenvectors (simple, sufficient here)
    function eigPower(mat, k=2, iters=100){
      const n = mat.length;
      // start with random vectors
      let vecs = Array(k).fill(null).map(()=>Array(n).fill(0).map(()=>Math.random()));
      // Gram-Schmidt orthonormalize
      function gs(V){
        const U = [];
        for (const v of V){
          let u = v.slice();
          for (const w of U){
            const proj = dot(u,w)/dot(w,w);
            for (let i=0;i<n;i++) u[i]-=proj*w[i];
          }
          const norm = Math.sqrt(dot(u,u))||1;
          for (let i=0;i<n;i++) u[i]/=norm;
          U.push(u);
        }
        return U;
      }
      function dot(a,b){ let s=0; for (let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
      function mult(M, v){ const out=Array(n).fill(0); for (let i=0;i<n;i++){ let s=0; for (let j=0;j<n;j++) s+=M[i][j]*v[j]; out[i]=s; } return out; }
      let V = gs(vecs);
      for (let t=0;t<iters;t++){
        V = gs(V.map(v => mult(mat,v)));
      }
      // eigenvalues approx
      const vals = V.map(v => dot(v, mult(mat,v)));
      return {vectors:V, values:vals};
    }
    const {vectors:V, values:vals} = mdsClassic._cache || eigPower(B, 2, 120);
    mdsClassic._cache = {vectors:V, values:vals};
    // coords = V * sqrt(Lambda+)
    const lambda = vals.map(v=>Math.max(v,0));
    const coords = Array(n).fill(null).map(()=>Array(2).fill(0));
    for (let i=0;i<n;i++){
      for (let d=0; d<2; d++){
        coords[i][d] = V[d][i] * Math.sqrt(lambda[d]||0);
      }
    }
    return coords;
  }

})();


// --- utils (add these) ---
const normalizeID = window.normalizeID || function(id){
  if (id == null) return '';
  const s = String(id).trim();
  if (!s) return '';
  // Strip OpenAlex URL prefix if present, keep canonical author IDs like "A123456789"
  return s.replace(/^https?:\/\/(?:www\.)?openalex\.org\//i, '');
};

// (only if you don’t already have a debounce in this file)
const debounce = window.debounce || function(fn, wait){
  let t;
  return function(...args){
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, args), wait);
  };
};

// ====================== Cross‑school network & pairs ======================
function getNetworkContainerId(){
  // If a dedicated target already exists, use it.
  if (document.getElementById('xschool-network')) return 'xschool-network';
  if (document.getElementById('coauthor-network')) return 'coauthor-network';

  // Prefer a known panel slot *inside* the dashboard:
  // (try these in order; keep any that match your markup)
  const target =
    document.querySelector('#panel-network .panel-body') ||
    document.querySelector('#panel-network') ||
    document.querySelector('#network-panel') ||
    document.querySelector('#network-wrapper') ||
    document.querySelector('#charts .grid-2x2') ||
    document.querySelector('#charts-grid') ||
    document.querySelector('.grid-2x2');

  // Create the container in the chosen panel/grid
  const host = target || document.body;               // fallback is body (last resort)
  const el = document.createElement('div');
  el.id = 'xschool-network';
  el.className = 'chart network-chart';               // keep same classes as your other charts/cards
  host.appendChild(el);
  return 'xschool-network';
}


function buildXSchoolGraph(crossPubs, rosterA, rosterB){
  // roster arrays -> quick lookups
  const mapA = new Map(rosterA.map(r => [normalizeID(r.OpenAlexID), (r.Display_name || r.Name || '').trim()]));
  const mapB = new Map(rosterB.map(r => [normalizeID(r.OpenAlexID), (r.Display_name || r.Name || '').trim()]));
  // pairs keyed as "aid|bid"
  const pairMap = new Map();
  crossPubs.forEach(p => {
    const aIDs = Array.isArray(p._aIDs) ? p._aIDs : [];  // set by crossSchoolPubs
    const bIDs = Array.isArray(p._bIDs) ? p._bIDs : [];
    aIDs.forEach(a => {
      bIDs.forEach(b => {
        const aid = normalizeID(a), bid = normalizeID(b);
        const key = aid + "|" + bid;
        const rec = pairMap.get(key) || { aid, bid, works: [] };
        rec.works.push(p);
        pairMap.set(key, rec);
      });
    });
  });

  // Nodes: authors that appear in at least one cross‑school pair
  const nodeA = new Map();
  const nodeB = new Map();
  for (const {aid, bid} of pairMap.values()){
    if (!nodeA.has(aid)) nodeA.set(aid, { id: aid, name: mapA.get(aid) || aid });
    if (!nodeB.has(bid)) nodeB.set(bid, { id: bid, name: mapB.get(bid) || bid });
  }

  // Deterministic semicircle layout
  const r = 1.0;
  const aIDs = Array.from(nodeA.keys());
  const bIDs = Array.from(nodeB.keys());
  const pos = new Map();
  aIDs.forEach((id, i) => {
    const t = Math.PI * (0.75 + 0.5 * (i + 1) / (aIDs.length + 1)); // 135°..225°
    pos.set(id, { x: r*Math.cos(t), y: r*Math.sin(t) });
  });
  bIDs.forEach((id, i) => {
    const t = Math.PI * (0.25 * (i + 1) / (bIDs.length + 1)); // 0°..45°, but make it  -45°..45°
    const t2 = -Math.PI/4 + (Math.PI/2) * (i + 1) / (bIDs.length + 1);
    pos.set(id, { x: r*Math.cos(t2), y: r*Math.sin(t2) });
  });

  // Edge arrays
  const ex = [], ey = [];
  const hitx = [], hity = [], hitsize = [], hitCD = [];
  const edges = [];
  for (const rec of pairMap.values()){
    const {aid, bid, works} = rec;
    const p1 = pos.get(aid), p2 = pos.get(bid);
    if (!p1 || !p2) continue;
    ex.push(p1.x, p2.x, null);
    ey.push(p1.y, p2.y, null);
    // midpoint for click target
    hitx.push((p1.x + p2.x)/2);
    hity.push((p1.y + p2.y)/2);
    const w = Math.min(works.length, 10);
    hitsize.push(6 + 3*w);
    hitCD.push({ aid, bid, count: works.length });
    edges.push({ aid, bid, count: works.length, works });
  }

  // Node arrays
  function nodesToTrace(ids, color, side){
    const xs=[], ys=[], names=[], idsOut=[], opac=[], sizes=[];
    ids.forEach(id => {
      const p = pos.get(id);
      xs.push(p.x); ys.push(p.y);
      names.push(side==='A' ? (mapA.get(id) || id) : (mapB.get(id) || id));
      idsOut.push(id);
      opac.push(0.9);
      sizes.push(10);
    });
    return { xs, ys, names, ids: idsOut, opac, sizes, color };
  }
  const tA = nodesToTrace(aIDs, (window.__compareColors?.A || '#2563eb'), 'A');
  const tB = nodesToTrace(bIDs, (window.__compareColors?.B || '#059669'), 'B');

  return { pairMap, edges, nodeA: tA, nodeB: tB, positions: pos };
}

function renderXSchoolNetwork(crossPubs, A, B){
  const divId = getNetworkContainerId();
  // share colors to helper
  window.__compareColors = { A: A.meta.color || '#2563eb', B: B.meta.color || '#059669' };

  const g = buildXSchoolGraph(crossPubs, A.roster, B.roster);

  const edgeTrace = {
    name: 'cross-edges',
    type: 'scattergl',
    mode: 'lines',
    x: g.edges.length ? g.edges.flatMap(e => [g.positions.get(e.aid).x, g.positions.get(e.bid).x, null]) : [],
    y: g.edges.length ? g.edges.flatMap(e => [g.positions.get(e.aid).y, g.positions.get(e.bid).y, null]) : [],
    line: { width: 1, color: 'rgba(0,0,0,0.18)' },
    hoverinfo: 'skip',
    showlegend: false
  };

  const edgeHitTrace = {
    name: 'edge-hit',
    type: 'scattergl',
    mode: 'markers',
    x: g.edges.map(e => (g.positions.get(e.aid).x + g.positions.get(e.bid).x)/2),
    y: g.edges.map(e => (g.positions.get(e.aid).y + g.positions.get(e.bid).y)/2),
    marker: { size: g.edges.map(e => Math.min(6 + 3*e.count, 30)), opacity: 0.001 }, // invisible, for clicks
    customdata: g.edges.map(e => ({ aid: e.aid, bid: e.bid, count: e.count })),
    hoverinfo: 'skip',
    showlegend: false
  };

  const nodeATrace = {
    name: A.meta.label || 'A',
    type: 'scattergl',
    mode: 'markers+text',
    x: g.nodeA.xs, y: g.nodeA.ys,
    text: g.nodeA.names,
    textposition: 'top center',
    hovertemplate: '%{text}<extra></extra>',
    marker: { size: g.nodeA.sizes, opacity: g.nodeA.opac, color: A.meta.color || '#2563eb', line: { width: 0 } }
  };
  const nodeBTrace = {
    name: B.meta.label || 'B',
    type: 'scattergl',
    mode: 'markers+text',
    x: g.nodeB.xs, y: g.nodeB.ys,
    text: g.nodeB.names,
    textposition: 'top center',
    hovertemplate: '%{text}<extra></extra>',
    marker: { size: g.nodeB.sizes, opacity: g.nodeB.opac, color: B.meta.color || '#059669', line: { width: 0 } }
  };

  const data = [edgeTrace, edgeHitTrace, nodeATrace, nodeBTrace];
  const layout = {
    margin: { t: 20, r: 10, b: 20, l: 10 },
    xaxis: { visible: false, zeroline: false, showgrid: false },
    yaxis: { visible: false, zeroline: false, showgrid: false },
    hovermode: 'closest'
  };
  Plotly.newPlot(divId, data, layout, {responsive: true});

  const gd = document.getElementById(divId);
  gd.on('plotly_click', ev => {
    const pt = (ev && ev.points && ev.points[0]) ? ev.points[0] : null;
    if (!pt) return;
    if (pt.data && pt.data.name === 'edge-hit'){
      const cd = pt.customdata;
      if (cd && cd.aid && cd.bid) showXSchoolPairPublications(cd.aid, cd.bid);
    }
  });

  // expose pairs for the table
  window.__xschoolPairs = g.edges;
  window.__xschoolPairWorks = g.edges.reduce((acc, e) => {
    const key = e.aid + "|" + e.bid;
    acc.set(key, e.works || []);
    return acc;
  }, new Map());
}

function renderXSchoolPairs(crossPubs, A, B){
  // Build pairs summary sorted by count desc
  const pairMap = new Map();
  crossPubs.forEach(p => {
    const aIDs = Array.isArray(p._aIDs) ? p._aIDs : [];
    const bIDs = Array.isArray(p._bIDs) ? p._bIDs : [];
    aIDs.forEach(a => bIDs.forEach(b => {
      const key = normalizeID(a) + "|" + normalizeID(b);
      const rec = pairMap.get(key) || { aid: normalizeID(a), bid: normalizeID(b), works: [] };
      rec.works.push(p);
      pairMap.set(key, rec);
    }));
  });
  const rows = Array.from(pairMap.values()).map(r => ({
    aid: r.aid, bid: r.bid, count: r.works.length, works: r.works
  })).sort((x,y) => y.count - x.count);

  const table = document.getElementById('coauthor-table') || document.getElementById('xschool-table');
  if (!table) return;
  const tbody = table.tBodies && table.tBodies[0] ? table.tBodies[0] : table.querySelector('tbody') || table;
  tbody.innerHTML = '';
  rows.forEach(r => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td data-aid="${r.aid}">${r.aid}</td><td data-bid="${r.bid}">${r.bid}</td><td>${r.count}</td>`;
    tr.addEventListener('click', () => showXSchoolPairPublications(r.aid, r.bid, r.works));
    tbody.appendChild(tr);
  });
  const countEl = document.getElementById('pairs-count');
  if (countEl) countEl.textContent = String(rows.length);
}

function showXSchoolPairPublications(aid, bid, worksList){
  // Find detail container
  const detail = document.getElementById('pair-detail') || document.getElementById('xschool-pair-detail');
  if (!detail) return;
  const esc = s => String(s||'')
      .replace(/&/g,'&amp;')
      .replace(/</g,'&lt;')
      .replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;')
      .replace(/'/g,'&#39;');

  // Works: if provided use it; else try global map built by renderXSchoolNetwork
  let works = worksList;
  if (!Array.isArray(works) || !works.length) {
    const key = normalizeID(aid) + "|" + normalizeID(bid);
    const mp = (window.__xschoolPairWorks instanceof Map) ? window.__xschoolPairWorks : null;
    works = mp && mp.has(key) ? mp.get(key) : [];
  }

  // Render
  if (!works.length){
    detail.innerHTML = `<div class="muted">No joint publications found for this pair in the current window.</div>`;
    return;
  }
  // Sort by newest then citations
  works = works.slice().sort((a,b) => (b.publication_year - a.publication_year) || (b.cited_by_count - a.cited_by_count));
  const items = works.map(p => {
    const year = Number(p.publication_year) || '';
    const title = esc(p.display_name || '');
    const type = esc(p.type || '');
    const doi = (p.doi && /^https?:\/\//i.test(p.doi)) ? `<a href="${p.doi}" target="_blank" rel="noopener">DOI</a>` : '';
    return `<li><strong>${year}</strong> — <em>${title}</em> <span class="muted">(${type})</span> ${doi}</li>`;
  }).join("");
  detail.innerHTML = `<ul class="pub-list">${items}</ul>`;
  // If a collapsible <details> exists, open it so the user sees the list
  const det = document.getElementById('pairs-collapse') || document.getElementById('xschool-pairs-collapse');
  if (det && det.tagName.toLowerCase() === 'details') det.open = true;
}
 

// ====================== PCA Search / Highlight ======================
function ensurePcaSearchUI(){
  // If a search box already exists with listener, skip
  const existing = document.getElementById('pca-search');
  if (existing && existing.__wired) return;
  let input = existing;
  if (!input){
    // Try to place an input right above the PCA chart
    input = document.createElement('input');
    input.type = 'search';
    input.placeholder = 'Search author…';
    input.id = 'pca-search';
    input.className = 'pca-search';
    const pcaDiv = document.getElementById('pca');
    if (pcaDiv && pcaDiv.parentElement) {
      pcaDiv.parentElement.insertBefore(input, pcaDiv);
    } else {
      document.body.insertBefore(input, document.body.firstChild);
    }
  }
  const handler = debounce(() => {
    const q = (input.value || '').trim().toLowerCase();
    pcaHighlightByName(q);
  }, 120);
  input.addEventListener('input', handler);
  input.__wired = true;
}

function pcaHighlightByName(q){
  const divId = 'pca';
  const gd = document.getElementById(divId);
  if (!gd || !gd.data || gd.data.length < 2) return;
  // Assume traces: [A, B] as last renderPCA created
  const tA = gd.data[0];
  const tB = gd.data[1];
  function makeStyles(trace){
    const labels = (trace.text || []).map(s => String(s||'').toLowerCase());
    const baseSizes = (trace.marker && Array.isArray(trace.marker.size)) ? trace.marker.size.slice() : new Array(labels.length).fill(10);
    const baseOpac  = (trace.marker && Array.isArray(trace.marker.opacity)) ? trace.marker.opacity.slice() : new Array(labels.length).fill(0.6);
    if (!q){
      return { size: baseSizes, opac: baseOpac };
    }
    const size = baseSizes.map((sz,i) => labels[i].includes(q) ? Math.max(sz*1.8, 14) : Math.max(sz*0.8, 6));
    const opac = baseOpac.map((op,i) => labels[i].includes(q) ? 1.0 : 0.15);
    return { size, opac };
  }
  const sA = makeStyles(tA), sB = makeStyles(tB);
  Plotly.restyle(divId, {'marker.size':[sA.size, sB.size], 'marker.opacity':[sA.opac, sB.opac]}, [0,1]);
}

// ====================== Export buttons (PNG/SVG/HTML) ======================
function wireCompareExports(){
  // Helper to wire one trio of buttons to a Plotly div
  function wireGroup(targetId, base){
    const gd = document.getElementById(targetId);
    if (!gd) return;
    const pngBtn  = document.getElementById(`export-${targetId}-png`)  || document.getElementById(`export-${base}-png`);
    const svgBtn  = document.getElementById(`export-${targetId}-svg`)  || document.getElementById(`export-${base}-svg`);
    const htmlBtn = document.getElementById(`export-${targetId}-html`) || document.getElementById(`export-${base}-html`);
    if (pngBtn && !pngBtn.__wired){ pngBtn.addEventListener('click', ()=> exportPlotlyImage(targetId, 'png', base)); pngBtn.__wired = true; }
    if (svgBtn && !svgBtn.__wired){ svgBtn.addEventListener('click', ()=> exportPlotlyImage(targetId, 'svg', base)); svgBtn.__wired = true; }
    if (htmlBtn && !htmlBtn.__wired){ htmlBtn.addEventListener('click',()=> exportPlotlyHTML(targetId, base)); htmlBtn.__wired = true; }
  }
  wireGroup('pubByYear', 'compare_publications');
  wireGroup('enrichment', 'compare_enrichment');
  wireGroup('pca', 'compare_pca');
  const netId = document.getElementById('xschool-network') ? 'xschool-network' : (document.getElementById('coauthor-network') ? 'coauthor-network' : null);
  if (netId) wireGroup(netId, 'compare_network');
}

function exportPlotlyImage(divId, format, filenameBase){
  const gd = document.getElementById(divId);
  if (!gd) return;
  Plotly.downloadImage(gd, {format: format, filename: filenameBase});
}

function exportPlotlyHTML(divId, filenameBase){
  const gd = document.getElementById(divId);
  if (!gd) return;
  // Grab the graph as JSON (data + layout)
  const json = (window.Plotly && Plotly.Plots && Plotly.Plots.graphJson) ? Plotly.Plots.graphJson(gd) : null;
  const payload = json ? JSON.stringify(json) : null;
  const title = (gd.layout && gd.layout.title && gd.layout.title.text) ? gd.layout.title.text : '';
  const tpl = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${(title || filenameBase).replace(/</g,'&lt;')}</title>
<script src="https://cdn.plot.ly/plotly-latest.min.js"></script>
</head>
<body>
<div id="plot" style="width:100%;height:100vh;"></div>
<script>
var payload = ${payload || 'null'};
if (payload) {
  Plotly.newPlot('plot', payload.data, payload.layout, {responsive:true});
} else {
  // fallback: clone as image
  var img = new Image();
  img.src = '${(gd.toImage ? gd.toImage({format:"png"}) : "")}';
  document.getElementById('plot').appendChild(img);
}
</script>
</body>
</html>`;
  downloadBlob(`${filenameBase}.html`, new Blob([tpl], {type:'text/html'}));
}

function downloadBlob(filename, blob){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}
