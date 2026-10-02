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


  const main = document.querySelector("main");
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
    if (name === "sacred-library") return sacredLibraryView();
    return original(name);
  })(window.view);
})();