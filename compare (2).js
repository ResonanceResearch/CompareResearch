/* compare.js — Two‑school comparison with working cross‑school network,
   expandable interaction panel, and searchable PCA (non‑recomputing).
   Expects a config file `compare_config.json` in the same folder.
*/
(function(){
  // ---------- Tunables ----------
  const DEFAULT_TYPES = new Set(["article","review","book","book-chapter"]);
  const PCA_MARK_OPACITY = 0.55;          // base opacity
  const PCA_MARK_SIZE = 9;                // base size
  const PCA_HIGHLIGHT_SIZE = 15;          // highlighted author
  const PCA_HIGHLIGHT_OPACITY = 1.0;
  const NET_MARK_SIZE = 10;
  const EDGE_WIDTH = 1.5;

  // ---------- Boot ----------
  document.addEventListener("DOMContentLoaded", main);

  async function main(){
    const cfg = await fetchJSON("compare_config.json");
    const schoolKeys = Object.keys(cfg.schools);

    // Populate pickers
    const selA = byId("schoolA");
    const selB = byId("schoolB");
    schoolKeys.forEach(k => {
      selA.add(new Option(cfg.schools[k].label || k, k));
      selB.add(new Option(cfg.schools[k].label || k, k));
    });
    selA.value = cfg.defaults?.A || schoolKeys[0];
    selB.value = cfg.defaults?.B || schoolKeys[1] || schoolKeys[0];

    // Years
    byId("yearMin").value = cfg.defaults?.yearMin ?? 2021;
    byId("yearMax").value = cfg.defaults?.yearMax ?? 2025;

    // Color dots
    setDot("dotA", cfg.schools[selA.value].color || "#2563eb");
    setDot("dotB", cfg.schools[selB.value].color || "#059669");

    // Wire controls
    byId("swap-btn").addEventListener("click", (e)=>{
      e.preventDefault();
      const a = selA.value, b = selB.value;
      selA.value = b; selB.value = a;
      setDot("dotA", cfg.schools[selA.value].color || "#2563eb");
      setDot("dotB", cfg.schools[selB.value].color || "#059669");
      update();
    });
    selA.addEventListener("change", ()=>{ setDot("dotA", cfg.schools[selA.value].color||"#2563eb"); update(); });
    selB.addEventListener("change", ()=>{ setDot("dotB", cfg.schools[selB.value].color||"#059669"); update(); });

    ["perCapita","fullTimeOnly","useTopics","normalizeTypes","yearMin","yearMax"]
      .forEach(id => byId(id).addEventListener("input", debounce(update, 120)));

    byId("reset").addEventListener("click", ()=>{
      byId("perCapita").checked = false;
      byId("fullTimeOnly").checked = true;
      byId("useTopics").checked = true;
      byId("normalizeTypes").checked = true;
      byId("yearMin").value = cfg.defaults?.yearMin ?? 2021;
      byId("yearMax").value = cfg.defaults?.yearMax ?? 2025;
      selA.value = cfg.defaults?.A || schoolKeys[0];
      selB.value = cfg.defaults?.B || (schoolKeys[1] || schoolKeys[0]);
      setDot("dotA", cfg.schools[selA.value].color || "#2563eb");
      setDot("dotB", cfg.schools[selB.value].color || "#059669");
      update();
    });

    // PCA search UI (like single‑school)
    ensurePcaSearchUI();

    // Cache for data packages
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

    // Local state (for PCA search without recompute)
    let lastPca = { xs:[], ys:[], names:[], schools:[], ids:[], colors:[], layout: null };

    // Update/render
    async function update(){
      try {
        byId("loading-banner")?.classList.remove("hidden");

        const [A, B] = await Promise.all([
          loadSchool(selA.value),
          loadSchool(selB.value)
        ]);

        const yMin = clampYear(+byId("yearMin").value || 2021);
        const yMax = clampYear(+byId("yearMax").value || 2025);
        const perCapita = byId("perCapita").checked;
        const fullTimeOnly = byId("fullTimeOnly").checked;
        const useTopics = byId("useTopics").checked;
        const normTypes = byId("normalizeTypes").checked;
        const types = normTypes ? DEFAULT_TYPES : null;

        // Denominators
        const denomA = headcount(A.roster, fullTimeOnly);
        const denomB = headcount(B.roster, fullTimeOnly);
        setText("nameA", A.meta.label || selA.value);
        setText("nameB", B.meta.label || selB.value);
        setText("denomA", denomA);
        setText("denomB", denomB);

        // Filtered pubs
        const fA = filterToRoster(A.dedup, A.roster, yMin, yMax, types);
        const fB = filterToRoster(B.dedup, B.roster, yMin, yMax, types);

        // KPI: cross‑school pubs/pairs
        const xpubs = crossSchoolPubs(fA, fB, A.roster, B.roster);
        setText("xschoolPubs", xpubs.length);
        setText("xschoolPairs", crossPairsSummary(xpubs, A.roster, B.roster));

        // Bars
        renderYearBars(fA, fB, yMin, yMax,
          perCapita ? denomA : 1,
          perCapita ? denomB : 1,
          A.meta.color, B.meta.color
        );

        // Topic overlap and enrichment
        const source = useTopics ? "topics" : "concepts";
        const dfA = termDocFreq(fA, source);
        const dfB = termDocFreq(fB, source);
        renderOverlapAndEnrichment(dfA, dfB, perCapita ? denomA : 1, perCapita ? denomB : 1, A.meta, B.meta);

        // Network (authors only across A‑B edges)
        renderCrossNetwork(xpubs, A.roster, B.roster, A.meta.color, B.meta.color);

        // PCA (compute once per update; search only restyles)
        lastPca = computeAndRenderPCA(A, B, yMin, yMax, source);

        byId("loading-banner")?.classList.add("hidden");
      } catch (e) {
        console.error(e);
        const lb = byId("loading-banner");
        if (lb) lb.textContent = "Failed to load data.";
      }
    }

    // Bind search behavior AFTER first render
    function ensurePcaSearchUI(){
      const holder = document.getElementById("pca");
      if (!holder) return;
      let wrap = document.getElementById("pca-search-wrap");
      if (!wrap){
        wrap = document.createElement("div");
        wrap.id = "pca-search-wrap";
        wrap.style.margin = "8px 0 0 0";
        wrap.innerHTML = `
          <input id="pca-search" type="search" placeholder="Search author (first/last) – highlight only" style="max-width:360px;width:100%;padding:8px 10px;border:1px solid var(--border);border-radius:8px" />
        `;
        holder.parentElement.insertBefore(wrap, holder);
      }
      const box = byId("pca-search");
      box?.addEventListener("input", debounce(()=>{
        highlightInPCA(box.value || "");
      }, 120));
    }

    function highlightInPCA(query){
      query = String(query||"").trim().toLowerCase();
      const div = byId("pca");
      if (!div || !div.data) return;
      const trA = div.data[0];
      const trB = div.data[1];
      // Reset to base
      [trA, trB].forEach(tr=>{
        tr.marker.size = tr.marker.size.map(()=>PCA_MARK_SIZE);
        tr.marker.opacity = tr.marker.opacity.map(()=>PCA_MARK_OPACITY);
        tr.marker.line = { width: 0 };
      });
      if (query){
        [trA, trB].forEach(tr => {
          const names = tr.text || [];
          names.forEach((s, i) => {
            const t = String(s).toLowerCase();
            if (t.includes(query)){
              tr.marker.size[i] = PCA_HIGHLIGHT_SIZE;
              tr.marker.opacity[i] = PCA_HIGHLIGHT_OPACITY;
              tr.marker.line = tr.marker.line || {};
              if (!Array.isArray(tr.marker.line.width)) {
                tr.marker.line.width = tr.marker.size.map(()=>0);
              }
              tr.marker.line.width[i] = 2.5;
            }
          });
        });
      }
      Plotly.redraw(div);
    }

    // First render
    update();

    // ---------- Helpers below ----------
    function byId(id){ return document.getElementById(id); }
    function setText(id, v){ const el = byId(id); if (el) el.textContent = v; }
    function setDot(id, color){ const el = byId(id); if (el) el.style.background = color; }
    function clampYear(y){ if(!y) return 2021; if (y<1990) return 1990; if (y>2100) return 2100; return y; }
    function debounce(fn, ms){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,a),ms); }; }
    function fetchCSV(path){ return fetch(path).then(r=>{ if(!r.ok) throw new Error("CSV not found: "+path); return r.text(); }); }
    function fetchJSON(path){ return fetch(path).then(r=>r.json()); }

    function parseCSV(text){
      const lines = text.replace(/\r/g,"").split("\n").filter(Boolean);
      if (!lines.length) return [];
      const headers = splitCSVLine(lines[0]);
      return lines.slice(1).map(line => {
        const cells = splitCSVLine(line);
        const o = {};
        headers.forEach((h,i)=> o[h]=cells[i] ?? "");
        return o;
      });
    }
    function splitCSVLine(s){
      const out=[]; let cur=""; let inQ=false;
      for (let i=0;i<s.length;i++){
        const c=s[i];
        if (c === '"'){ if (inQ && s[i+1] === '"'){ cur+='"'; i++; } else { inQ=!inQ; } }
        else if (c === "," && !inQ){ out.push(cur); cur=""; }
        else cur += c;
      }
      out.push(cur);
      return out.map(x=>x.replace(/^"|"$/g,"").replace(/""/g,'"'));
    }

    function normalizeID(id){
      return String(id||'')
        .replace(/^https?:\/\/openalex\.org\/authors\//i,'')
        .replace(/^https?:\/\/openalex\.org\//i,'')
        .trim();
    }
    function normalizeType(t){
      const s = String(t||"").toLowerCase().trim();
      if (s === "journal-article" || s === "journal article") return "article";
      if (s === "review-article" || s === "review article") return "review";
      return s;
    }

    function normalizeRoster(rows){
      rows.forEach(r => {
        r.OpenAlexID = normalizeID(r.OpenAlexID);
        r.Appointment = String(r.Appointment||"").trim();
        r.Level = String(r.Level||"").trim();
        r.Category = String(r.Category||"").trim();
      });
    }
    function normalizePubs(rows){
      rows.forEach(p => {
        p.publication_year = Number(p.publication_year || p.year || 0);
        p.type = normalizeType(p.type || p.display_type);
        // Author IDs
        const ids = String(p["authorships__author__id"]||"").trim();
        const arr = ids ? ids.split("|").map(normalizeID).filter(Boolean) : [];
        const single = normalizeID(p.author_openalex_id || p.author_id || p.OpenAlexID);
        p._all_author_ids = arr.length ? arr : (single ? [single] : []);
        // Term tokens (concepts/topics)
        const conc = (p.concepts_list || "").split("|").map(s=>s.trim().toLowerCase()).filter(Boolean);
        const top1 = String(p["primary_topic__display_name"]||"").trim().toLowerCase();
        const top2 = String(p["primary_topic__subfield__display_name"]||"").trim().toLowerCase();
        p._concepts = conc;
        p._topics = [top1, top2].filter(Boolean);
      });
    }

    function headcount(roster, fullTimeOnly){
      const isFT = (s)=>/full\s*-?\s*time/i.test(String(s||""));
      return roster.filter(r => fullTimeOnly ? isFT(r.Appointment) : true).length;
    }

    function filterToRoster(pubs, roster, yMin, yMax, types){
      const ids = new Set(roster.map(r=>r.OpenAlexID));
      return pubs.filter(p => {
        const y = p.publication_year;
        if (!(y >= yMin && y <= yMax)) return false;
        if (types && !types.has(p.type)) return false;
        return p._all_author_ids.some(id => ids.has(id));
      });
    }

    function idSet(rows){ return new Set(rows.map(r=>r.OpenAlexID)); }

    // Any paper with at least one author from A and one from B (return dedup by work id/title)
    function crossSchoolPubs(fA, fB, rosterA, rosterB){
      const setA = idSet(rosterA);
      const setB = idSet(rosterB);
      const all = [...fA, ...fB];
      const seen = new Map();
      for (const p of all){
        const key = p.id ? String(p.id).replace(/^https?:\/\/openalex\.org\//i,'') :
                    (p.doi ? "doi:"+String(p.doi).toLowerCase() :
                    ("t:"+String(p.display_name||"").toLowerCase()));
        if (seen.has(key)) continue;
        const hasA = p._all_author_ids.some(id => setA.has(id));
        const hasB = p._all_author_ids.some(id => setB.has(id));
        if (hasA && hasB) seen.set(key, p);
      }
      return Array.from(seen.values());
    }

    // Short text summary of frequent A–B pairs
    function crossPairsSummary(xpubs, rosterA, rosterB){
      const setA = idSet(rosterA), setB = idSet(rosterB);
      const namesBy = new Map();
      rosterA.forEach(r => namesBy.set(r.OpenAlexID, r.Name || r.Display_name || r.name || r.OpenAlexID));
      rosterB.forEach(r => namesBy.set(r.OpenAlexID, r.Name || r.Display_name || r.name || r.OpenAlexID));

      const counts = new Map(); // "A|B" (sorted) -> n
      for (const p of xpubs){
        const people = p._all_author_ids.filter(id => setA.has(id) || setB.has(id));
        // unique pairs for this paper
        for (let i=0;i<people.length;i++){
          for (let j=i+1;j<people.length;j++){
            const a = people[i], b = people[j];
            const aInA = setA.has(a), bInA = setA.has(b);
            if (aInA === bInA) continue; // only across schools
            const key = [a,b].sort().join("|");
            counts.set(key, (counts.get(key)||0)+1);
          }
        }
      }
      const top = Array.from(counts.entries())
        .sort((a,b)=>b[1]-a[1]).slice(0,8)
        .map(([k,n])=>{
          const [x,y] = k.split("|");
          return `${namesBy.get(x) || x} \u2194 ${namesBy.get(y) || y} (${n})`;
        });
      return top.length ? top.join("; ") : "—";
    }

    // Bars
    function renderYearBars(fA, fB, yMin, yMax, denomA, denomB, colorA, colorB){
      const years = [];
      for (let y=yMin; y<=yMax; y++) years.push(y);

      const countBy = (arr) => {
        const m=new Map();
        arr.forEach(p => m.set(p.publication_year, (m.get(p.publication_year)||0)+1));
        return years.map(y => (m.get(y)||0));
      };

      const aCounts = countBy(fA).map(v => v / (denomA || 1));
      const bCounts = countBy(fB).map(v => v / (denomB || 1));

      const trA = { x: years, y: aCounts, type: "bar", name: "A", marker: { color: colorA } };
      const trB = { x: years, y: bCounts, type: "bar", name: "B", marker: { color: colorB } };

      Plotly.newPlot("pubByYear", [trA, trB], {
        barmode: "group",
        margin: {l:40, r:10, t:8, b:40},
        yaxis: { title: denomA!==1 || denomB!==1 ? "Publications per faculty" : "Publications" },
        xaxis: { title: "Year", dtick: 1 },
        hovermode: "x unified",
        showlegend: true
      }, {responsive:true, displayModeBar:false});
      const meta = `Window: ${yMin}\u2013${yMax}${(denomA!==1 || denomB!==1) ? " (per‑capita)" : ""}`;
      setText("pubMeta", meta);
    }

    // Term DF maps and Jaccard overlap + quick tables
    function termDocFreq(pubs, source){
      const df = new Map();
      pubs.forEach(p => {
        const terms = (source === "topics") ? p._topics : p._concepts;
        const uniq = Array.from(new Set(terms));
        uniq.forEach(t => df.set(t, (df.get(t)||0)+1));
      });
      return df;
    }
    function renderOverlapAndEnrichment(dfA, dfB, scaleA, scaleB, metaA, metaB){
      const setA = new Set(dfA.keys());
      const setB = new Set(dfB.keys());
      const inter = new Set([...setA].filter(x => setB.has(x)));
      const union = new Set([...setA, ...setB]);
      const jaccard = union.size ? (inter.size / union.size) : 0;
      setText("overlapPct", `${(jaccard*100).toFixed(1)}%`);

      // Optional: could render top enriched lists; here just small lists
      const topList = (df, k=8) => Array.from(df.entries()).sort((a,b)=>b[1]-a[1]).slice(0,k);
      const div = byId("enrichment");
      if (div){
        const aTop = topList(dfA), bTop = topList(dfB);
        div.innerHTML = `
          <div class="enrich-col"><h4>${metaA.label||"A"} top terms</h4>
            <ul>${aTop.map(([t,n])=>`<li>${escapeHTML(t)} (${n})</li>`).join("")}</ul>
          </div>
          <div class="enrich-col"><h4>${metaB.label||"B"} top terms</h4>
            <ul>${bTop.map(([t,n])=>`<li>${escapeHTML(t)} (${n})</li>`).join("")}</ul>
          </div>`;
      }
    }

    // Cross‑school network
    function renderCrossNetwork(xpubs, rosterA, rosterB, colorA, colorB){
      // Build bipartite-ish graph among authors who have A–B joint pubs
      const setA = idSet(rosterA), setB = idSet(rosterB);
      const nameOf = new Map();
      rosterA.forEach(r=> nameOf.set(r.OpenAlexID, r.Name || r.Display_name || r.OpenAlexID));
      rosterB.forEach(r=> nameOf.set(r.OpenAlexID, r.Name || r.Display_name || r.OpenAlexID));

      const nodes = new Map(); // id -> {id, name, side}
      const edges = new Map(); // "a|b" sorted -> weight
      for (const p of xpubs){
        const ids = p._all_author_ids.filter(id => setA.has(id) || setB.has(id));
        const uniq = Array.from(new Set(ids));
        for (let i=0;i<uniq.length;i++){
          for (let j=i+1;j<uniq.length;j++){
            const a = uniq[i], b = uniq[j];
            const aInA = setA.has(a), bInA = setA.has(b);
            if (aInA === bInA) continue; // require cross edge
            nodes.set(a, { id:a, name:nameOf.get(a)||a, side:"A" });
            nodes.set(b, { id:b, name:nameOf.get(b)||b, side:"B" });
            const key = [a,b].sort().join("|");
            edges.set(key, (edges.get(key)||0)+1);
          }
        }
      }

      // Positioning: simple two columns + vertical spacing by degree
      const nA = Array.from(nodes.values()).filter(n=>n.side==="A");
      const nB = Array.from(nodes.values()).filter(n=>n.side==="B");
      // Sort by degree desc for nicer spacing
      const deg = new Map();
      edges.forEach((w,k)=>{
        const [x,y]=k.split("|");
        deg.set(x,(deg.get(x)||0)+w);
        deg.set(y,(deg.get(y)||0)+w);
      });
      nA.sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0));
      nB.sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0));

      const xA=0, xB=1;
      const yA = nA.map((_,i)=> i);
      const yB = nB.map((_,i)=> i);

      const pos = new Map();
      nA.forEach((n,i)=> pos.set(n.id, {x:xA, y:yA[i]}));
      nB.forEach((n,i)=> pos.set(n.id, {x:xB, y:yB[i]}));

      // Edge segments
      const edgeXs=[], edgeYs=[];
      edges.forEach((w,k)=>{
        const [a,b]=k.split("|");
        const pa = pos.get(a), pb = pos.get(b);
        if (!pa || !pb) return;
        edgeXs.push(pa.x, pb.x, null);
        edgeYs.push(pa.y, pb.y, null);
      });

      const trEdges = {
        x: edgeXs, y: edgeYs, mode: "lines",
        line: { width: EDGE_WIDTH, color: "rgba(120,120,120,0.6)" },
        hoverinfo: "skip",
        showlegend: false
      };

      const trA = {
        x: nA.map(n=>pos.get(n.id).x),
        y: nA.map(n=>pos.get(n.id).y),
        mode: "markers+text",
        type: "scatter",
        name: "School A",
        text: nA.map(n=>n.name),
        textposition: "middle left",
        marker: { size: NET_MARK_SIZE, color: colorA },
        showlegend: false,
        hovertemplate: "%{text}<extra></extra>"
      };
      const trB = {
        x: nB.map(n=>pos.get(n.id).x),
        y: nB.map(n=>pos.get(n.id).y),
        mode: "markers+text",
        type: "scatter",
        name: "School B",
        text: nB.map(n=>n.name),
        textposition: "middle right",
        marker: { size: NET_MARK_SIZE, color: colorB },
        showlegend: false,
        hovertemplate: "%{text}<extra></extra>"
      };

      Plotly.newPlot("xNetwork", [trEdges, trA, trB], {
        margin: {l:20,r:20,t:10,b:30},
        xaxis: { visible:false, range: [-0.2,1.2] },
        yaxis: { visible:false },
        hovermode: "closest"
      }, {responsive:true, displayModeBar:false});

      // Expandable interactions beneath network
      const tableBody = byId("xPairsBody");
      const detail = byId("xPairDetail");
      if (tableBody){
        tableBody.innerHTML = "";
        const rows = Array.from(edges.entries()).sort((a,b)=>b[1]-a[1]);
        for (const [k, n] of rows){
          const [a,b] = k.split("|");
          const tr = document.createElement("tr");
          tr.innerHTML = `<td>${escapeHTML(nameOf.get(a)||a)}</td>
                          <td>${escapeHTML(nameOf.get(b)||b)}</td>
                          <td style="text-align:right">${n}</td>`;
          tr.addEventListener("click", ()=>{
            // list joint papers for this pair
            const papers = listJointPubsForPair(xpubs, a, b);
            detail.innerHTML = papers.length
              ? `<ul>${papers.map(p=>`<li>${escapeHTML(p.display_name || p.title || "(untitled)")} — ${p.publication_year||""}</li>`).join("")}</ul>`
              : "<em>No titles available.</em>";
            byId("xPairs").open = true;
            detail.scrollIntoView({behavior:"smooth", block:"nearest"});
          });
          tableBody.appendChild(tr);
        }
      }
    }

    function listJointPubsForPair(pubs, a, b){
      return pubs.filter(p => {
        const ids = new Set(p._all_author_ids);
        return ids.has(a) && ids.has(b);
      });
    }

    // PCA (very light PCA: SVD on TF‑IDF‑ish author‑term matrix; here DF only to keep client light)
    function computeAndRenderPCA(A, B, yMin, yMax, source){
      // Build author -> set of terms
      const fA = filterToRoster(A.dedup, A.roster, yMin, yMax, DEFAULT_TYPES);
      const fB = filterToRoster(B.dedup, B.roster, yMin, yMax, DEFAULT_TYPES);
      const mapA = authorTerms(fA, A.roster, source);
      const mapB = authorTerms(fB, B.roster, source);

      // Merge to arrays
      const names=[], ids=[], schools=[], colors=[];
      const all = [];
      mapA.forEach((terms, id)=>{ all.push(terms); names.push(nameOf(id,A.roster)); ids.push(id); schools.push("A"); colors.push(A.meta.color); });
      mapB.forEach((terms, id)=>{ all.push(terms); names.push(nameOf(id,B.roster)); ids.push(id); schools.push("B"); colors.push(B.meta.color); });

      if (!all.length){
        Plotly.purge("pca");
        setText("pcaMeta", "No authors in window.");
        return { xs:[], ys:[], names:[], schools:[], ids:[], colors:[], layout:null };
      }

      // Build vocabulary
      const vocab = new Map();
      all.forEach(set => set.forEach(t => vocab.set(t, (vocab.get(t)||0)+1)));
      const terms = Array.from(vocab.keys());

      // Build binary matrix N x T (sparse to dense here)
      const N = all.length, T = terms.length;
      const mat = new Array(N);
      for (let i=0;i<N;i++){
        const row = new Array(T).fill(0);
        const set = all[i];
        for (let j=0;j<T;j++){
          if (set.has(terms[j])) row[j] = 1;
        }
        mat[i] = row;
      }

      // Center columns
      const colMeans = new Array(T).fill(0);
      for (let j=0;j<T;j++){
        let s=0; for (let i=0;i<N;i++) s+=mat[i][j];
        colMeans[j] = s / N;
      }
      for (let i=0;i<N;i++) for (let j=0;j<T;j++) mat[i][j] -= colMeans[j];

      // Compute top2 via power iteration on covariance (mat * mat^T)
      // For performance and simplicity in client, we'll do a naive Gram‑Schmidt on two random vectors.
      function multMMt(v){ // returns M M^T v
        // u = M^T v
        const u = new Array(T).fill(0);
        for (let j=0;j<T;j++){
          let s=0; for (let i=0;i<N;i++) s += mat[i][j]*v[i];
          u[j]=s;
        }
        // w = M u
        const w = new Array(N).fill(0);
        for (let i=0;i<N;i++){
          let s=0; for (let j=0;j<T;j++) s += mat[i][j]*u[j];
          w[i]=s;
        }
        return w;
      }
      function norm(v){ return Math.sqrt(v.reduce((a,b)=>a+b*b,0)); }
      function dot(a,b){ let s=0; for (let i=0;i<a.length;i++) s+=a[i]*b[i]; return s; }
      function proj(u, v){ // project u onto v
        const s = dot(u,v) / (dot(v,v) || 1);
        return v.map(x => s*x);
      }
      function sub(a,b){ return a.map((x,i)=>x-b[i]); }
      function add(a,b){ return a.map((x,i)=>x+b[i]); }
      function scale(a,c){ return a.map(x=>x*c); }

      function powerIter(kIters=25){
        // First vector
        let v1 = new Array(N).fill(0).map(()=>Math.random());
        for (let it=0; it<kIters; it++){
          v1 = multMMt(v1);
          const n = norm(v1) || 1; v1 = scale(v1, 1/n);
        }
        // Second, orthogonalized
        let v2 = new Array(N).fill(0).map(()=>Math.random());
        v2 = sub(v2, proj(v2,v1));
        for (let it=0; it<kIters; it++){
          v2 = multMMt(v2);
          v2 = sub(v2, proj(v2,v1));
          const n = norm(v2) || 1; v2 = scale(v2, 1/n);
        }
        return [v1, v2];
      }

      const [pc1, pc2] = powerIter(25);
      const xs = pc1, ys = pc2;

      const sizesA = mapA.size ? new Array(mapA.size).fill(PCA_MARK_SIZE) : [];
      const sizesB = mapB.size ? new Array(mapB.size).fill(PCA_MARK_SIZE) : [];
      const opA    = mapA.size ? new Array(mapA.size).fill(PCA_MARK_OPACITY) : [];
      const opB    = mapB.size ? new Array(mapB.size).fill(PCA_MARK_OPACITY) : [];

      const tr1 = {
        x: xs.slice(0, mapA.size), y: ys.slice(0, mapA.size),
        mode: "markers",
        type: "scatter",
        name: A.meta.label || "A",
        text: names.slice(0, mapA.size),
        marker: { size: sizesA, opacity: opA },
        hovertemplate: "%{text}<extra></extra>",
        showlegend: true
      };
      const tr2 = {
        x: xs.slice(mapA.size), y: ys.slice(mapA.size),
        mode: "markers",
        type: "scatter",
        name: B.meta.label || "B",
        text: names.slice(mapA.size),
        marker: { size: sizesB, opacity: opB },
        hovertemplate: "%{text}<extra></extra>",
        showlegend: true
      };

      Plotly.newPlot("pca", [tr1, tr2], {
        margin: {l:30,r:10,t:10,b:30},
        xaxis: { zeroline: false }, yaxis: { zeroline: false },
        hovermode: "closest"
      }, {responsive:true, displayModeBar:false});

      setText("pcaMeta", `${names.length} authors; searchable above (no PCA recompute).`);

      return { xs, ys, names, schools, ids, colors, layout: null };
    }

    function nameOf(id, roster){
      const r = roster.find(x => x.OpenAlexID === id);
      return r ? (r.Name || r.Display_name || id) : id;
    }

    function authorTerms(pubs, roster, source){
      const ids = new Set(roster.map(r=>r.OpenAlexID));
      const map = new Map(); // id -> Set(terms)
      pubs.forEach(p => {
        const terms = (source === "topics") ? p._topics : p._concepts;
        const uniq = new Set(terms);
        p._all_author_ids.forEach(id => {
          if (ids.has(id)){
            if (!map.has(id)) map.set(id, new Set());
            const s = map.get(id);
            uniq.forEach(t => s.add(t));
          }
        });
      });
      return map;
    }

    // Small utils
    function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
  }
})();