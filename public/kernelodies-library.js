(() => {
  const root = document.getElementById("kernelodies-library");
  if (!root) return;
  root.innerHTML = `
    <h2>TheQuietDesk · Kernelodies Library</h2>
    <p>Independent music listening, starting with the relaxing Bible-study experience. No streaming account is required.</p>
    <p>Imported audio is preserved byte-for-byte; this library does not retune or certify 432 Hz. Jesus Freaks productions must satisfy the 432 Hz canon before release.</p>
    <label>Storage mode
      <select id="kl-mode">
        <option value="local">Browser-local · this device</option>
        <option value="server">Apex shared storage · protected</option>
      </select>
    </label>
    <p id="kl-mode-note">Audio and metadata stay in this browser. This is not shared storage.</p>
    <label id="kl-token-label" hidden>Control token <input id="kl-token" type="password" autocomplete="off" placeholder="KERNEL... shared-library token"></label>
    <label>Track title <input id="kl-title" maxlength="200" placeholder="Track title (optional)"></label>
    <label>Artist <input id="kl-artist" maxlength="200" placeholder="Artist (optional)"></label>
    <label>Album <input id="kl-album" maxlength="200" placeholder="Album (optional)"></label>
    <label>Audio file <input id="kl-file" type="file" accept="audio/*"></label>
    <button id="kl-upload">Save to browser library</button>
    <button id="kl-refresh" type="button">Refresh library</button>
    <button id="kl-export" type="button">Export metadata only</button>
    <button id="kl-import" type="button">Import metadata only</button>
    <input id="kl-json" type="file" accept="application/json,.json" hidden>
    <p id="kl-status" role="status">Opening browser-local library…</p>
    <div id="kl-tracks"></div>`;
  const $ = id => document.getElementById(id);
  const DB = "music-radar-independent";
  const STORE = "tracks";
  const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
  const byExtension = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm" };
  const allowedTypes = new Set(Object.values(byExtension));
  const status = message => { $("kl-status").textContent = message; };
  const token = () => $("kl-token").value.trim();
  const serverMode = () => $("kl-mode").value === "server";

  function openDB() {
    return new Promise((resolve, reject) => {
      if (!("indexedDB" in window)) return reject(new Error("Browser-local storage is unavailable in this browser."));
      const request = indexedDB.open(DB, 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: "id" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("Could not open browser-local library."));
    });
  }
  async function localGetAll() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE).objectStore(STORE).getAll();
      request.onsuccess = () => { db.close(); resolve(request.result); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
  async function localPut(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readwrite").objectStore(STORE).put(record);
      request.onsuccess = () => { db.close(); resolve(); };
      request.onerror = () => { db.close(); reject(request.error); };
    });
  }
  async function api(url, options = {}) {
    if (!token()) throw new Error("Enter the Kernelodies shared-library token to connect to shared storage.");
    const response = await fetch(url, {
      ...options,
      headers: { ...(options.headers || {}), "X-Kernelodies-Token": token() }
    });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || "Request failed (HTTP " + response.status + ")");
    return data;
  }
  function cleanupAudioUrls() {
    root.querySelectorAll("audio[data-blob-url]").forEach(audio => {
      URL.revokeObjectURL(audio.dataset.blobUrl);
      delete audio.dataset.blobUrl;
    });
  }
  function addPlayer(card, blob) {
    if (!(blob instanceof Blob)) return false;
    const audio = document.createElement("audio");
    audio.controls = true;
    audio.preload = "metadata";
    const url = URL.createObjectURL(blob);
    audio.dataset.blobUrl = url;
    audio.src = url;
    card.append(audio);
    return audio;
  }
  function renderTrack(track, mode) {
    const card = document.createElement("div");
    card.className = "track";
    const info = document.createElement("div");
    const heading = document.createElement("strong");
    heading.textContent = track.title || "Untitled track";
    const sub = document.createElement("span");
    sub.textContent = [track.artist, track.album].filter(Boolean).join(" · ") || (mode === "local" ? "Browser-local track" : "Apex library track");
    info.append(heading, sub);
    card.append(info);
    if (mode === "local") {
      if (!addPlayer(card, track.blob)) {
        const note = document.createElement("span");
        note.textContent = "Metadata only; the original audio file is not stored in this browser.";
        card.append(note);
      }
    } else if (track.audioUrl) {
      const play = document.createElement("button");
      play.textContent = "Load / Play";
      play.onclick = async () => {
        try {
          const response = await fetch(track.audioUrl, { headers: { "X-Apex-Control-Token": token() } });
          if (!response.ok) throw new Error("Audio request failed (HTTP " + response.status + ")");
          const blob = await response.blob();
          const audio = addPlayer(card, blob);
          if (!audio) throw new Error("Could not create audio player.");
          play.disabled = true;
          try { await audio.play(); }
          catch (_playError) { status("Audio loaded; use the audio controls to start playback."); }
        } catch (error) { status(error.message); }
      };
      card.append(play);
    } else {
      const note = document.createElement("span");
      note.textContent = "Metadata saved; audio not attached.";
      const attach = document.createElement("button");
      attach.textContent = "Attach / retry audio";
      const input = document.createElement("input");
      input.type = "file";
      input.accept = "audio/*";
      input.hidden = true;
      attach.onclick = () => input.click();
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        if (file.size > MAX_AUDIO_BYTES) return status("File exceeds the 50 MB limit.");
        const mimeType = resolveMime(file);
        if (!mimeType) return status("Unsupported audio type. Choose MP3, M4A, AAC, WAV, OGG, FLAC, or WebM.");
        try {
          status("Checking available shared storage…");
          await api("/api/kernelodies/library/capacity?bytes=" + encodeURIComponent(file.size));
          status("Attaching audio to the saved track…");
          await api("/api/kernelodies/library/" + track.id + "/audio", {
            method: "PUT",
            headers: { "Content-Type": mimeType },
            body: file
          });
          await refresh();
        } catch (error) { status(error.message); }
      };
      card.append(note, attach, input);
    }
    return card;
  }
  async function refresh() {
    cleanupAudioUrls();
    const list = $("kl-tracks");
    list.replaceChildren();
    try {
      if (!serverMode()) {
        const tracks = (await localGetAll()).sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
        for (const track of tracks) list.append(renderTrack(track, "local"));
        status("Browser-local · " + tracks.length + " records. Audio stays in this browser; metadata export does not include audio.");
        return;
      }
      const data = await api("/api/kernelodies/library");
      for (const track of data.tracks) list.append(renderTrack(track, "server"));
      status("Apex shared storage · " + data.tracks.length + " records.");
    } catch (error) { status(error.message); }
  }
  function resolveMime(file) {
    const extension = file.name.split(".").pop().toLowerCase();
    const detected = (file.type || "").toLowerCase();
    return allowedTypes.has(detected) ? detected : byExtension[extension];
  }
  $("kl-upload").onclick = async () => {
    const file = $("kl-file").files?.[0];
    if (!file) return status("Choose an audio file first.");
    if (file.size > MAX_AUDIO_BYTES) return status("File exceeds the 50 MB limit.");
    const mimeType = resolveMime(file);
    if (!mimeType) return status("Unsupported audio type. Choose MP3, M4A, AAC, WAV, OGG, FLAC, or WebM.");
    const title = $("kl-title").value.trim() || file.name.replace(/\.[^.]+$/, "");
    const artist = $("kl-artist").value.trim();
    const album = $("kl-album").value.trim();
    try {
      if (!serverMode()) {
        status("Saving audio to this browser…");
        await localPut({
          id: "local-" + crypto.randomUUID(),
          title, artist, album, duration: 0, blob: file, mimeType,
          importedAt: new Date().toISOString(),
          storageMode: "browser-local"
        });
        $("kl-file").value = "";
        await refresh();
        status("Saved locally. This audio has not been uploaded to shared Apex storage.");
        return;
      }
      status("Checking available shared storage…");
      await api("/api/kernelodies/library/capacity?bytes=" + encodeURIComponent(file.size));
      status("Saving track metadata…");
      const created = await api("/api/kernelodies/library", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, artist, album })
      });
      status("Uploading audio to persistent Apex storage…");
      await api("/api/kernelodies/library/" + created.track.id + "/audio", {
        method: "PUT",
        headers: { "Content-Type": mimeType },
        body: file
      });
      $("kl-file").value = "";
      await refresh();
    } catch (error) { status(error?.name === "QuotaExceededError" ? "Browser storage is full. Nothing was uploaded to Apex." : error.message); }
  };
  $("kl-mode").onchange = () => {
    const server = serverMode();
    $("kl-token-label").hidden = !server;
    $("kl-mode-note").textContent = server
      ? "Shared server storage requires the configured Apex control token. Access is protected; the token stays in page memory."
      : "Audio and metadata stay in this browser on this device. This mode needs no account or server token.";
    $("kl-upload").textContent = server ? "Save to Apex storage" : "Save to browser library";
    refresh();
  };
  $("kl-refresh").onclick = refresh;
  $("kl-export").onclick = async () => {
    if (serverMode()) return status("Metadata export is currently available only in browser-local mode.");
    try {
      const tracks = await localGetAll();
      const metadata = tracks.map(({ id, title, artist, album, duration, importedAt }) => ({ id, title, artist, album, duration, importedAt }));
      const url = URL.createObjectURL(new Blob([JSON.stringify(metadata, null, 2)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url; link.download = "kernelodies-metadata-only.json"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status("Metadata exported only. Audio bytes are not included in this JSON file.");
    } catch (error) { status(error.message); }
  };
  $("kl-import").onclick = () => {
    if (serverMode()) return status("Metadata import is currently available only in browser-local mode.");
    $("kl-json").click();
  };
  $("kl-json").onchange = async () => {
    const file = $("kl-json").files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data)) throw new Error("Metadata file must contain a list.");
      for (const item of data.slice(0, 1000)) {
        if (!item || typeof item !== "object" || Array.isArray(item)) continue;
        await localPut({
          id: "import-" + crypto.randomUUID(),
          title: String(item.title || "Imported track").slice(0, 200),
          artist: String(item.artist || "").slice(0, 200),
          album: String(item.album || "").slice(0, 200),
          duration: Math.max(0, Number(item.duration) || 0),
          blob: null,
          importedAt: new Date().toISOString(),
          storageMode: "metadata-only-import"
        });
      }
      $("kl-json").value = "";
      await refresh();
      status("Metadata imported. Audio files were not included in the JSON.");
    } catch (error) { status(error.message || "Invalid metadata file."); }
  };
  $("kl-mode").onchange();
})();