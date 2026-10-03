import express from "express";
import cors from "cors";
import dns from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = Number(process.env.PORT || 3010);
const HOST = process.env.APEX_BIND_HOST || "0.0.0.0";

app.disable("x-powered-by");
app.use(cors());
app.use(express.json({ limit: "10mb", strict: true }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));
app.use(express.static(path.join(__dirname, "public")));

const PROVIDERS = Object.freeze({
  groq: {
    name: "groq",
    key: "GROQ_API_KEY",
    url: "https://api.groq.com/openai/v1/chat/completions",
    model: process.env.GROQ_MODEL || "llama-3.3-70b-versatile"
  },
  openrouter: {
    name: "openrouter",
    key: "OPENROUTER_API_KEY",
    url: "https://openrouter.ai/api/v1/chat/completions",
    model: process.env.OPENROUTER_MODEL || "meta-llama/llama-3.3-70b-instruct:free"
  },
  pollinations: {
    name: "pollinations",
    url: "https://text.pollinations.ai/",
    model: process.env.POLLINATIONS_TEXT_MODEL || "openai"
  }
});

const textOf = value => String(value ?? "").trim();

function jsonError(res, status, message, extra = {}) {
  return res.status(status).json({ success: false, error: message, ...extra });
}

async function fetchJson(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const bodyText = await response.text();
    let body;
    try { body = JSON.parse(bodyText); } catch { body = { text: bodyText }; }
    if (!response.ok) {
      const message = body?.error?.message || body?.error || body?.message || `HTTP ${response.status}`;
      throw new Error(String(message));
    }
    return body;
  } finally {
    clearTimeout(timer);
  }
}

async function callGroq(prompt) {
  const key = textOf(process.env.GROQ_API_KEY);
  if (!key) throw new Error("GROQ_API_KEY is not configured");
  const body = await fetchJson(PROVIDERS.groq.url, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: PROVIDERS.groq.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    })
  });
  return { text: textOf(body?.choices?.[0]?.message?.content), provider: "groq", model: PROVIDERS.groq.model };
}

async function callOpenRouter(prompt) {
  const key = textOf(process.env.OPENROUTER_API_KEY);
  if (!key) throw new Error("OPENROUTER_API_KEY is not configured");
  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${key}`
  };
  if (process.env.OPENROUTER_SITE_URL) headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
  if (process.env.OPENROUTER_APP_NAME) headers["X-Title"] = process.env.OPENROUTER_APP_NAME;
  const body = await fetchJson(PROVIDERS.openrouter.url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: PROVIDERS.openrouter.model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7
    })
  });
  return { text: textOf(body?.choices?.[0]?.message?.content), provider: "openrouter", model: PROVIDERS.openrouter.model };
}

async function callPollinations(prompt) {
  const url = new URL(PROVIDERS.pollinations.url);
  url.searchParams.set("model", PROVIDERS.pollinations.model);
  url.searchParams.set("prompt", prompt);
  const response = await fetch(url, { headers: { accept: "text/plain" } });
  const text = await response.text();
  if (!response.ok) throw new Error(`Pollinations HTTP ${response.status}`);
  return { text: textOf(text), provider: "pollinations", model: PROVIDERS.pollinations.model };
}

async function executeInference(prompt) {
  const failures = [];
  for (const provider of [callGroq, callOpenRouter, callPollinations]) {
    try {
      const result = await provider(prompt);
      if (result.text) return { ...result, failures };
      failures.push("provider returned empty text");
    } catch (error) {
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  throw new Error(`All inference providers failed: ${failures.join(" | ")}`);
}

function cinematicPrompt(prompt) {
  return [
    "Create a cinematic, production-ready image.",
    "Use strong composition, coherent lighting, realistic materials, detailed environment, and clear subject separation.",
    "Preserve the user's intent without adding unrelated subjects.",
    textOf(prompt)
  ].filter(Boolean).join(" ");
}

app.get("/health", (req, res) => res.json({ ok: true, studio: "Apex Studio" }));
app.get("/api/health", (req, res) => res.json({ ok: true, studio: "Apex Studio", mesh: true }));

app.get("/api/mesh/status", (req, res) => {
  res.json({
    success: true,
    providers: {
      groq: { configured: Boolean(textOf(process.env.GROQ_API_KEY)), model: PROVIDERS.groq.model },
      openrouter: { configured: Boolean(textOf(process.env.OPENROUTER_API_KEY)), model: PROVIDERS.openrouter.model },
      pollinations: { configured: true, model: PROVIDERS.pollinations.model }
    },
    order: ["groq", "openrouter", "pollinations"]
  });
});

app.post("/api/oracle", async (req, res) => {
  const prompt = textOf(req.body?.prompt ?? req.body?.message ?? req.body?.input);
  if (!prompt) return jsonError(res, 400, "prompt is required");
  try {
    const result = await executeInference(prompt);
    return res.json({ success: true, text: result.text, provider: result.provider, model: result.model, mesh: true });
  } catch (error) {
    return jsonError(res, 502, error instanceof Error ? error.message : String(error));
  }
});

app.post("/api/forge", async (req, res) => {
  const prompt = textOf(req.body?.prompt ?? req.body?.description ?? req.body?.input);
  if (!prompt) return jsonError(res, 400, "prompt is required");
  const enhanced = cinematicPrompt(prompt);
  const seed = crypto.createHash("sha256").update(enhanced).digest("hex").slice(0, 16);
  const image = new URL("https://image.pollinations.ai/prompt/" + encodeURIComponent(enhanced));
  image.searchParams.set("model", process.env.POLLINATIONS_IMAGE_MODEL || "flux");
  image.searchParams.set("seed", seed);
  image.searchParams.set("nologo", "true");
  return res.json({
    success: true,
    prompt,
    cinematicPrompt: enhanced,
    imageUrl: image.toString(),
    provider: "pollinations",
    seed
  });
});

const MAX_PAGES = Math.min(Math.max(Number(process.env.CRAWLER_MAX_PAGES || 12), 1), 50);
const MAX_DEPTH = Math.min(Math.max(Number(process.env.CRAWLER_MAX_DEPTH || 2), 0), 5);
const MAX_BYTES = Math.min(Math.max(Number(process.env.CRAWLER_MAX_BYTES || 2000000), 10000), 10000000);
const TIMEOUT_MS = Math.min(Math.max(Number(process.env.CRAWLER_TIMEOUT_MS || 10000), 1000), 30000);

function isPrivateIp(ip) {
  if (!net.isIP(ip)) return true;
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || a === 169 && b === 254 ||
      a === 192 && b === 168 || a === 172 && b >= 16 && b <= 31;
  }
  const normalized = ip.toLowerCase();
  return normalized === "::1" || normalized.startsWith("fc") ||
    normalized.startsWith("fd") || normalized.startsWith("fe80:");
}

async function validatePublicHost(hostname) {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error("Local hostnames are not crawlable");
  }
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(entry => isPrivateIp(entry.address))) {
    throw new Error("Private or local destination rejected");
  }
  return true;
}

function sameHost(a, b) {
  return a.hostname.toLowerCase() === b.hostname.toLowerCase();
}

async function fetchPage(url) {
  await validatePublicHost(url.hostname);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "manual",
      headers: {
        "user-agent": process.env.CRAWLER_USER_AGENT || "ApexStudioCrawler/1.0",
        accept: "text/html,application/xhtml+xml"
      }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error(`Redirect ${response.status} without location`);
      const next = new URL(location, url);
      if (!["http:", "https:"].includes(next.protocol) || !sameHost(url, next)) {
        throw new Error("Cross-host or unsupported redirect rejected");
      }
      return fetchPage(next);
    }
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const type = response.headers.get("content-type") || "";
    if (!type.includes("text/html") && !type.includes("text/plain")) {
      return { url: url.toString(), status: response.status, contentType: type, text: "", links: [] };
    }
    const reader = response.body?.getReader();
    if (!reader) return { url: url.toString(), status: response.status, contentType: type, text: "", links: [] };
    const chunks = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(Buffer.from(value));
    }
    const text = Buffer.concat(chunks).toString("utf8");
    const links = [...text.matchAll(/<a[^>]+href=["']([^"']+)["']/gi)]
      .map(match => match[1])
      .filter(Boolean);
    return { url: url.toString(), status: response.status, contentType: type, text, links };
  } finally {
    clearTimeout(timer);
  }
}

async function crawl(startUrl) {
  const root = new URL(startUrl);
  if (!["http:", "https:"].includes(root.protocol)) throw new Error("Only HTTP(S) URLs are allowed");
  await validatePublicHost(root.hostname);
  const queue = [{ url: root, depth: 0 }];
  const visited = new Set();
  const pages = [];
  const errors = [];

  while (queue.length && pages.length < MAX_PAGES) {
    const item = queue.shift();
    const key = item.url.toString();
    if (visited.has(key)) continue;
    visited.add(key);
    try {
      const page = await fetchPage(item.url);
      pages.push({
        url: page.url,
        status: page.status,
        contentType: page.contentType,
        bytes: Buffer.byteLength(page.text),
        text: page.text.slice(0, MAX_BYTES)
      });
      if (item.depth < MAX_DEPTH) {
        for (const href of page.links) {
          if (queue.length + pages.length >= MAX_PAGES) break;
          try {
            const next = new URL(href, item.url);
            if (["http:", "https:"].includes(next.protocol) && sameHost(root, next) && !visited.has(next.toString())) {
              queue.push({ url: next, depth: item.depth + 1 });
            }
          } catch {}
        }
      }
    } catch (error) {
      errors.push({ url: key, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { startUrl: root.toString(), pages, errors, limits: { maxPages: MAX_PAGES, maxDepth: MAX_DEPTH, maxBytes: MAX_BYTES } };
}

app.post("/api/crawler", async (req, res) => {
  const target = textOf(req.body?.url);
  if (!target) return jsonError(res, 400, "url is required");
  try {
    const result = await crawl(target);
    return res.json({ success: true, ...result });
  } catch (error) {
    return jsonError(res, 400, error instanceof Error ? error.message : String(error));
  }
});

app.post("/api/crawl", async (req, res) => {
  const target = textOf(req.body?.url);
  if (!target) return jsonError(res, 400, "url is required");
  try {
    const result = await crawl(target);
    return res.json({ success: true, ...result });
  } catch (error) {
    return jsonError(res, 400, error instanceof Error ? error.message : String(error));
  }
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

app.use((error, req, res, next) => {
  console.error(error);
  if (res.headersSent) return next(error);
  return jsonError(res, 500, "Internal server error");
});

app.listen(PORT, HOST, () => {
  console.log(`Apex Studio online on ${HOST}:${PORT}`);
});
