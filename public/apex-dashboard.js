(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const nav = document.querySelector(".nav");
  if (!nav || $("apex-command-center")) return;

  const button = document.createElement("button");
  button.dataset.view = "apex-command";
  button.textContent = "Apex Command";
  button.onclick = () => apexCommandView();
  nav.insertBefore(button, nav.firstChild);

  const sacredButton = document.createElement("button");
  sacredButton.dataset.view = "sacred-library";
  sacredButton.textContent = "Sacred Library";
  sacredButton.onclick = () => sacredLibraryView();
  nav.appendChild(sacredButton);
  const quirkButton = document.createElement("button");
  quirkButton.dataset.view = "quirk-lab";
  quirkButton.textContent = "Quirk Lab";
  quirkButton.onclick = () => quirkLabView();
  nav.appendChild(quirkButton);
  const toolsButton = document.createElement("button");
  toolsButton.dataset.view = "studio-tools";
  toolsButton.textContent = "Studio Tools";
  toolsButton.onclick = () => studioToolsView();
  nav.appendChild(toolsButton);


  const ytButton=document.createElement("button");
  ytButton.dataset.view="youtube-intelligence";ytButton.textContent="YouTube Intelligence";ytButton.onclick=()=>youtubeIntelligenceView();nav.appendChild(ytButton);
  const main = document.querySelector("main");
  const yt=document.createElement("section");
  yt.id="youtube-intelligence";yt.className="view hidden";
  yt.innerHTML=`
    <div class="top"><div><div class="eyebrow">Lifetime channel intelligence</div><h1>YouTube Intelligence</h1><p>Persistent history, performance patterns, trends, opportunities and one-click script generation.</p></div><div class="actions"><button class="primary" id="ytRefresh">Analyze lifetime</button></div></div>
    <div class="cards">
      <div class="card"><div id="ytVideos" class="num">—</div><div class="label">Videos analyzed</div></div>
      <div class="card"><div id="ytViews" class="num">—</div><div class="label">Lifetime views</div></div>
      <div class="card"><div id="ytWatch" class="num">—</div><div class="label">Watch minutes</div></div>
      <div class="card"><div id="ytCtr" class="num">—</div><div class="label">Median CTR</div></div>
    </div>
    <div class="workspace">
      <section class="panel"><h2>One-click Script Factory</h2><div class="form"><input id="ytTopic" placeholder="Topic"><input id="ytAudience" placeholder="Audience"><div class="inline"><input id="ytDuration" type="number" value="8" min="1"><input id="ytTone" value="cinematic, clear, emotionally engaging"></div><textarea id="ytSources" placeholder="Source references, one per line"></textarea><button class="primary" id="ytGenerate">Generate full script with Gemini</button><div id="ytScriptStatus" class="notice">—</div></div></section>
      <section class="panel"><h2>Channel opportunity map</h2><div id="ytOpp" class="list"></div></section>
    </div>
    <div class="workspace" style="margin-top:14px">
      <section class="panel"><h2>Lifetime top performers</h2><div id="ytTop" class="list"></div></section>
      <section class="panel"><h2>Monthly trend history</h2><div id="ytTrend" class="list"></div></section>
    </div>
    <section class="panel" style="margin-top:14px"><h2>Generated script</h2><pre id="ytScriptOut" class="notice" style="white-space:pre-wrap;max-height:720px;overflow:auto">Generate a script to populate this workspace.</pre></section>`;
  main.appendChild(yt);

  const tools = document.createElement("section");
  tools.id = "studio-tools";
  tools.className = "view hidden";
  tools.innerHTML = `
    <div class="top"><div><div class="eyebrow">Free production utilities</div><h1>Studio Tools</h1><p>Fast local helpers for timing, captions, scripts, prompts, delivery and production readiness.</p></div></div>
    <div class="workspace">
      <section class="panel"><h2>Script Analyzer</h2><textarea id="toolScript" placeholder="Paste script text"></textarea><button class="primary" id="toolAnalyze">Analyze</button><div id="toolStats" class="notice">—</div></section>
      <section class="panel"><h2>Prompt Pack</h2><input id="toolSubject" placeholder="Subject"><input id="toolLocation" placeholder="Location"><input id="toolCamera" placeholder="Camera / framing"><button class="primary" id="toolPrompt">Build prompts</button><pre id="toolPromptOut" class="notice">—</pre></section>
    </div>
    <div class="workspace" style="margin-top:14px">
      <section class="panel"><h2>Timecode</h2><input id="toolSeconds" type="number" step="0.001" placeholder="Seconds"><button id="toolTime">Convert</button><div id="toolTimeOut" class="notice">—</div></section>
      <section class="panel"><h2>Delivery</h2><select id="toolPreset"><option value="master">Master 16:9</option><option value="youtube-1080p">YouTube 1080p</option><option value="vertical">Vertical 9:16</option><option value="square">Square 1:1</option><option value="cinema-2k">Cinema 2K</option></select><button id="toolDelivery">Inspect</button><div id="toolDeliveryOut" class="notice">—</div></section>
    </div>`;
  main.appendChild(tools);
  const quirk = document.createElement("section");
  quirk.id = "quirk-lab";
  quirk.className = "view hidden";
  quirk.innerHTML = `
    <div class="top"><div><div class="eyebrow">Apex playful intelligence</div><h1>Quirk Lab</h1><p>Optional little details that make episodes more replayable, memorable, and fun without changing Scripture.</p></div></div>
    <div class="workspace">
      <section class="panel"><h2>Generate sparks</h2><div class="form"><input id="quirkPassage" placeholder="Genesis 22:1-19"><input id="quirkThreads" placeholder="Universe threads (optional)"><button class="primary" id="quirkGenerate">Surprise me</button><div id="quirkMsg" class="error"></div></div></section>
      <section class="panel"><h2>Suggested quirks</h2><div id="quirkList" class="list"></div></section>
    </div>`;
  main.appendChild(quirk);
  const section = document.createElement("section");
  section.id = "apex-command-center";
  section.className = "view hidden";
  section.innerHTML = `
    <div class="workspace">
      <section class="panel">
        <div class="eyebrow">Apex intelligence</div>
        <h2>Command Center</h2>
        <div class="cards">
          <div class="card"><div id="ccEpisodes" class="num">—</div><div class="label">Episodes</div></div>
          <div class="card"><div id="ccBlockers" class="num">—</div><div class="label">Active blockers</div></div>
          <div class="card"><div id="ccCrews" class="num">—</div><div class="label">Agent crews</div></div>
          <div class="card"><div id="ccExperiments" class="num">—</div><div class="label">Growth experiments</div></div>
        </div>
        <div id="ccStatus" class="notice">Loading command state…</div>
      </section>
      <section class="panel">
        <h2>Episode pipeline</h2>
        <div id="ccEpisodesList" class="list"></div>
      </section>
    </div>
    <div class="workspace" style="margin-top:14px">
      <section class="panel"><h2>Quality blockers</h2><div id="ccBlockerList" class="list"></div></section>
      <section class="panel"><h2>Agent crews & authority</h2><div id="ccCrewList" class="list"></div></section>
    </div>`;
  main.appendChild(section);

  const sacred = document.createElement("section");
  sacred.id = "sacred-library";
  sacred.className = "view hidden";
  sacred.innerHTML = `
    <div class="top">
      <div><div class="eyebrow">Textual foundation</div><h1>Sacred Library</h1><p>Scripture, translations, witnesses, traditions, and historical sources with provenance kept explicit.</p></div>
    </div>
    <div class="workspace">
      <section class="panel"><h2>Text families</h2><div id="sacredFamilies" class="list"></div></section>
      <section class="panel"><h2>Library rules</h2><div id="sacredRules" class="list"></div></section>
    </div>`;
  main.appendChild(sacred);

  function activate(name) {
    document.querySelectorAll(".view").forEach(x => x.classList.add("hidden"));
    $(name).classList.remove("hidden");
    document.querySelectorAll(".nav button").forEach(x => x.classList.toggle("active", x.dataset.view === name));
  }

  window.youtubeIntelligenceView=async function(){
    activate("youtube-intelligence");
    const load=async()=>{
      try{
        const d=await api("/api/studio/youtube/intelligence");
        const l=d.lifetime||{};
        $("ytVideos").textContent=l.videos??0;$("ytViews").textContent=Number(l.totalViews||0).toLocaleString();$("ytWatch").textContent=Number(l.totalWatchTimeMinutes||0).toLocaleString();$("ytCtr").textContent=((l.medianCtr||0).toFixed(2))+"%";
        $("ytTop").innerHTML=(l.topVideos||[]).map(v=>"<div class='row'><div><b>"+esc(v.title)+"</b><span class='muted'>"+Number(v.views||0).toLocaleString()+" views · "+Number(v.retention||0).toFixed(1)+"% retention · "+Number(v.ctr||0).toFixed(2)+"% CTR</span></div></div>").join("")||empty("No channel history imported.");
        $("ytOpp").innerHTML=(d.opportunities||[]).map(x=>"<div class='row'><div><b>"+esc(x.topic)+"</b><span class='muted'>"+x.evidenceVideos+" videos · "+Number(x.avgViews||0).toFixed(0)+" avg views · "+Number(x.avgRetention||0).toFixed(1)+"% retention · "+Number(x.avgCtr||0).toFixed(2)+"% CTR</span></div></div>").join("")||empty("Import lifetime video analytics.");
        $("ytTrend").innerHTML=(d.trends||[]).slice(-18).reverse().map(x=>"<div class='row'><div><b>"+esc(x.month)+"</b><span class='muted'>"+Number(x.videos||0)+" videos · "+Number(x.views||0).toLocaleString()+" views · "+Number(x.growth||0).toFixed(1)+"% vs prior month</span></div></div>").join("")||empty("No dated analytics.");
      }catch(e){$("ytScriptStatus").textContent=e.message}
    };
    $("ytRefresh").onclick=load;
    $("ytGenerate").onclick=async()=>{
      $("ytScriptStatus").textContent="Generating…";
      try{
        const r=await api("/api/studio/youtube/script/generate",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({topic:$("ytTopic").value,audience:$("ytAudience").value,durationMinutes:Number($("ytDuration").value),tone:$("ytTone").value,sourceRefs:$("ytSources").value.split("\\n").map(x=>x.trim()).filter(Boolean)})});
        $("ytScriptOut").textContent=JSON.stringify(r.result||r,null,2);$("ytScriptStatus").textContent=r.configured?"Gemini generation complete.":"Brief generated; configure GEMINI_API_KEY for direct generation.";
      }catch(e){$("ytScriptStatus").textContent=e.message}
    };
    await load();
  };

  window.quirkLabView = function() {
    activate("quirk-lab");
    $("quirkGenerate").onclick = async () => {
      $("quirkMsg").textContent = "";
      try {
        const refs = $("quirkPassage").value.trim() ? [{ type:"bible", passage:$("quirkPassage").value.trim() }] : [];
        const threads = $("quirkThreads").value.split(",").map(x=>x.trim()).filter(Boolean);
        const data = await api("/api/studio/quirks/suggest", {method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({sourceRefs:refs,canonThreads:threads,count:5})});
        $("quirkList").innerHTML = data.map(x => "<div class='row'><div><b>"+esc(x.title)+"</b><span class='muted'>"+esc(x.description)+"</span></div><span class='pill'>OPTIONAL</span></div>").join("");
      } catch(e) { $("quirkMsg").textContent = e.message; }
    };
  };

  window.studioToolsView = async function() {
    activate("studio-tools");
    $("toolAnalyze").onclick = async () => {
      try { const r=await api("/api/studio/tools/script-stats",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({text:$("toolScript").value})}); $("toolStats").textContent=`${r.result.words} words · ~${r.result.estimatedMinutes} min · ${r.result.dialogueLines} dialogue lines`; } catch(e) { $("toolStats").textContent=e.message; }
    };
    $("toolPrompt").onclick = async () => {
      try { const r=await api("/api/studio/tools/prompt-pack",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({subject:$("toolSubject").value,location:$("toolLocation").value,camera:$("toolCamera").value})}); $("toolPromptOut").textContent=JSON.stringify(r.result,null,2); } catch(e) { $("toolPromptOut").textContent=e.message; }
    };
    $("toolTime").onclick = async () => {
      try { const r=await api("/api/studio/tools/timecode",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({seconds:Number($("toolSeconds").value),fps:24})}); $("toolTimeOut").textContent=r.result.timecode; } catch(e) { $("toolTimeOut").textContent=e.message; }
    };
    $("toolDelivery").onclick = async () => {
      try { const r=await api("/api/studio/tools/aspect-ratios",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({preset:$("toolPreset").value})}); $("toolDeliveryOut").textContent=`${r.result.width}×${r.result.height} @ ${r.result.fps}fps`; } catch(e) { $("toolDeliveryOut").textContent=e.message; }
    };
  };

  window.apexCommandView = async function() {
    activate("apex-command-center");
    try {
      const data = await api("/api/studio/command-center");
      const episodes = data.episodes || [];
      const blockers = (data.blockers || []).flatMap(x => {
        const b = x.gate?.blockers || [];
        return b.map(y => ({episode:x.id, message:y.detail || y.name || "Blocked"}));
      });
      $("ccEpisodes").textContent = episodes.length;
      $("ccBlockers").textContent = blockers.length;
      $("ccCrews").textContent = (data.crews || []).length;
      $("ccExperiments").textContent = (data.growth || []).length;
      $("ccStatus").innerHTML = data.humanAuthority?.finalDecisionRequired
        ? "Human final authority is active. Apex can prepare and recommend, but release remains explicitly human-approved."
        : "Command state loaded.";
      $("ccEpisodesList").innerHTML = episodes.map(e =>
        "<div class='row'><div><b>"+esc(e.title || e.id)+"</b><span class='muted'>Stage: "+esc(e.stage)+" · Readiness: "+esc(JSON.stringify(e.readiness))+"</span></div><span class='pill'>"+esc(e.id)+"</span></div>"
      ).join("") || empty("No episodes yet.");
      $("ccBlockerList").innerHTML = blockers.map(b =>
        "<div class='row'><div><b>"+esc(b.episode)+"</b><span class='muted'>"+esc(b.message)+"</span></div><span class='pill'>BLOCKED</span></div>"
      ).join("") || empty("No active quality blockers.");
      $("ccCrewList").innerHTML = (data.crews || []).map(c =>
        "<div class='row'><div><b>"+esc(c.episodeId || c.id)+"</b><span class='muted'>"+esc(c.approval?.status || "pending")+" · "+esc(String(c.agents?.length || 0))+" agents</span></div><span class='pill'>"+esc(c.approval?.required ? "HUMAN APPROVAL" : "AUTONOMOUS")+"</span></div>"
      ).join("") || empty("No agent crews yet.");
    } catch (e) {
      $("ccStatus").textContent = e.message;
    }
  };

  window.sacredLibraryView = async function() {
    activate("sacred-library");
    try {
      const data = await api("/api/studio/sacred/catalog");
      $("sacredFamilies").innerHTML = (data.families || []).map(x =>
        "<div class='row'><div><b>"+esc(x.name)+"</b><span class='muted'>"+esc(x.tradition)+" · "+esc(x.category)+"</span></div><span class='pill'>"+esc(x.id)+"</span></div>"
      ).join("") || empty("No sacred text families registered.");
      $("sacredRules").innerHTML = Object.entries(data.rules || {}).map(([k,v]) =>
        "<div class='row'><div><b>"+esc(k)+"</b><span class='muted'>"+esc(v)+"</span></div></div>"
      ).join("");
    } catch (e) {
      $("sacredRules").innerHTML = empty(e.message);
    }
  };

  window.view = ((original) => function(name) {
    if (name === "apex-command") return apexCommandView();
    if (name === "studio-tools") return studioToolsView();
    if (name === "sacred-library") return sacredLibraryView();
    return original(name);
  })(window.view);
})();
/* Network runtime: production network controls and client verification. */
(()=>{const $=id=>document.getElementById(id);const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));let lastNetwork=null,monitorTimer=null;
function getApexClientId(){try{const key="apex.network.clientId";let id=localStorage.getItem(key);if(!id){id=(globalThis.crypto?.randomUUID?.()||("apex-"+Date.now()+"-"+Math.random().toString(36).slice(2)));localStorage.setItem(key,id)}return id}catch(_){return globalThis.crypto?.randomUUID?.()||("apex-"+Date.now()+"-"+Math.random().toString(36).slice(2))}}
async function sendClientTelemetry(){try{const nc=navigator.connection||navigator.mozConnection||navigator.webkitConnection;await fetch("/api/network/client-telemetry",{method:"POST",headers:{"content-type":"application/json","x-apex-client-id":getApexClientId()},body:JSON.stringify({online:navigator.onLine,type:nc?.type||"unknown",effectiveType:nc?.effectiveType||"unknown",downlinkMbps:nc?.downlink??null,rttMs:nc?.rtt??null,saveData:!!nc?.saveData})})}catch(_){}}
async function fetchNetwork(){await sendClientTelemetry();const r=await fetch("/api/network/status",{cache:"no-store",headers:{"x-apex-client-id":getApexClientId()}});let d={};try{d=await r.json()}catch{}if(!r.ok)throw Error(d.error||"Network status failed");lastNetwork=d;return d}
window.loadNetwork=async function(){const msg=$("networkMsg");if(msg)msg.textContent="";try{const x=await fetchNetwork(),c=Array.isArray(x.candidates)?x.candidates:[],h=c.filter(p=>p?.healthy);if($("networkState"))$("networkState").textContent=x.status||x.state||"—";if($("networkSelected"))$("networkSelected").textContent=x.selected?.device||"—";if($("networkHealthy"))$("networkHealthy").textContent=h.length;if($("networkLanes"))$("networkLanes").textContent=x.speed?.lanes??"—";if($("networkActive"))$("networkActive").textContent=x.selected?JSON.stringify(x.selected,null,2):"No selected network path";if($("networkFailover"))$("networkFailover").textContent=JSON.stringify(x.failover||[],null,2);if($("networkPolicy"))$("networkPolicy").textContent=JSON.stringify(x.policy||{},null,2);if($("networkSpeed"))$("networkSpeed").textContent=JSON.stringify(x.speed||{},null,2);if($("networkCandidates"))$("networkCandidates").innerHTML=c.map(p=>"<div class='row'><div><b>"+esc(p.device||"Unknown path")+"</b><span class='muted'>"+esc(p.network||"network")+" · score "+esc(String(p.score??"—"))+"</span></div><span class='pill'>"+(p.healthy?"HEALTHY":"OFFLINE")+"</span></div>").join("")||"<div class='empty'>No candidates reported.</div>";const nc=navigator.connection||navigator.mozConnection||navigator.webkitConnection;if($("networkClient"))$("networkClient").textContent=nc?JSON.stringify({type:nc.type||"unknown",effectiveType:nc.effectiveType||"unknown",downlinkMbps:nc.downlink??null,rttMs:nc.rtt??null,saveData:!!nc.saveData},null,2):"Browser Network Information API unavailable.";if($("networkLastCheck"))$("networkLastCheck").textContent="Last telemetry: "+new Date().toLocaleTimeString();return x}catch(e){if(msg)msg.textContent=e.message||"Network status failed";if($("networkState"))$("networkState").textContent="ERROR";throw e}};
async function runNetworkBenchmark(mib=32){const panel=$("networkBenchmark"),buttons=document.querySelectorAll("[data-network-benchmark]");if(!panel)return;buttons.forEach(b=>b.disabled=true);panel.innerHTML="<div class='notice'>Downloading "+mib+" MiB… <b id='networkBenchmarkProgress'>0%</b></div>";const started=performance.now();try{const r=await fetch("/api/network/throughput?mib="+encodeURIComponent(mib),{cache:"no-store"});if(!r.ok||!r.body)throw Error("Throughput test unavailable (HTTP "+r.status+")");const total=Number(r.headers.get("x-apex-benchmark-bytes")||mib*1048576),reader=r.body.getReader();let bytes=0;for(;;){const q=await reader.read();if(q.done)break;bytes+=q.value?.byteLength||0;const p=$("networkBenchmarkProgress");if(p)p.textContent=Math.min(100,bytes/total*100).toFixed(0)+"%"}const elapsed=Math.max(1,performance.now()-started),mbps=bytes*8/(elapsed/1000)/1e6;panel.innerHTML="<div class='cards'><div class='card'><div class='num'>"+mbps.toFixed(2)+" Mbps</div><div class='label'>Measured throughput</div></div><div class='card'><div class='num'>"+(bytes/1048576).toFixed(1)+" MiB</div><div class='label'>Downloaded</div></div><div class='card'><div class='num'>"+(elapsed/1000).toFixed(2)+" s</div><div class='label'>Elapsed</div></div><div class='card'><div class='num'>PASS</div><div class='label'>Benchmark</div></div></div>"}catch(e){panel.innerHTML="<div class='error'>"+esc(e.message||"Throughput test failed")+"</div>"}finally{buttons.forEach(b=>b.disabled=false)}}
async function networkDiagnostics(){const out=$("networkDiagnostics");if(!out)return;out.textContent="Running full network diagnostics…";try{const started=performance.now(),status=await fetchNetwork(),nc=navigator.connection||navigator.mozConnection||navigator.webkitConnection,rs=performance.now(),ping=await fetch("/health?network_diag="+Date.now(),{cache:"no-store",headers:{"x-apex-network-diagnostic":"1"}}),rtt=performance.now()-rs;out.textContent=JSON.stringify({status:status.status,selectedPath:status.selected?.device||null,selectedNetwork:status.selected?.network||null,healthyPaths:(status.candidates||[]).filter(x=>x?.healthy).length,candidateCount:(status.candidates||[]).length,failoverReady:Array.isArray(status.failover)&&status.failover.length>0,speedPolicy:status.speed||null,runtimeVerified:!!status.verified?.runtimeInterfacesObserved,clientWifiObserved:!!status.verified?.clientWifiObserved,clientCellularObserved:!!status.verified?.clientCellularObserved,clientNetwork:nc?{type:nc.type||"unknown",effectiveType:nc.effectiveType||"unknown",downlinkMbps:nc.downlink??null,rttMs:nc.rtt??null}:null,clientToApexHealth:ping.ok,clientToApexRttMs:Number(rtt.toFixed(1)),completedAt:new Date().toISOString(),durationMs:Number((performance.now()-started).toFixed(1))},null,2)}catch(e){out.textContent="DIAGNOSTICS FAILED: "+(e.message||String(e))}}
async function copyNetworkDiagnostics(){const out=$("networkDiagnostics"),msg=$("networkCopyMsg");if(!out)return;try{const payload=out.textContent&&out.textContent!=="—"?out.textContent:JSON.stringify(await fetchNetwork(),null,2);await navigator.clipboard.writeText(payload);if(msg)msg.textContent="Diagnostics copied."}catch(e){if(msg)msg.textContent="Copy unavailable: "+(e.message||"permission denied")}}
function toggleNetworkMonitor(){const b=$("networkMonitorBtn");if(monitorTimer){clearInterval(monitorTimer);monitorTimer=null;if(b)b.textContent="Start live monitor";return}if(b)b.textContent="Stop live monitor";loadNetwork().catch(()=>{});monitorTimer=setInterval(()=>loadNetwork().catch(()=>{}),5000)}
function installNetworkControls(){const n=$("network");if(!n)return;if(!$("networkControls")){const box=document.createElement("section");box.id="networkControls";box.className="panel";box.style.marginTop="14px";box.innerHTML="<h2>Network controls</h2><p class='muted'>Live diagnostics for the client → Apex path. These controls do not falsely claim to reconfigure the iPhone modem.</p><div class='actions' style='flex-wrap:wrap'><button class='primary' id='networkDiagnoseBtn'>Run full diagnostics</button><button id='networkMonitorBtn'>Start live monitor</button><button id='networkCopyBtn'>Copy diagnostics</button></div><div id='networkCopyMsg' class='success' style='margin-top:8px'></div><pre id='networkDiagnostics' class='notice' style='white-space:pre-wrap;overflow:auto;margin-top:12px'>—</pre>";n.appendChild(box);$("networkDiagnoseBtn").onclick=networkDiagnostics;$("networkMonitorBtn").onclick=toggleNetworkMonitor;$("networkCopyBtn").onclick=copyNetworkDiagnostics}if(!$("networkClient")){const box=document.createElement("section");box.id="networkClientPanel";box.className="panel";box.style.marginTop="14px";box.innerHTML="<h2>This device</h2><p class='muted'>Browser-reported connection telemetry when supported by iOS Safari.</p><pre id='networkClient' class='notice' style='white-space:pre-wrap;overflow:auto'>Checking…</pre><div id='networkLastCheck' class='muted'></div>";n.appendChild(box)}if(!$("networkBenchmark")){const box=document.createElement("section");box.className="panel";box.style.marginTop="14px";box.innerHTML="<h2>Real throughput test</h2><p class='muted'>Measures actual client → Apex transfer from this device.</p><div class='actions' style='flex-wrap:wrap'><button class='primary' data-network-benchmark id='networkTest32'>Test 32 MiB</button><button data-network-benchmark id='networkTest64'>Test 64 MiB</button></div><div id='networkBenchmark' style='margin-top:14px'></div>";n.appendChild(box);$("networkTest32").onclick=()=>runNetworkBenchmark(32);$("networkTest64").onclick=()=>runNetworkBenchmark(64)}}
const originalView=window.view;window.view=function(name){if(typeof originalView==="function"){try{originalView(name)}catch(_){}}else{document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));const el=$(name);if(el)el.classList.remove("hidden")}if(name==="network"){const n=$("network");if(n){n.classList.remove("hidden");installNetworkControls();loadNetwork().catch(()=>{})}}};document.addEventListener("DOMContentLoaded",()=>{const b=document.querySelector('.nav button[data-view="network"]');if(b)b.onclick=()=>window.view("network")});
})();
