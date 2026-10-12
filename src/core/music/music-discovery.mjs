const MAX_QUERY = 160;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 8000;
const ALLOWED_ENTITIES = new Set(["song", "album"]);

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= min && number <= max ? number : fallback;
}

function cleanText(value, max = 300) {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

function trustedHttpsUrl(raw, allowedHosts) {
  try {
    const url = new URL(String(raw || ""));
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!allowedHosts.some(allowed => host === allowed || host.endsWith("." + allowed))) return null;
    return url.href;
  } catch {
    return null;
  }
}

export async function discoverMusic(query, options = {}) {
  const q = String(query ?? "").normalize("NFKC").trim();
  if (q.length < 2) throw new RangeError("Enter at least two characters to search the music catalog.");
  if (q.length > MAX_QUERY) throw new RangeError("Music search query exceeds 160 characters.");

  const entity = String(options.entity || "song").toLowerCase();
  if (!ALLOWED_ENTITIES.has(entity)) throw new RangeError("Music search entity must be song or album.");
  const limit = boundedInt(options.limit, 20, 1, 25);
  const timeoutMs = boundedInt(options.timeoutMs, DEFAULT_TIMEOUT_MS, 1000, 15000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime.");

  const url = new URL("https://itunes.apple.com/search");
  url.searchParams.set("term", q);
  url.searchParams.set("media", "music");
  url.searchParams.set("entity", entity);
  url.searchParams.set("limit", String(limit));

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  let body;
  try {
    response = await fetchImpl(url.href, {
      headers: { accept: "application/json" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error("Music catalog returned HTTP " + response.status + ".");
    const declared = Number(response.headers?.get?.("content-length") || 0);
    if (declared > MAX_BODY_BYTES) throw new Error("Music catalog response exceeds the size limit.");
    body = await response.text();
    if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw new Error("Music catalog response exceeds the size limit.");
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Music catalog search timed out.");
    throw error;
  } finally {
    clearTimeout(timer);
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    throw new Error("Music catalog returned invalid JSON.");
  }
  const rawResults = Array.isArray(payload?.results) ? payload.results : [];
  const results = [];
  const seen = new Set();

  for (const item of rawResults) {
    const sourceId = String(entity === "album" ? item.collectionId ?? "" : item.trackId ?? "");
    if (!/^\d+$/.test(sourceId) || seen.has(sourceId)) continue;

    const title = cleanText(entity === "album" ? item.collectionName : item.trackName, 200);
    const artist = cleanText(item.artistName, 160);
    const trackUrl = trustedHttpsUrl(entity === "album" ? item.collectionViewUrl : item.trackViewUrl, ["music.apple.com", "itunes.apple.com"]);
    if (!title || !artist || !trackUrl) continue;

    const previewUrl = trustedHttpsUrl(item.previewUrl, ["audio-ssl.itunes.apple.com", "audio.itunes.apple.com"]);
    const artworkUrl = trustedHttpsUrl(item.artworkUrl100 || item.artworkUrl60, ["mzstatic.com"]);
    const durationMillis = Number(item.trackTimeMillis);
    results.push({
      source: "Apple iTunes Search API",
      sourceId,
      entity,
      title,
      artist,
      album: cleanText(item.collectionName, 200),
      genre: cleanText(item.primaryGenreName, 100),
      releaseDate: cleanText(item.releaseDate, 40),
      durationSeconds: Number.isFinite(durationMillis) && durationMillis > 0 ? Math.round(durationMillis / 1000) : null,
      trackUrl,
      previewUrl,
      artworkUrl,
      observedAt: new Date().toISOString()
    });
    seen.add(sourceId);
    if (results.length >= limit) break;
  }

  return {
    success: true,
    query: q,
    entity,
    source: "Apple iTunes Search API",
    results,
    checkedAt: new Date().toISOString()
  };
}
