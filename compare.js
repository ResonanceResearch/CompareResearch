/* compare.js v2 — Two‑school comparison with:
   - Cross‑school network (no isolates) + expandable pairs under it
   - Publications by year (per‑capita optional)
   - PCA (searchable; highlight‑only, no recompute on search)
   - Fold‑change bar chart for Topics/Concepts + top‑terms lists
   - PNG/SVG/HTML export buttons on every figure
   - 2×2 figure grid
   Expects compare_config.json describing the two schools and data paths.
*/
(function(){
  const DEFAULT_TYPES = new Set(["article","review","book","book-chapter"]);
  const PCA_MARK_OPACITY = 0.55;
  const PCA_MARK_SIZE = 9;
  const PCA_HIGHLIGHT_SIZE = 15;
  const PCA_HIGHLIGHT_OPACITY = 1.0;
  const NET_MARK_SIZE = 10;
  const EDGE_WIDTH = 1.5;
  const PLOTLY_CDN = "https://cdn.plot.ly/plotly-2.35.2.min.js";

  document.addEventListener("DOMContentLoaded", main);

  async function main(){
    const cfg = await fetchJSON("compare_config.json");
    const keys = Object.keys(cfg.schools);
    const selA = el("#schoolA"), selB = el("#schoolB");
    keys.forEach(k => {
      selA.add(new Option(cfg.schools[k].label || k, k));
      selB.add(new Option(cfg.schools[k].label || k, k));
    });
    selA.value = cfg.defaults?.A || keys[0];
    selB.value = cfg.defaults?.B || keys[1] || keys[0];

    el("#yearMin").value = cfg.defaults?.yearMin ?? 2021;
    el("#yearMax").value = cfg.defaults?.yearMax ?? 2025;

    setDot("dotA", cfg.schools[selA.value].color || "#2563eb");
    setDot("dotB", cfg.schools[selB.value].color || "#059669");

    // Controls
    el("#swap-btn").addEventListener("click", (e)=>{
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
      .forEach(id => el("#"+id).addEventListener("input", debounce(update, 120)));

    el("#reset").addEventListener("click", ()=>{
      el("#perCapita").checked = false;
      el("#fullTimeOnly").checked = true;
      el("#useTopics").checked = true;
      el("#normalizeTypes").checked = true;
      el("#yearMin").value = cfg.defaults?.yearMin ?? 2021;
      el("#yearMax").value = cfg.defaults?.yearMax ?? 2025;
      selA.value = cfg.defaults?.A || keys[0];
      selB.value = cfg.defaults?.B || (keys[1] || keys[0]);
      setDot("dotA", cfg.schools[selA.value].color || "#2563eb");
      setDot("dotB", cfg.schools[selB.value].color || "#059669");
      update();
    });

    // PCA search box
    ensurePcaSearchUI();

    // Cache
    const cache = new Map();
    async function loadSchool(k){
      if (cache.has(k)) return cache.get(k);
      const meta = cfg.schools[k];
      const [roster, perAuthor, dedup] = await Promise.all([
        fetchCSV(meta.roster).then(parseCSV),
        fetchCSV(meta.perAuthor).then(parseCSV).catch(()=>[]),
        fetchCSV(meta.dedup).then(parseCSV)
      ]);
      normalizeRoster(roster);
      normalizePubs(dedup);
      if (perAuthor?.length) normalizePubs(perAuthor);
      const pkg = { roster, perAuthor, dedup, meta };
      cache.set(k, pkg); return pkg;
    }

    // Keep last PCA traces for highlight-only search
    let lastPcaDiv = null;

    async function update(){
      el("#loading-banner")?.classList.remove("hidden");

      const [A,B] = await Promise.all([ loadSchool(selA.value), loadSchool(selB.value) ]);
      const yMin = clampYear(+el("#yearMin").value || 2021);
      const yMax = clampYear(+el("#yearMax").value || 2025);
      const perCapita = el("#perCapita").checked;
      const fullTimeOnly = el("#fullTimeOnly").checked;
      const useTopics = el("#useTopics").checked;
      const normTypes = el("#normalizeTypes").checked;
      const types = normTypes ? DEFAULT_TYPES : null;

      const denomA = headcount(A.roster, fullTimeOnly);
      const denomB = headcount(B.roster, fullTimeOnly);
      setText("#nameA", A.meta.label || selA.value);
      setText("#nameB", B.meta.label || selB.value);
      setText("#denomA", denomA);
      setText("#denomB", denomB);

      const fA = filterToRoster(A.dedup, A.roster, yMin, yMax, types);
      const fB = filterToRoster(B.dedup, B.roster, yMin, yMax, types);

      // 1) Bars by year
      renderYearBars(fA, fB, yMin, yMax, perCapita?denomA:1, perCapita?denomB:1, A.meta.color, B.meta.color);

      // 2) Cross-school network + pairs
      const xpubs = crossSchoolPubs(fA, fB, A.roster, B.roster);
      renderCrossNetwork(xpubs, A.roster, B.roster, A.meta.color, B.meta.color);

      // 3) PCA
      lastPcaDiv = computeAndRenderPCA(A, B, yMin, yMax, useTopics?"topics":"concepts");

      // 4) Fold-change chart + Lists
      const dfA = termDocFreq(fA, useTopics?"topics":"concepts");
      const dfB = termDocFreq(fB, useTopics?"topics":"concepts");
      renderFoldChange(dfA, dfB, perCapita?denomA:1, perCapita?denomB:1, A.meta, B.meta);

      el("#loading-banner")?.classList.add("hidden");
    }

    // search highlight (no recompute)
    function ensurePcaSearchUI(){
      const holder = el("#pca");
      if (!holder) return;
      if (!el("#pca-search-wrap")){
        const wrap = document.createElement("div");
        wrap.id = "pca-search-wrap";
        wrap.innerHTML = `<input id="pca-search" type="search" placeholder="Search author (first/last)" class="search">`;
        holder.parentElement.insertBefore(wrap, holder);
        el("#pca-search").addEventListener("input", debounce(()=>{
          const q = (el("#pca-search").value||"").trim().toLowerCase();
          const div = document.getElementById("pca");
          if (!div || !div.data) return;
          const traces = div.data;
          // Reset
          traces.forEach(tr => {
            tr.marker.size = tr.marker.size.map(()=>PCA_MARK_SIZE);
            tr.marker.opacity = tr.marker.opacity.map(()=>PCA_MARK_OPACITY);
            tr.marker.line = { width: 0 };
          });
          if (q){
            traces.forEach(tr => {
              const names = tr.text || [];
              names.forEach((t,i)=>{
                if (String(t).toLowerCase().includes(q)){
                  tr.marker.size[i] = PCA_HIGHLIGHT_SIZE;
                  tr.marker.opacity[i] = PCA_HIGHLIGHT_OPACITY;
                  if (!Array.isArray(tr.marker.line?.width)){
                    tr.marker.line = { width: tr.marker.size.map(()=>0) };
                  }
                  tr.marker.line.width[i] = 2.5;
                }
              });
            });
          }
          Plotly.redraw(div);
        }, 120));
      }
    }

    // ========== Renders ==========

    function exportConfig(divId, fname){
      const iconSvg = { // minimal camera-like path
        width: 900, height: 1000,
        path: "M512 128h256l64 128h128c35 0 64 29 64 64v384c0 35-29 64-64 64H128c-35 0-64-29-64-64V320c0-35 29-64 64-64h128l64-128h192z"
      };
      function downloadHTML(gd, filename){
        const data = JSON.stringify(gd.data);
        const layout = JSON.stringify(gd.layout);
        const html = `<!DOCTYPE html><meta charset="utf-8">
<script src="${PLOTLY_CDN}"></script>
<div id="plot" style="width:100%;height:100vh"></div>
<script>Plotly.newPlot('plot', ${data}, ${layout}, {responsive:true});</script>`;
        const blob = new Blob([html], {type:"text/html"});
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = filename + ".html";
        a.click();
        setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
      }
      return {
        responsive: true,
        displaylogo: false,
        modeBarButtonsToAdd: [
          {
            name: "Download PNG",
            icon: iconSvg,
            click: (gd)=>Plotly.downloadImage(gd,{format:"png",filename:fname,scale:2})
          },
          {
            name: "Download SVG",
            icon: iconSvg,
            click: (gd)=>Plotly.downloadImage(gd,{format:"svg",filename:fname,scale:1})
          },
          {
            name: "Download HTML",
            icon: iconSvg,
            click: (gd)=>downloadHTML(gd, fname)
          }
        ]
      };
    }

    function renderYearBars(fA,fB,yMin,yMax,denomA,denomB,colorA,colorB){
      const years=[]; for(let y=yMin;y<=yMax;y++) years.push(y);
      const countBy=(arr)=>{const m=new Map();arr.forEach(p=>m.set(p.publication_year,(m.get(p.publication_year)||0)+1)); return years.map(y=>m.get(y)||0);};
      const a=countBy(fA).map(v=>v/(denomA||1));
      const b=countBy(fB).map(v=>v/(denomB||1));
      Plotly.newPlot("pubByYear",[
        {x:years,y:a,type:"bar",name:setText("#nameA").trim()||"A",marker:{color:colorA}},
        {x:years,y:b,type:"bar",name:setText("#nameB").trim()||"B",marker:{color:colorB}}
      ],{barmode:"group",margin:{l:40,r:10,t:8,b:40},yaxis:{title:(denomA!==1||denomB!==1)?"Publications per faculty":"Publications"},xaxis:{title:"Year",dtick:1},hovermode:"x unified"}, exportConfig("pubByYear","publications_by_year"));
      setText("#pubMeta",`Window: ${yMin}–${yMax}${(denomA!==1||denomB!==1)?" (per‑capita)":""}`);
    }

    function renderCrossNetwork(xpubs, rosterA, rosterB, colorA, colorB){
      const setA = new Set(rosterA.map(r=>r.OpenAlexID));
      const setB = new Set(rosterB.map(r=>r.OpenAlexID));
      const nameOf=(id,roster)=>{const r=roster.find(x=>x.OpenAlexID===id);return r?(r.Name||r.Display_name||id):id;};
      const nodes=new Map(), edges=new Map();
      for (const p of xpubs){
        const ids=p._all_author_ids.filter(id=>setA.has(id)||setB.has(id));
        const uniq=[...new Set(ids)];
        for(let i=0;i<uniq.length;i++)for(let j=i+1;j<uniq.length;j++){
          const a=uniq[i], b=uniq[j];
          const cross = (setA.has(a)&&setB.has(b)) || (setB.has(a)&&setA.has(b));
          if(!cross) continue;
          if (setA.has(a)) nodes.set(a,{id:a,name:nameOf(a,rosterA),side:"A"});
          if (setB.has(b)) nodes.set(b,{id:b,name:nameOf(b,rosterB),side:"B"});
          if (setB.has(a)) nodes.set(a,{id:a,name:nameOf(a,rosterB),side:"B"});
          if (setA.has(b)) nodes.set(b,{id:b,name:nameOf(b,rosterA),side:"A"});
          const key=[a,b].sort().join("|");
          edges.set(key,(edges.get(key)||0)+1);
        }
      }
      // Only nodes with edges (no isolates)
      const used = new Set();
      edges.forEach((_,k)=>k.split("|").forEach(id=>used.add(id)));
      const nA=[...nodes.values()].filter(n=>n.side==="A" && used.has(n.id));
      const nB=[...nodes.values()].filter(n=>n.side==="B" && used.has(n.id));

      // Sort by degree for spacing
      const deg=new Map();
      edges.forEach((w,k)=>k.split("|").forEach(id=>deg.set(id,(deg.get(id)||0)+w)));
      nA.sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0));
      nB.sort((a,b)=>(deg.get(b.id)||0)-(deg.get(a.id)||0));

      const pos=new Map();
      nA.forEach((n,i)=>pos.set(n.id,{x:0,y:i}));
      nB.forEach((n,i)=>pos.set(n.id,{x:1,y:i}));

      const edgeXs=[], edgeYs=[];
      edges.forEach((w,k)=>{
        const [a,b]=k.split("|");
        if(!pos.has(a) || !pos.has(b)) return; // safety
        edgeXs.push(pos.get(a).x,pos.get(b).x,null);
        edgeYs.push(pos.get(a).y,pos.get(b).y,null);
      });

      const trEdges={x:edgeXs,y:edgeYs,mode:"lines",line:{width:EDGE_WIDTH,color:"rgba(120,120,120,0.6)"},hoverinfo:"skip",showlegend:false};
      const trA={x:nA.map(n=>pos.get(n.id).x),y:nA.map(n=>pos.get(n.id).y),mode:"markers+text",type:"scatter",text:nA.map(n=>n.name),textposition:"middle left",marker:{size:NET_MARK_SIZE,color:colorA},hovertemplate:"%{text}<extra></extra>",showlegend:false};
      const trB={x:nB.map(n=>pos.get(n.id).x),y:nB.map(n=>pos.get(n.id).y),mode:"markers+text",type:"scatter",text:nB.map(n=>n.name),textposition:"middle right",marker:{size:NET_MARK_SIZE,color:colorB},hovertemplate:"%{text}<extra></extra>",showlegend:false};

      Plotly.newPlot("xNetwork",[trEdges,trA,trB],{margin:{l:20,r:20,t:10,b:30},xaxis:{visible:false},yaxis:{visible:false},hovermode:"closest"}, exportConfig("xNetwork","cross_school_network"));

      // Pairs table under network
      const tbody = el("#xPairsBody"); const detail = el("#xPairDetail");
      if (tbody){
        tbody.innerHTML = "";
        const rows = [...edges.entries()].sort((a,b)=>b[1]-a[1]);
        for (const [k,n] of rows){
          const [a,b]=k.split("|");
          const tr=document.createElement("tr");
          tr.innerHTML = `<td>${escapeHTML(authorName(a,rosterA,rosterB))}</td>
                          <td>${escapeHTML(authorName(b,rosterA,rosterB))}</td>
                          <td style="text-align:right">${n}</td>`;
          tr.addEventListener("click", ()=>{
            const papers = listJointPubsForPair(xpubs, a, b);
            detail.innerHTML = papers.length
              ? `<ul>${papers.map(p=>`<li>${escapeHTML(p.display_name||p.title||"(untitled)")} — ${p.publication_year||""}</li>`).join("")}</ul>`
              : "<em>No titles available.</em>";
            el("#xPairs").open = true;
            detail.scrollIntoView({behavior:"smooth",block:"nearest"});
          });
          tbody.appendChild(tr);
        }
      }
    }

    function listJointPubsForPair(pubs,a,b){
      return pubs.filter(p=>{
        const s=new Set(p._all_author_ids);
        return s.has(a)&&s.has(b);
      });
    }
    function authorName(id, rA, rB){
      let r = rA.find(x=>x.OpenAlexID===id) || rB.find(x=>x.OpenAlexID===id);
      return r ? (r.Name||r.Display_name||id) : id;
    }

    function computeAndRenderPCA(A,B,yMin,yMax,source){
      const fA = filterToRoster(A.dedup,A.roster,yMin,yMax,DEFAULT_TYPES);
      const fB = filterToRoster(B.dedup,B.roster,yMin,yMax,DEFAULT_TYPES);
      const mapA = authorTerms(fA, A.roster, source);
      const mapB = authorTerms(fB, B.roster, source);
      const names=[], schools=[], colors=[], xs=[], ys=[];

      // Build matrix
      const all=[...mapA.values(), ...mapB.values()];
      if (!all.length){
        Plotly.purge("pca"); setText("#pcaMeta","No authors."); return null;
      }
      const vocab=new Map();
      all.forEach(s=>s.forEach(t=>vocab.set(t,(vocab.get(t)||0)+1)));
      const terms=[...vocab.keys()];
      const N=all.length, T=terms.length;
      const M=new Array(N);
      for(let i=0;i<N;i++){
        const row=new Array(T).fill(0);
        const s=all[i];
        for(let j=0;j<T;j++) if (s.has(terms[j])) row[j]=1;
        M[i]=row;
      }
      // center
      const cm = new Array(T).fill(0);
      for(let j=0;j<T;j++){let s=0;for(let i=0;i<N;i++) s+=M[i][j]; cm[j]=s/N;}
      for(let i=0;i<N;i++) for(let j=0;j<T;j++) M[i][j]-=cm[j];

      function multMMt(v){
        const u=new Array(T).fill(0);
        for(let j=0;j<T;j++){let s=0;for(let i=0;i<N;i++) s+=M[i][j]*v[i]; u[j]=s;}
        const w=new Array(N).fill(0);
        for(let i=0;i<N;i++){let s=0;for(let j=0;j<T;j++) s+=M[i][j]*u[j]; w[i]=s;}
        return w;
      }
      function norm(v){return Math.sqrt(v.reduce((a,b)=>a+b*b,0));}
      function dot(a,b){let s=0;for(let i=0;i<a.length;i++) s+=a[i]*b[i]; return s;}
      function proj(u,v){const s=dot(u,v)/(dot(v,v)||1); return v.map(x=>s*x);}
      function sub(a,b){return a.map((x,i)=>x-b[i]);}
      function scale(a,c){return a.map(x=>x*c);}
      function powerIter(k=25){
        let v1=new Array(N).fill(0).map(()=>Math.random());
        for(let i=0;i<k;i++){ v1=multMMt(v1); const n=norm(v1)||1; v1=scale(v1,1/n); }
        let v2=new Array(N).fill(0).map(()=>Math.random());
        v2=sub(v2,proj(v2,v1));
        for(let i=0;i<k;i++){ v2=multMMt(v2); v2=sub(v2,proj(v2,v1)); const n=norm(v2)||1; v2=scale(v2,1/n); }
        return [v1,v2];
      }
      const [pc1, pc2]=powerIter(25);
      const NA = mapA.size;
      const trA = {
        x: pc1.slice(0,NA), y: pc2.slice(0,NA),
        mode:"markers", type:"scatter", name: A.meta.label||"A",
        text: [...mapA.keys()].map(id=>nameOf(id,A.roster)),
        marker: { size: new Array(NA).fill(PCA_MARK_SIZE), opacity: new Array(NA).fill(PCA_MARK_OPACITY) },
        hovertemplate: "%{text}<extra></extra>"
      };
      const trB = {
        x: pc1.slice(NA), y: pc2.slice(NA),
        mode:"markers", type:"scatter", name: B.meta.label||"B",
        text: [...mapB.keys()].map(id=>nameOf(id,B.roster)),
        marker: { size: new Array(mapB.size).fill(PCA_MARK_SIZE), opacity: new Array(mapB.size).fill(PCA_MARK_OPACITY) },
        hovertemplate: "%{text}<extra></extra>"
      };
      Plotly.newPlot("pca",[trA,trB],{margin:{l:30,r:10,t:10,b:30},xaxis:{zeroline:false},yaxis:{zeroline:false},hovermode:"closest"}, exportConfig("pca","pca_authors"));
      setText("#pcaMeta", `${(mapA.size+mapB.size)} authors; highlight via search above.`);
      return document.getElementById("pca");
    }

    function renderFoldChange(dfA, dfB, scaleA, scaleB, metaA, metaB){
      const eps=1e-6;
      const allTerms = new Set([...dfA.keys(), ...dfB.keys()]);
      const rows=[];
      allTerms.forEach(t=>{
        const a = (dfA.get(t)||0) / (scaleA||1);
        const b = (dfB.get(t)||0) / (scaleB||1);
        const l2 = Math.log2((a+eps)/(b+eps));
        const side = l2>=0 ? "A" : "B";
        const mag = Math.abs(l2);
        rows.push({term:t, l2, side, a, b, mag});
      });
      // pick top by |log2FC| with a minimal frequency threshold
      const filtered = rows.filter(r => (r.a + r.b) > 0.5).sort((x,y)=>y.mag-x.mag).slice(0,20);
      // plot bar
      const x = filtered.map(r=>r.term);
      const y = filtered.map(r=>r.l2);
      const colors = filtered.map(r=> r.l2>=0 ? (metaA.color||"#2563eb") : (metaB.color||"#059669"));
      Plotly.newPlot("foldChange", [{
        x, y, type:"bar", marker:{color:colors}, hovertemplate:"%{x}<br>log2FC=%{y:.2f}<extra></extra>"
      }],{
        margin:{l:50,r:10,t:10,b:70},
        yaxis:{title:`log2 Fold‑Change (${metaA.label||"A"} vs ${metaB.label||"B"})`},
        xaxis:{tickangle:-30}
      }, exportConfig("foldChange","fold_change_terms"));

      // Top terms lists (per school)
      const topN = 10;
      const topA = [...dfA.entries()].sort((a,b)=>b[1]-a[1]).slice(0,topN);
      const topB = [...dfB.entries()].sort((a,b)=>b[1]-a[1]).slice(0,topN);
      const div = el("#enrichmentLists");
      if (div){
        div.innerHTML = `
          <div class="enrich-col"><h4>${escapeHTML(metaA.label||"A")} top terms</h4>
            <ul>${topA.map(([t,n])=>`<li>${escapeHTML(t)} <span class="muted">(${n})</span></li>`).join("")}</ul>
          </div>
          <div class="enrich-col"><h4>${escapeHTML(metaB.label||"B")} top terms</h4>
            <ul>${topB.map(([t,n])=>`<li>${escapeHTML(t)} <span class="muted">(${n})</span></li>`).join("")}</ul>
          </div>`;
      }
    }

    // ========== Data utils ==========
    function fetchCSV(path){ return fetch(path).then(r=>{ if(!r.ok) throw new Error("CSV not found: "+path); return r.text(); }); }
    function fetchJSON(path){ return fetch(path).then(r=>{ if(!r.ok) throw new Error("JSON not found: "+path); return r.json(); }); }
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
        r.Name = r.Name || r.Display_name || r.name || r.OpenAlexID;
      });
    }
    function normalizePubs(rows){
      rows.forEach(p => {
        p.publication_year = Number(p.publication_year || p.year || 0);
        p.type = normalizeType(p.type || p.display_type);
        const ids = String(p["authorships__author__id"]||"").trim();
        const arr = ids ? ids.split("|").map(normalizeID).filter(Boolean) : [];
        const single = normalizeID(p.author_openalex_id || p.author_id || p.OpenAlexID);
        p._all_author_ids = arr.length ? arr : (single ? [single] : []);
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
    function nameOf(id, roster){ const r = roster.find(x=>x.OpenAlexID===id); return r ? (r.Name||r.Display_name||id) : id; }
    function authorTerms(pubs, roster, source){
      const ids = new Set(roster.map(r=>r.OpenAlexID));
      const map = new Map();
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
    function termDocFreq(pubs, source){
      const df=new Map();
      pubs.forEach(p=>{
        const terms = (source === "topics") ? p._topics : p._concepts;
        new Set(terms).forEach(t=>df.set(t,(df.get(t)||0)+1));
      });
      return df;
    }
    function crossSchoolPubs(fA,fB,rosterA,rosterB){
      const setA=new Set(rosterA.map(r=>r.OpenAlexID)), setB=new Set(rosterB.map(r=>r.OpenAlexID));
      const all=[...fA,...fB]; const seen=new Map();
      for(const p of all){
        const key = p.id ? String(p.id).replace(/^https?:\/\/openalex\.org\//i,'') :
                    (p.doi ? "doi:"+String(p.doi).toLowerCase() :
                    ("t:"+String(p.display_name||"").toLowerCase()));
        if (seen.has(key)) continue;
        const hasA = p._all_author_ids.some(id=>setA.has(id));
        const hasB = p._all_author_ids.some(id=>setB.has(id));
        if (hasA && hasB) seen.set(key,p);
      }
      return [...seen.values()];
    }

    // ========== tiny DOM helpers ==========
    function el(q){ return document.querySelector(q); }
    function setText(q, v){
      const node = typeof q==="string" ? el(q) : q;
      if (v===undefined) return node?.textContent || "";
      if (node) node.textContent = v; return v;
    }
    function setDot(id,color){ const n=document.getElementById(id); if(n) n.style.background=color; }
    function clampYear(y){ if(!y) return 2021; if (y<1990) return 1990; if (y>2100) return 2100; return y; }
    function debounce(fn,ms){ let t=null; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn.apply(null,a),ms); }; }
    function escapeHTML(s){ return String(s).replace(/[&<>"']/g, m=>({ "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[m])); }
  }
})();
