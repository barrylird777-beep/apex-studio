import { EgressPolicy } from "./egress.mjs";

const timeoutMs = Math.max(1000, Math.min(60000, Number(process.env.APEX_WEB_SEARCH_TIMEOUT_MS || 15000)));
const maxResults = Math.max(1, Math.min(100, Number(process.env.APEX_WEB_SEARCH_MAX_RESULTS || 50)));
const egress = new EgressPolicy({ requireAllowlist: false, allowedHosts: [], allowedProtocols: ["https:"] });

function decode(value) {
  return String(value || "")
    .replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

function parseResults(html, limit) {
  const out = [];
  const seen = new Set();
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\\s\\S]*?)<\\/a>/gi;
  let match;
  while ((match = re.exec(html)) && out.length < limit) {
    let url = decode(match[1]);
    try {
      if (url.includes("uddg=")) url = decode(new URL(url, "https://duckduckgo.com").searchParams.get("uddg") || url);
      url = new URL(url, "https://duckduckgo.com").href;
    } catch { continue; }
    if (!/^https:\/\//i.test(url) || seen.has(url)) continue;
    const title = decode(match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim());
    seen.add(url);
    out.push({ title, url });
  }
  return out;
}

export async function searchAnything(query, { limit = maxResults } = {}) {
  const q = String(query || "").normalize("NFKC").trim();
  if (!q) throw new Error("Search query is required");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const endpoint = "https://html.duckduckgo.com/html/?q=" + encodeURIComponent(q);
  try {
    await egress.check(endpoint, { action: "apex.search", requireAllowlist: false, allowedProtocols: new Set(["https:"]) });
    const response = await fetch(endpoint, {
      signal: controller.signal,
      headers: { "user-agent": "APEX-SE-X/2.0", accept: "text/html" }
    });
    const html = await response.text();
    if (!response.ok) throw new Error("Search provider returned HTTP " + response.status);
    return {
      query: q,
      provider: "DuckDuckGo HTML",
      count: Math.min(Number(limit) || maxResults, maxResults),
      results: parseResults(html, Math.min(Number(limit) || maxResults, maxResults))
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchAnything(target, { maxBytes = 5 * 1024 * 1024 } = {}) {
  const url = new URL(String(target));
  if (!["https:"].includes(url.protocol)) throw new Error("Only HTTPS public web targets are supported");
  await egress.check(url.href, { action: "apex.search.fetch", requireAllowlist: false, allowedProtocols: new Set(["https:"]) });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url.href, { signal: controller.signal, redirect: "follow", headers: { "user-agent": "APEX-SE-X/2.0" } });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > maxBytes) throw new Error("Target response exceeds SE-X fetch size");
    return {
      url: response.url,
      status: response.status,
      contentType: response.headers.get("content-type") || "",
      text: /^(text\/|application\/json)/i.test(response.headers.get("content-type") || "") ? bytes.toString("utf8") : ""
    };
  } finally {
    clearTimeout(timer);
  }
}
