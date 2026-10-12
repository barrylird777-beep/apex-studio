(() => {
  const $ = id => document.getElementById(id);
  const tokenKey = "apex.phone.sessionToken";
  let saved = [];

  function headers(withJson = false) {
    const token = sessionStorage.getItem(tokenKey) || "";
    if (!token) throw new Error("Open Phone Control in this tab and enter your control token first.");
    return { "x-apex-shortcut-token": token, ...(withJson ? { "content-type": "application/json" } : {}) };
  }

  async function api(path, options = {}) {
    const response = await fetch(path, {
      ...options,
      headers: { ...headers(Boolean(options.body)), ...(options.headers || {}) }
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || ("HTTP " + response.status));
    return data;
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined && text !== null) node.textContent = String(text);
    if (className) node.className = className;
    return node;
  }

  function renderDiscoveries(target, items, canSave) {
    target.replaceChildren();
    if (!items.length) {
      target.append(element("p", "No discoveries yet.", "kl-track-meta"));
      return;
    }
    for (const item of items) {
      const card = element("div", null, "track");
      if (item.artworkUrl) {
        const image = element("img");
        image.src = item.artworkUrl;
        image.alt = "";
        image.loading = "lazy";
        image.width = 88;
        image.height = 88;
        image.style.borderRadius = "10px";
        card.append(image);
      }
      const body = element("div");
      body.style.minWidth = "0";
      const title = element("strong", item.title || "Untitled");
      const artist = element("span", [item.artist, item.album].filter(Boolean).join(" · "));
      const meta = element("span", [item.genre, item.releaseDate ? String(item.releaseDate).slice(0, 10) : "", item.source || "Apple iTunes Search API"].filter(Boolean).join(" · "), "kl-track-meta");
      body.append(title, artist, meta);
      if (item.previewUrl) {
        const audio = element("audio");
        audio.controls = true;
        audio.preload = "none";
        audio.src = item.previewUrl;
        audio.style.display = "block";
        audio.style.width = "100%";
        audio.style.marginTop = "8px";
        body.append(audio);
      }
      if (item.trackUrl) {
        const link = element("a", "Open catalog page ↗");
        link.href = item.trackUrl;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.style.display = "inline-block";
        link.style.marginTop = "8px";
        body.append(link);
      }
      if (canSave) {
        const button = element("button", "Save discovery");
        button.type = "button";
        button.style.marginTop = "8px";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const response = await api("/api/kernelodies/discovery/saved", { method: "POST", body: JSON.stringify(item) });
            $("kd-status").textContent = response.duplicate ? "Already saved in Kernelodies." : "Discovery saved to the Kernelodies Pure-WAL namespace.";
            await refreshSaved();
          } catch (error) {
            $("kd-status").textContent = error.message;
          } finally {
            button.disabled = false;
          }
        });
        body.append(button);
      }
      card.append(body);
      target.append(card);
    }
  }

  async function search() {
    const query = $("kd-query").value.trim();
    if (query.length < 2) {
      $("kd-status").textContent = "Enter at least two characters.";
      return;
    }
    const button = $("kd-search");
    button.disabled = true;
    $("kd-status").textContent = "Searching the public music catalog…";
    try {
      const params = new URLSearchParams({ q: query, entity: $("kd-entity").value, limit: "20" });
      const data = await api("/api/kernelodies/discovery/search?" + params.toString());
      renderDiscoveries($("kd-results"), Array.isArray(data.results) ? data.results : [], true);
      $("kd-status").textContent = data.results.length + " results from " + data.source + ". Save discoveries to create a durable local playlist.";
    } catch (error) {
      $("kd-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  async function refreshSaved() {
    try {
      const data = await api("/api/kernelodies/discovery/saved");
      saved = Array.isArray(data.discoveries) ? data.discoveries : [];
      renderDiscoveries($("kd-saved"), saved, false);
      $("kd-status").textContent = saved.length + " saved discoveries in Kernelodies Pure-WAL.";
    } catch (error) {
      $("kd-status").textContent = error.message;
    }
  }

  async function refreshPlaylists() {
    try {
      const data = await api("/api/kernelodies/discovery/playlists");
      const root = $("kd-playlists");
      root.replaceChildren();
      const playlists = Array.isArray(data.playlists) ? data.playlists : [];
      if (!playlists.length) root.append(element("p", "No saved playlists yet.", "kl-track-meta"));
      for (const playlist of playlists) {
        const card = element("div", null, "track");
        const body = element("div");
        const title = element("strong", playlist.title || "Untitled playlist");
        const meta = element("span", (playlist.tracks || []).length + " tracks · saved locally");
        body.append(title, meta);
        for (const track of (playlist.tracks || [])) {
          body.append(element("div", (track.title || "Untitled") + " — " + (track.artist || "Unknown artist"), "kl-track-meta"));
        }
        card.append(body);
        root.append(card);
      }
    } catch (error) {
      $("kd-playlists").replaceChildren(element("p", error.message, "kl-track-meta"));
    }
  }

  async function buildPlaylist() {
    const title = $("kd-playlist-title").value.trim() || "Radar Mix";
    if (!saved.length) {
      $("kd-status").textContent = "Save at least one discovery before building a playlist.";
      return;
    }
    const button = $("kd-build-playlist");
    button.disabled = true;
    try {
      const data = await api("/api/kernelodies/discovery/playlists", {
        method: "POST",
        body: JSON.stringify({ title, discoveryIds: saved.map(item => item.discoveryId) })
      });
      $("kd-status").textContent = "Playlist saved: " + data.playlist.title + " (" + data.playlist.tracks.length + " tracks).";
      await refreshPlaylists();
    } catch (error) {
      $("kd-status").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  $("kd-search").addEventListener("click", search);
  $("kd-query").addEventListener("keydown", event => { if (event.key === "Enter") search(); });
  $("kd-refresh-saved").addEventListener("click", async () => { await refreshSaved(); await refreshPlaylists(); });
  $("kd-build-playlist").addEventListener("click", buildPlaylist);
  refreshSaved();
  refreshPlaylists();
})();