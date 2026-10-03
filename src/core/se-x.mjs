import { now, uid } from "./id.mjs";
import { detectOmniTrigger } from "./omni-risk.mjs";
import { cleanUntrustedText } from "./omni-sanitize.mjs";

const DEFAULT_CONCURRENCY = Math.max(1, Math.min(12, Number(process.env.APEX_SEX_CONCURRENCY ?? 4)));
const DEFAULT_TIMEOUT = Math.max(1000, Math.min(60000, Number(process.env.APEX_SEX_TIMEOUT_MS ?? 12000)));

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

async function fetchOne(url, { egress, signal }) {
  egress.check(url, { action: "se-x.fetch" });
  const response = await fetch(url, {
    signal,
    redirect: "follow",
    headers: { "user-agent": "APEX-SE-X/1.0" }
  });
  const contentType = response.headers.get("content-type") ?? "";
  const body = /^(text\/html|text\/plain|application\/json)/i.test(contentType)
    ? cleanUntrustedText(await response.text())
    : "";
  return {
    id: uid("result"),
    url,
    status: response.status,
    contentType,
    text: body,
    createdAt: now()
  };
}

export class SexEngine {
  constructor({ egress, store, events } = {}) {
    this.egress = egress;
    this.store = store;
    this.events = events;
    this.active = new Map();
  }

  async search(query, { sources = [], concurrency = DEFAULT_CONCURRENCY, timeout = DEFAULT_TIMEOUT, approved = false } = {}) {
    const raw = String(query ?? "");
    if (sources.length && !approved) throw new Error("Risk confirmation required before outbound retrieval.");
    const run = {
      id: uid("sex"),
      query: raw,
      mode: detectOmniTrigger(raw) ? "ELEVATED_REVIEW" : "STANDARD",
      fragments: fragments(raw),
      startedAt: now(),
      status: "running",
      results: []
    };
    this.active.set(run.id, run);
    this.events?.emit?.("sex.started", run);
    const urls = sources.map(s => typeof s === "string" ? s : s?.url).filter(Boolean);
    for (const fragment of run.fragments) {
      const results = await mapLimit(urls, concurrency, async url => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);
        try { return { fragment, ...(await fetchOne(url, { egress: this.egress, signal: controller.signal })) }; }
        finally { clearTimeout(timer); }
      });
      run.results.push(...results);
    }
    run.finishedAt = now();
    run.status = "complete";
    await this.store?.append?.("search_runs", run);
    for (const result of run.results) {
      if (!result.error) await this.store?.append?.("search_results", { runId: run.id, ...result });
    }
    this.events?.emit?.("sex.complete", run);
    return run;
  }
}
