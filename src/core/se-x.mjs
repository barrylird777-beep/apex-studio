import { now, uid } from "./id.mjs";
import { cleanUntrustedText } from "./omni-sanitize.mjs";

const DEFAULT_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.APEX_SEX_CONCURRENCY ?? 4)));
const DEFAULT_TIMEOUT = Math.max(1000, Math.min(60000, Number(process.env.APEX_SEX_TIMEOUT_MS ?? 12000)));
const MAX_RESPONSE_BYTES = Math.max(64 * 1024, Math.min(
  10 * 1024 * 1024,
  Number(process.env.APEX_SEX_MAX_RESPONSE_BYTES ?? 2 * 1024 * 1024)
));

function fragments(query) {
  const raw = String(query ?? "");
  return [...new Set(raw.split(/\s+(?:OR|AND)\s+|[;,]+/i).map(s => s.trim()).filter(Boolean))].slice(0, 32);
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      try { out[i] = await fn(items[i], i); }
      catch (error) { out[i] = { error: String(error.message ?? error) }; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, Math.max(1, items.length)) }, worker));
  return out;
}

async function readLimitedText(response, maxBytes) {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (declared > maxBytes) throw new Error("SE-X response exceeds configured size limit");

  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error("SE-X response exceeds configured size limit");
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

async function fetchOne(url, { egress, signal }) {
  let current = String(url);

  for (let hop = 0; hop <= 3; hop++) {
    await egress.check(current, {
      action: "se-x.fetch",
      requireAllowlist: true,
      allowedProtocols: new Set(["https:"])
    });

    const response = await fetch(current, {
      method: "GET",
      signal,
      redirect: "manual",
      headers: {
        "user-agent": "APEX-SE-X/1.0",
        "accept": "text/html, text/plain, application/json"
      }
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without location");
      current = new URL(location, current).href;
      continue;
    }

    const contentType = response.headers.get("content-type") ?? "";
    const body = /^(text\/html|text\/plain|application\/json)(?:;|$)/i.test(contentType)
      ? cleanUntrustedText(await readLimitedText(response, MAX_RESPONSE_BYTES))
      : "";

    return {
      id: uid("result"),
      url: current,
      status: response.status,
      contentType,
      text: body,
      createdAt: now()
    };
  }

  throw new Error("Redirect limit exceeded");
}

export class SexEngine {
  constructor({ egress, store, events, concurrency = DEFAULT_CONCURRENCY, timeoutMs = DEFAULT_TIMEOUT } = {}) {
    if (!egress) throw new Error("SE-X requires an egress policy");
    this.egress = egress;
    this.store = store;
    this.events = events;
    this.concurrency = concurrency;
    this.timeoutMs = timeoutMs;
  }

  async search(query, { sources = [], approved = false } = {}) {
    const startedAt = now();
    const run = {
      id: uid("search"),
      query: String(query ?? ""),
      mode: "STANDARD",
      startedAt,
      status: "running",
      fragments: fragments(query),
      sources: [...new Set(sources.map(String))]
    };

    this.events?.emit?.("sex.started", run);

    if (run.sources.length && !approved) {
      throw new Error("Approved risk handshake required before outbound retrieval.");
    }

    const results = await mapLimit(run.sources, this.concurrency, async source => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        return await fetchOne(source, { egress: this.egress, signal: controller.signal });
      } finally {
        clearTimeout(timer);
      }
    });

    run.results = results;
    run.finishedAt = now();
    run.status = "complete";
    await this.store?.append?.("search_runs", run);

    for (const result of results) {
      if (!result?.error) {
        await this.store?.append?.("search_results", { ...result, runId: run.id });
      }
    }

    this.events?.emit?.("sex.complete", run);
    return run;
  }
}
