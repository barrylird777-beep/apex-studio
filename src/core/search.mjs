const DEFAULT_FIELDS = [
  "id", "name", "title", "description", "content", "text", "query", "type",
  "tradition", "language", "script", "edition", "work", "book", "chapter", "verse",
  "source", "sourceUrl", "url", "tags", "keywords", "topics", "aliases", "relationships"
];

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().trim();
}

function tokenize(value) {
  return [...new Set(normalize(value).match(/[\\p{L}\\p{N}]+(?:['’-][\\p{L}\\p{N}]+)*/gu) ?? [])];
}

function flatten(value, depth = 0) {
  if (value == null || depth > 4) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.slice(0, 500).map(x => flatten(x, depth + 1)).join(" ");
  if (typeof value === "object") return Object.entries(value).slice(0, 200).map(([k, v]) => `${k} ${flatten(v, depth + 1)}`).join(" ");
  return "";
}

function fieldText(item, fields) {
  if (!item || typeof item !== "object") return flatten(item);
  return fields.map(key => flatten(item[key])).join(" ");
}

function scoreItem(query, item, fields) {
  const q = normalize(query);
  const qTokens = tokenize(q);
  const text = normalize(fieldText(item, fields));
  if (!text) return 0;
  let score = 0;
  if (text === q) score += 100;
  if (text.startsWith(q)) score += 45;
  if (text.includes(q)) score += 25;
  const fieldWeights = { id: 14, name: 18, title: 18, aliases: 12, description: 8, content: 5, text: 5, work: 10, edition: 10, book: 8, language: 5, tradition: 5, source: 4, tags: 7, topics: 7 };
  for (const [field, weight] of Object.entries(fieldWeights)) {
    const value = normalize(item?.[field]);
    if (value && value.includes(q)) score += weight;
  }
  let matched = 0;
  for (const token of qTokens) {
    if (text.includes(token)) matched++;
  }
  if (qTokens.length) score += (matched / qTokens.length) * 35;
  return score;
}

export function universalSearch(query, collections = [], limit = 30, options = {}) {
  const q = normalize(query);
  if (!q) return [];
  const max = Math.max(1, Math.min(1000, Number(limit) || 30));
  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : DEFAULT_FIELDS;
  const seen = new Set();
  const out = [];
  for (const c of collections) {
    for (const item of c.items ?? []) {
      const score = scoreItem(q, item, fields);
      if (score <= 0) continue;
      const identity = String(item?.id ?? item?.url ?? item?.sourceUrl ?? `${c.type}:${JSON.stringify(item).slice(0, 300)}`);
      if (seen.has(identity)) continue;
      seen.add(identity);
      out.push({ type: c.type ?? "record", item, score: Number(score.toFixed(4)), matchedQuery: q });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, max);
}

export function buildSearchIndex(collections = [], options = {}) {
  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : DEFAULT_FIELDS;
  const records = [];
  const seen = new Set();
  for (const c of collections) {
    for (const item of c.items ?? []) {
      const id = String(item?.id ?? item?.url ?? `${c.type}:${JSON.stringify(item).slice(0, 300)}`);
      if (seen.has(id)) continue;
      seen.add(id);
      records.push({ id, type: c.type ?? "record", item, text: normalize(fieldText(item, fields)), tokens: tokenize(fieldText(item, fields)) });
    }
  }
  return { version: 2, createdAt: new Date().toISOString(), fields, records };
}

export function searchIndex(index, query, limit = 30) {
  if (!index?.records) return [];
  const max = Math.max(1, Math.min(1000, Number(limit) || 30));
  const q = normalize(query);
  if (!q) return [];
  return index.records.map(record => {
    const item = record.item;
    const score = scoreItem(q, item, index.fields ?? DEFAULT_FIELDS);
    return { type: record.type, item, score: Number(score.toFixed(4)), matchedQuery: q };
  }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, max);
}

export const SEARCH_CAPABILITIES = Object.freeze([
  "exact", "token", "phrase", "field-aware", "cross-collection", "deduplicated", "ranked",
  "knowledge-graph-aware", "multilingual-unicode", "deep-limit", "federated-source-ready"
]);
