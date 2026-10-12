import { createHash } from "node:crypto";

const MAX_QUERY = 512;
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const PROVIDER_TIMEOUT_MS = 12000;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const MAX_PAGE = 100;

function cleanText(value) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;/gi, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function boundedInt(value, fallback, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(number)));
}

async function readLimitedText(response, maxBytes = MAX_BODY_BYTES) {
  const declared = Number(response.headers?.get?.("content-length") || 0);
  if (declared > maxBytes) throw new Error("provider response exceeds the size limit");
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text) > maxBytes) throw new Error("provider response exceeds the size limit");
    return text;
  }
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => {});
        throw new Error("provider response exceeds the size limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock?.();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function requestText(url, { fetchImpl, timeoutMs, maxBytes = MAX_BODY_BYTES, accept = "application/json, text/html, application/atom+xml" }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      signal: controller.signal,
      headers: { "user-agent": "PlanetApeX-SE-X/1.0", accept }
    });
    if (!response.ok) throw new Error("provider HTTP " + response.status);
    return await readLimitedText(response, maxBytes);
  } catch (error) {
    if (controller.signal.aborted) throw new Error("provider timed out");
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function publicHttpsUrl(raw, base) {
  try {
    const url = new URL(String(raw || ""), base);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    const host = url.hostname.toLowerCase();
    if (!host || host === "localhost" || host.endsWith(".local") || host.endsWith(".internal") ||
        host === "127.0.0.1" || host === "::1" || host === "[::1]" ||
        /^10\./.test(host) || /^192\.168\./.test(host) ||
        /^169\.254\./.test(host) || /^172\.(1[6-9]|2\d|3[01])\./.test(host)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function parseDuckDuckGo(html, limit) {
  const results = [];
  const seen = new Set();
  const anchor = /<a\b[^>]*class=["'][^"']*result__a[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = anchor.exec(html)) && results.length < limit) {
    let rawUrl = cleanText(match[1]).replace(/&amp;/g, "&");
    try {
      const parsed = new URL(rawUrl, "https://html.duckduckgo.com");
      if (parsed.hostname.endsWith("duckduckgo.com") && parsed.pathname.startsWith("/l/")) {
        rawUrl = parsed.searchParams.get("uddg") || "";
      }
    } catch {}
    const url = publicHttpsUrl(rawUrl);
    const title = cleanText(match[2]);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    const region = html.slice(Math.max(0, match.index - 350), Math.min(html.length, anchor.lastIndex + 1400));
    const snippetMatch = region.match(/class=["'][^"']*result__snippet[^"']*["'][^>]*>([\s\S]*?)<\/(?:div|span|a)>/i);
    results.push({ title, url, snippet: cleanText(snippetMatch?.[1] || ""), source: "DuckDuckGo", category: "web" });
  }
  return results;
}

async function searchWeb(query, { fetchImpl, timeoutMs, limit, page }) {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);
  url.searchParams.set("s", String((page - 1) * 30));
  url.searchParams.set("kl", "us-en");
  const html = await requestText(url.href, { fetchImpl, timeoutMs, accept: "text/html" });
  return parseDuckDuckGo(html, limit);
}

async function searchWikipedia(query, { fetchImpl, timeoutMs, limit, page }) {
  const url = new URL("https://en.wikipedia.org/w/api.php");
  url.searchParams.set("action", "query");
  url.searchParams.set("list", "search");
  url.searchParams.set("srsearch", query);
  url.searchParams.set("srlimit", String(limit));
  url.searchParams.set("sroffset", String((page - 1) * limit));
  url.searchParams.set("format", "json");
  url.searchParams.set("utf8", "1");
  const data = JSON.parse(await requestText(url.href, { fetchImpl, timeoutMs }));
  return (data.query?.search || []).map(item => ({
    title: cleanText(item.title),
    url: "https://en.wikipedia.org/?curid=" + encodeURIComponent(item.pageid),
    snippet: cleanText(item.snippet),
    source: "Wikipedia",
    category: "encyclopedia"
  })).filter(item => item.title && item.url);
}

async function searchOpenAlex(query, { fetchImpl, timeoutMs, limit, page }) {
  const url = new URL("https://api.openalex.org/works");
  url.searchParams.set("search", query);
  url.searchParams.set("per-page", String(limit));
  url.searchParams.set("page", String(page));
  const data = JSON.parse(await requestText(url.href, { fetchImpl, timeoutMs }));
  return (data.results || []).map(item => ({
    title: cleanText(item.display_name),
    url: publicHttpsUrl(item.primary_location?.landing_page_url) ||
      publicHttpsUrl(item.doi) || publicHttpsUrl(item.id),
    snippet: cleanText(item.authorships?.slice(0, 4).map(author => author.author?.display_name).filter(Boolean).join(", ")),
    source: "OpenAlex",
    category: "research",
    published: item.publication_year ? String(item.publication_year) : null
  })).filter(item => item.title && item.url);
}

async function searchCrossref(query, { fetchImpl, timeoutMs, limit, page }) {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query.bibliographic", query);
  url.searchParams.set("rows", String(limit));
  url.searchParams.set("offset", String((page - 1) * limit));
  const data = JSON.parse(await requestText(url.href, { fetchImpl, timeoutMs }));
  return (data.message?.items || []).map(item => {
    const published = item.published?.["date-parts"]?.[0]?.join("-") || null;
    const doiUrl = item.DOI ? "https://doi.org/" + encodeURIComponent(item.DOI) : null;
    return {
      title: cleanText(item.title?.[0]),
      url: publicHttpsUrl(item.URL) || publicHttpsUrl(doiUrl),
      snippet: cleanText(item.author?.slice(0, 4).map(author => [author.given, author.family].filter(Boolean).join(" ")).join(", ")),
      source: "Crossref",
      category: "research",
      published
    };
  }).filter(item => item.title && item.url);
}

async function searchArxiv(query, { fetchImpl, timeoutMs, limit, page }) {
  const url = new URL("https://export.arxiv.org/api/query");
  url.searchParams.set("search_query", "all:" + query);
  url.searchParams.set("start", String((page - 1) * limit));
  url.searchParams.set("max_results", String(limit));
  const xml = await requestText(url.href, { fetchImpl, timeoutMs, accept: "application/atom+xml, application/xml, text/xml" });
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/gi)].map(match => match[1]);
  return entries.map(entry => {
    const field = name => cleanText(entry.match(new RegExp("<" + name + "[^>]*>([\\s\\S]*?)</" + name + ">", "i"))?.[1]);
    const rawId = field("id").replace(/^http:\/\//i, "https://");
    return {
      title: field("title"),
      url: publicHttpsUrl(rawId),
      snippet: field("summary"),
      source: "arXiv",
      category: "research",
      published: field("published") || null
    };
  }).filter(item => item.title && item.url);
}

export async function searchAnything(query, options = {}) {
  const q = String(query ?? "").normalize("NFKC").trim();
  if (!q) throw new TypeError("Search query is required.");
  if (q.length > MAX_QUERY) throw new RangeError("Search query exceeds 512 characters.");
  const limit = boundedInt(options.limit, DEFAULT_LIMIT, 1, MAX_LIMIT);
  const page = boundedInt(options.page, 1, 1, MAX_PAGE);
  const timeoutMs = boundedInt(options.timeoutMs, PROVIDER_TIMEOUT_MS, 1000, 20000);
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable in this runtime.");
  const perSourceLimit = Math.max(1, Math.min(25, Math.ceil(limit / 5)));
  const params = { fetchImpl, timeoutMs, limit: perSourceLimit, page };
  const providers = [
    ["DuckDuckGo", () => searchWeb(q, params)],
    ["Wikipedia", () => searchWikipedia(q, params)],
    ["OpenAlex", () => searchOpenAlex(q, params)],
    ["Crossref", () => searchCrossref(q, params)],
    ["arXiv", () => searchArxiv(q, params)]
  ];
  const settled = await Promise.allSettled(providers.map(([, run]) => run()));
  const providerStatus = [];
  const collected = [];
  for (let i = 0; i < settled.length; i += 1) {
    const item = settled[i];
    if (item.status === "fulfilled") {
      providerStatus.push({ source: providers[i][0], ok: true, resultCount: item.value.length });
      collected.push(...item.value);
    } else {
      providerStatus.push({ source: providers[i][0], ok: false, error: String(item.reason?.message || item.reason || "provider failed").slice(0, 180) });
    }
  }
  const seen = new Set();
  const results = [];
  for (const result of collected) {
    const key = result.url.toLowerCase().replace(/#.*$/, "");
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({ ...result, retrievedAt: new Date().toISOString() });
    if (results.length >= limit) break;
  }
  const ok = providerStatus.some(provider => provider.ok);
  return {
    success: ok,
    query: q,
    page,
    limit,
    partial: providerStatus.some(provider => !provider.ok),
    providers: providerStatus,
    resultCount: results.length,
    results,
    requestHash: createHash("sha256").update(q).digest("hex"),
    retrievedAt: new Date().toISOString()
  };
}
