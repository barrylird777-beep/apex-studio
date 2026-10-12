(() => {
  const root = document.getElementById("kernelodies-library");
  if (!root) return;
  root.innerHTML = `
    <h2>Persistent Library</h2>
    <p>Audio is saved to Apex server storage. Access is protected by your Apex control token; it is held in this page's memory only.</p>
    <label>Control token <input id="kl-token" type="password" autocomplete="off" placeholder="APEX_SHORTCUT_TOKEN"></label>
    <label>Track title <input id="kl-title" maxlength="200" placeholder="Track title"></label>
    <label>Artist <input id="kl-artist" maxlength="200" placeholder="Artist"></label>
    <label>Album <input id="kl-album" maxlength="200" placeholder="Album (optional)"></label>
    <label>Audio file <input id="kl-file" type="file" accept="audio/*"></label>
    <button id="kl-upload">Save to Apex storage</button>
    <button id="kl-refresh" type="button">Refresh library</button>
    <p id="kl-status" role="status">Not connected yet.</p>
    <div id="kl-tracks"></div>`;
  const $ = id => document.getElementById(id);
  const status = text => $("kl-status").textContent = text;
  const token = () => $("kl-token").value.trim();
  async function api(url, options = {}) {
    if (!token()) throw new Error("Enter the Apex control token to connect.");
    const response = await fetch(url, { ...options, headers: { ...(options.headers || {}), "X-Apex-Control-Token": token() } });
    const data = response.headers.get("content-type")?.includes("application/json") ? await response.json() : null;
    if (!response.ok) throw new Error(data?.error || "Request failed (HTTP " + response.status + ")");
    return data;
  }
  async function refresh() {
    try {
      const data = await api("/api/kernelodies/library");
      const list = $("kl-tracks");
      list.replaceChildren();
      for (const track of data.tracks) {
        const card = document.createElement("div"); card.className = "track";
        const info = document.createElement("div");
        const heading = document.createElement("strong"); heading.textContent = track.title;
        const sub = document.createElement("span"); sub.textContent = [track.artist, track.album].filter(Boolean).join(" · ");
        info.append(heading, sub);
        card.append(info);
        if (track.audioUrl) {
          const play = document.createElement("button"); play.textContent = "Load / Play";
          play.onclick = async () => {
            try {
              const response = await fetch(track.audioUrl, { headers: { "X-Apex-Control-Token": token() } });
              if (!response.ok) throw new Error("Audio request failed (HTTP " + response.status + ")");
              const blob = await response.blob();
              const url = URL.createObjectURL(blob);
              let audio = card.querySelector("audio");
              if (!audio) { audio = document.createElement("audio"); audio.controls = true; card.append(audio); }
              if (audio.dataset.blobUrl) URL.revokeObjectURL(audio.dataset.blobUrl);
              audio.dataset.blobUrl = url; audio.src = url; await audio.play();
            } catch (error) { status(error.message); }
          };
          card.append(play);
        } else {
          const pending = document.createElement("span"); pending.textContent = "Metadata saved; audio not attached"; card.append(pending);
        }
        list.append(card);
      }
      status("Connected · " + data.tracks.length + " saved tracks.");
    } catch (error) { status(error.message); }
  }
  $("kl-upload").onclick = async () => {
    const file = $("kl-file").files?.[0];
    if (!file) return status("Choose an audio file first.");
    if (file.size > 50 * 1024 * 1024) return status("File exceeds the 50 MB limit.");
    try {
      status("Saving track metadata…");
      const created = await api("/api/kernelodies/library", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: $("kl-title").value || file.name.replace(/\.[^.]+$/, ""), artist: $("kl-artist").value, album: $("kl-album").value }) });
      status("Uploading audio to persistent storage…");
      await api("/api/kernelodies/library/" + created.track.id + "/audio", { method: "PUT", headers: { "Content-Type": file.type || "application/octet-stream" }, body: file });
      $("kl-file").value = ""; await refresh();
    } catch (error) { status(error.message); }
  };
  $("kl-refresh").onclick = refresh;
})();