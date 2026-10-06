import dns from "node:dns/promises";
import net from "node:net";

const DEFAULT_TIMEOUT_MS = 12000;
const MAX_BYTES = 5 * 1024 * 1024;
const SEARCH_TIMEOUT_MS = 10000;

function isPrivateIpv4(ip) {
  const [a,b,c,d] = ip.split(".").map(Number);
  return a === 10 || a === 127 || (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)) ||
    a === 0;
}

function isPrivateIpv6(ip) {
  const value = ip.toLowerCase().split("%")[0];
  return value === "::1" || value === "::" || value.startsWith("fc") || value.startsWith("fd") ||
    value.startsWith("fe8") || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb");
}

function assertPublicAddress(address) {
  if (net.isIP(address) === 4 && isPrivateIpv4(address)) throw new Error("Blocked private IPv4 destination");
  if (net.isIP(address) === 6 && isPrivateIpv6(address)) throw new Error("Blocked private IPv6 destination");
}

async function assertPublicHostname(hostname) {
  if (!hostname || hostname === "localhost" || hostname.endsWith(".localhost") || hostname.endsWith(".local")) {
    throw new Error("Blocked local hostname");
  }
  if (net.isIP(hostname)) {
    assertPublicAddress(hostname);
    return;
  }
  const records = await dns.lookup(hostname, { all: true, verbatim: true });
  if (!records.length) throw new Error("Hostname has no public address");
  for (const record of records) assertPublicAddress(record.address);
}

function parseLimit(value, fallback = 50, max = 100) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(1, Math.min(max, Math.trunc(n))) : fallback;
}

async function readBodyLimited(response, maxBytes) {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw new Error("Remote response exceeds size limit");
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new Error("Remote response exceeds size limit");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

async function fetchPublic(url, { timeoutMs = DEFAULT_TIMEOUT_MS, maxBytes = MAX_BYTES, headers = {} } = {}) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS internet access is permitted");
  await assertPublicHostname(parsed.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(60000, Number(timeoutMs) || DEFAULT_TIMEOUT_MS)));
  try {
    const response = await fetch(parsed, {
      redirect: "manual",
      headers: { "user-agent": "Apex-Studio/1.0", accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.1", ...headers },
      signal: controller.signal
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Remote redirect ${response.status} without location`);
      const redirected = new URL(location, parsed);
      await assertPublicHostname(redirected.hostname);
      if (redirected.protocol !== "https:") throw new Error("Blocked non-HTTPS redirect");
      const next = await fetchPublic(redirected.href, { timeoutMs, maxBytes, headers });
      return { ...next, redirects: [parsed.href, ...(next.redirects || [])] };
    }
    const text = await readBodyLimited(response, maxBytes);
    return { status: response.status, ok: response.ok, url: parsed.href, contentType: response.headers.get("content-type") || "", text, redirects: [] };
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSearchResults(items, provider) {
  return items.map((item, index) => ({
    rank: index + 1,
    title: String(item.title || item.name || "").trim(),
    url: String(item.url || item.link || "").trim(),
    snippet: String(item.snippet || item.description || item.content || "").trim(),
    provider
  })).filter(item => item.title || item.url || item.snippet);
}

async function searchBrave(query, limit) {
  const key = process.env.BRAVE_SEARCH_API_KEY;
  if (!key) throw new Error("Brave Search not configured");
  const response = await fetchPublic(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${limit}`, {
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxBytes: 2 * 1024 * 1024,
    headers: { "x-subscription-token": key, accept: "application/json" }
  });
  if (!response.ok) throw new Error(`Brave Search HTTP ${response.status}`);
  const data = JSON.parse(response.text);
  return normalizeSearchResults(data.web?.results || [], "brave");
}

async function searchTavily(query, limit) {
  const key = process.env.TAVILY_API_KEY;
  if (!key) throw new Error("Tavily Search not configured");
  const response = await fetchPublic("https://api.tavily.com/search", {
    timeoutMs: SEARCH_TIMEOUT_MS,
    maxBytes: 2 * 1024 * 1024,
    headers: { "content-type": "application/json" }
  });
  if (!response.ok) throw new Error(`Tavily Search HTTP ${response.status}`);
  const data = JSON.parse(response.text);
  return normalizeSearchResults((data.results || []).slice(0, limit), "tavily");
}

export async function internetFetch(url, options = {}) {
  return fetchPublic(String(url), options);
}

export async function internetSearch(query, { limit = 10 } = {}) {
  const q = String(query || "").normalize("NFKC").trim();
  if (!q) throw new Error("Search query is required");
  const safeLimit = parseLimit(limit, 10, 20);
  const providers = [
    ["brave", searchBrave],
    ["tavily", searchTavily]
  ];
  const failures = [];
  for (const [name, fn] of providers) {
    try {
      const results = await fn(q, safeLimit);
      if (results.length) return { query: q, results, provider: name, failures };
    } catch (error) {
      failures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`No configured internet search provider succeeded: ${failures.join(" | ")}`);
}

export async function internetCapabilities() {
  return {
    fetch: true,
    httpsOnly: true,
    ssrfPrivateAddressProtection: true,
    searchProviders: {
      brave: Boolean(process.env.BRAVE_SEARCH_API_KEY),
      tavily: Boolean(process.env.TAVILY_API_KEY)
    },
    maxFetchBytes: MAX_BYTES,
    maxSearchResults: 20
  };
}
