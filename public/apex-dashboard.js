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

  // BIBLICALLY SEEN crew personality layer.
  const cornNuts=(score=0)=>{const n=Math.max(0,Math.min(5,Math.round(Number(score)||0)));return '<span class="cornnut" aria-label="'+n+' CornNuts">'+Array.from({length:5},(_,i)=>'<i>'+(i<n?'🌽':'·')+'</i>').join('')+'</span>';};
  window.apexCornNuts=cornNuts;
  window.APEX_CREW_NAMES=Object.freeze({kernels:["Cornilius","Kernelina","Cornelius Jr.","Corny B.","Kernel Bob","Cornrad","Kernel Belle","Cornathan"],cobs:["Cobby","Cobert","Cobbie Wan","Cob Marley","Cob Dylan","Cob Ross","Cob Web","Cobzilla"]});

  const makeCrewRoom = () => {
    if(document.getElementById("holy-moly-room")) return;
    const main=document.querySelector("main"), nav=document.querySelector(".nav");
    const addNav=(id,label,fn)=>{const b=document.createElement("button");b.dataset.view=id;b.textContent=label;b.onclick=fn;nav.appendChild(b)};
    const holy=document.createElement("section");holy.id="holy-moly-room";holy.className="view hidden";
    holy.innerHTML=`
      <div class="top"><div><div class="eyebrow">📖 Bible Room</div><h1>HOLY MOLY</h1><p>The cozy Scripture study where the Kernels dig, verify, connect and discover.</p></div><div class="crew-badge">🌽 Kernels at work</div></div>
      <div class="workspace">
        <section class="panel room-card"><div><div class="room-icon">📚</div><h2>Your Bibles</h2><p class="muted">Master Bible · Movie Bible · My Study Bible · character studies · research shelves</p></div><span class="little-note">The shelves keep getting smarter.</span></section>
        <section class="panel room-card"><div><div class="room-icon">🍿</div><h2>Popcorn Drawer</h2><p class="muted">Cinematic Scripture discoveries, each carrying its source, evidence and CornNut rating.</p></div><span class="little-note">POP! Something worth filming.</span></section>
      </div>
      <section class="panel" style="margin-top:14px"><h2>🌽 Kernel Desk</h2><div id="kernel-roster" class="list"></div></section>`;
    const studio=document.createElement("section");studio.id="biblically-seen-room";studio.className="view hidden";
    studio.innerHTML=`
      <div class="top"><div><div class="eyebrow">🎬 Studio</div><h1>BIBLICALLY SEEN</h1><p>The cozy production house where the Cobs turn verified discoveries into cinema.</p></div><div class="crew-badge">🌽 Cobs building</div></div>
      <div class="workspace">
        <section class="panel room-card"><div><div class="room-icon">🎬</div><h2>Director's Room</h2><p class="muted">Story, shots, visual DNA, blocking and performance decisions.</p></div><span class="little-note">Make it beautiful. Make it biblical.</span></section>
        <section class="panel room-card"><div><div class="room-icon">🎥</div><h2>Protocob Workshop</h2><p class="muted">Private visual pitches from the Cobs. Nothing publishes. You decide what survives.</p></div><span class="little-note">The Cobs have a pitch.</span></section>
      </div>
      <section class="panel" style="margin-top:14px"><h2>🌽 Cob Workshop</h2><div id="cob-roster" class="list"></div></section>`;
    main.appendChild(holy);main.appendChild(studio);
    addNav("holy-moly-room","HOLY MOLY",()=>room("holy-moly-room"));
    addNav("biblically-seen-room","BIBLICALLY SEEN",()=>room("biblically-seen-room"));
    const roster=(id,names,role)=>{const el=document.getElementById(id);el.innerHTML=names.map((n,i)=>"<div class='row'><div><b>"+esc(n)+"</b><span class='muted'>"+esc(role[i%role.length])+"</span></div><span class='pill'>"+(i%3===0?"WORKING":"READY")+"</span></div>").join("")};
    const room=(id)=>{document.querySelectorAll(".view").forEach(x=>x.classList.add("hidden"));document.getElementById(id).classList.remove("hidden");document.querySelectorAll(".nav button").forEach(x=>x.classList.toggle("active",x.dataset.view===id));if(id==="holy-moly-room")roster("kernel-roster",window.APEX_CREW_NAMES.kernels,["Scripture research","Passage finding","Historical context","Character research","Geography","Timeline","Verification","Popcorn hunting"]);else roster("cob-roster",window.APEX_CREW_NAMES.cobs,["Production coordination","Direction","Cinematography","Music","Dialogue","Environment design","VFX","Epic spectacle"])};
    window.holyMolyRoom=()=>room("holy-moly-room");window.biblicallySeenRoom=()=>room("biblically-seen-room");
  };
  makeCrewRoom();

})();