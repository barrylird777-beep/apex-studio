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
  let current = String(url);
  for (let hop = 0; hop <= 3; hop++) {
    egress.check(current, { action: "se-x.fetch" });
    const response = await fetch(current, {
      signal,
      redirect: "manual",
      headers: { "user-agent": "APEX-SE-X/1.0" }
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("Redirect without location");
      current = new URL(location, current).href;
      continue;
    }
    const contentType = response.headers.get("content-type") ?? "";
    const body = /^(text\\/html|text\\/plain|application\\/json)/i.test(contentType)
      ? cleanUntrustedText(await response.text())
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
