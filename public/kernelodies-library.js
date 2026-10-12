(() => {
  const root = document.getElementById("kernelodies-library");
  if (!root) return;
  root.innerHTML = `
    <h2>Independent Music Library</h2>
    <p>Track records use Apex sovereign Pure-WAL storage; audio bytes use the existing Apex projects volume. No SQL or paid storage service is introduced.</p>
    <p>Imports remain byte-for-byte unchanged. This player does not retune or certify 432 Hz; Jesus Freaks productions must meet the 432 Hz canon before release.</p>
    <label>APEX control token <input id="kl-token" type="password" autocomplete="off" placeholder="Control token"></label>
    <label>Track title <input id="kl-title" maxlength="200" placeholder="Track title"></label>
    <label>Artist <input id="kl-artist" maxlength="200" placeholder="Artist"></label>
    <label>Album <input id="kl-album" maxlength="200" placeholder="Album (optional)"></label>
    <label>Audio file <input id="kl-file" type="file" accept="audio/*"></label>
    <button id="kl-upload" type="button">Import to library</button>
    <button id="kl-refresh" type="button">Refresh library</button>
    <p id="kl-status" role="status">Not connected yet.</p>
    <div id="kl-tracks"></div>`;
  const $ = id => document.getElementById(id);
  const status = message => $("kl-status").textContent = message;
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
        const title = document.createElement("strong"); title.textContent = track.title;
        const artist = document.createElement("span"); artist.textContent = [track.artist, track.album].filter(Boolean).join(" · ");
        info.append(title, artist); card.append(info);
        if (track.audioUrl) {
          const play = document.createElement("button"); play.type = "button"; play.textContent = "Play";
          play.onclick = async () => {
            try {
              const response = await fetch(track.audioUrl, { headers: { "X-Apex-Control-Token": token() } });
              if (!response.ok) throw new Error("Playback request failed (HTTP " + response.status + ")");
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
          const note = document.createElement("span"); note.textContent = "Metadata saved; no audio attached yet."; card.append(note);
        }
        list.append(card);
      }
      status("Connected · " + data.tracks.length + " saved tracks · " + data.storage);
    } catch (error) { status(error.message); }
  }
  $("kl-upload").onclick = async () => {
    const file = $("kl-file").files?.[0];
    if (!file) return status("Choose an audio file first.");
    if (file.size > 50 * 1024 * 1024) return status("File exceeds the 50 MB limit.");
    const ext = file.name.split(".").pop().toLowerCase();
    const byExtension = { mp3: "audio/mpeg", m4a: "audio/mp4", aac: "audio/aac", wav: "audio/wav", ogg: "audio/ogg", flac: "audio/flac", webm: "audio/webm" };
    const allowed = new Set(Object.values(byExtension));
    const mimeType = allowed.has((file.type || "").toLowerCase()) ? file.type.toLowerCase() : byExtension[ext];
    if (!mimeType) return status("Unsupported format. Use MP3, M4A, AAC, WAV, OGG, FLAC, or WebM.");
    try {
      status("Writing track metadata to Pure-WAL…");
      const created = await api("/api/kernelodies/library", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: $("kl-title").value || file.name.replace(/\.[^.]+$/, ""), artist: $("kl-artist").value, album: $("kl-album").value })
      });
      status("Saving original audio bytes…");
      await api("/api/kernelodies/library/" + created.track.id + "/audio", { method: "PUT", headers: { "Content-Type": mimeType }, body: file });
      $("kl-file").value = ""; await refresh();
    } catch (error) { status(error.message); }
  };
  $("kl-refresh").onclick = refresh;
})();