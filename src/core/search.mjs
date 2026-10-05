const DEFAULT_FIELDS = [
  "id", "name", "title", "description", "content", "text", "query", "type",
  "tradition", "language", "script", "edition", "work", "book", "chapter", "verse",
  "source", "sourceUrl", "url", "tags", "keywords", "topics", "aliases", "relationships"
];

const FIELD_WEIGHTS = Object.freeze({
  id: 14, name: 22, title: 22, aliases: 16, description: 8, content: 4, text: 4,
  work: 12, edition: 11, book: 9, chapter: 8, verse: 8, language: 6, tradition: 6,
  source: 5, tags: 8, topics: 8, keywords: 8
});

function normalize(value) {
  return String(value ?? "").normalize("NFKC").toLowerCase().trim();
}

function tokenize(value) {
  return [...new Set(normalize(value).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [])];
}

function flatten(value, depth = 0) {
  if (value == null || depth > 4) return "";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.slice(0, 500).map(x => flatten(x, depth + 1)).join(" ");
  if (typeof value === "object") return Object.entries(value).slice(0, 200)
    .map(([k, v]) => `${k} ${flatten(v, depth + 1)}`).join(" ");
  return "";
}

function fieldValue(item, field) {
  return flatten(item?.[field]);
}

function fieldText(item, fields) {
  if (!item || typeof item !== "object") return flatten(item);
  return fields.map(key => fieldValue(item, key)).join(" ");
}

function matchesFilters(item, filters = {}) {
  for (const [key, expected] of Object.entries(filters)) {
    if (expected == null || expected === "") continue;
    const values = Array.isArray(expected) ? expected.map(normalize) : [normalize(expected)];
    const actual = Array.isArray(item?.[key]) ? item[key].map(normalize) : [normalize(item?.[key])];
    if (!values.some(v => actual.includes(v))) return false;
  }
  return true;
}

function identityFor(type, item) {
  return String(item?.id ?? item?.url ?? item?.sourceUrl ?? `${type}:${JSON.stringify(item).slice(0, 300)}`);
}

function scoreRecord(query, record, qTokens = tokenize(query)) {
  const q = normalize(query);
  if (!record.text) return 0;

  let score = 0;
  if (record.text === q) score += 120;
  if (record.text.startsWith(q)) score += 50;
  if (record.text.includes(q)) score += 30;

  for (const [field, weight] of Object.entries(FIELD_WEIGHTS)) {
    const value = record.fields[field];
    if (value && value.includes(q)) score += weight;
  }

  let matched = 0;
  for (const token of qTokens) {
    if (record.tokenSet.has(token)) matched++;
  }
  if (qTokens.length) {
    score += (matched / qTokens.length) * 40;
    if (matched === qTokens.length) score += 18;
  }
  return score;
}

function candidateIds(index, query) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const postings = tokens.map(token => index.inverted.get(token) ?? []);
  const usable = postings.filter(Boolean);
  if (!usable.length) return [];

  // AND first: precise multi-token queries stay tiny. Fall back to union for recall.
  if (usable.length === tokens.length) {
    const ordered = [...usable].sort((a, b) => a.length - b.length);
    let intersection = ordered[0];
    for (let i = 1; i < ordered.length && intersection.length; i++) {
      const next = ordered[i];
      const keep = [];
      let a = 0, b = 0;
      while (a < intersection.length && b < next.length) {
        if (intersection[a] === next[b]) { keep.push(intersection[a]); a++; b++; }
        else if (intersection[a] < next[b]) a++;
        else b++;
      }
      intersection = keep;
    }
    if (intersection.length) return intersection;
  }
  return [...new Set(usable.flat())];
}

function rankIndex(index, query, limit, options = {}) {
  const q = normalize(query);
  if (!q) return [];
  const qTokens = tokenize(q);
  const max = Math.max(1, Math.min(1000, Number(limit) || 30));
  const filters = options.filters ?? {};
  const ids = candidateIds(index, q);
  const out = [];

  for (const id of ids) {
    const record = index.recordsById.get(id);
    if (!record || !matchesFilters(record.item, filters)) continue;
    const score = scoreRecord(q, record, qTokens);
    if (score <= 0) continue;
    out.push({
      type: record.type,
      item: record.item,
      score: Number(score.toFixed(4)),
      matchedQuery: q,
      matchedTokens: qTokens.filter(token => record.tokenSet.has(token))
    });
  }

  // Exact/phrase hits should dominate, then relevance, then stable identity.
  return out.sort((a, b) => b.score - a.score || String(a.item?.id ?? "").localeCompare(String(b.item?.id ?? ""))).slice(0, max);
}

export function universalSearch(query, collections = [], limit = 30, options = {}) {
  const index = buildSearchIndex(collections, options);
  return rankIndex(index, query, limit, options);
}

export function buildSearchIndex(collections = [], options = {}) {
  const fields = Array.isArray(options.fields) && options.fields.length ? options.fields : DEFAULT_FIELDS;
  const recordsById = new Map();
  const inverted = new Map();

  for (const c of collections) {
    for (const item of c.items ?? []) {
      const id = identityFor(c.type ?? "record", item);
      if (recordsById.has(id)) continue;

      const fieldsMap = Object.fromEntries(fields.map(field => [field, normalize(fieldValue(item, field))]));
      const text = fields.map(field => fieldsMap[field]).join(" ").trim();
      const tokens = tokenize(text);
      const record = {
        id,
        type: c.type ?? "record",
        item,
        fields: fieldsMap,
        text,
        tokens,
        tokenSet: new Set(tokens)
      };
      recordsById.set(id, record);
      for (const token of tokens) {
        let posting = inverted.get(token);
        if (!posting) inverted.set(token, posting = []);
        posting.push(id);
      }
    }
  }

  return {
    version: 3,
    createdAt: new Date().toISOString(),
    fields,
    records: [...recordsById.values()],
    recordsById,
    inverted,
    size: recordsById.size,
    tokenCount: inverted.size
  };
}

export function searchIndex(index, query, limit = 30, options = {}) {
  if (!index?.recordsById || !index?.inverted) return [];
  return rankIndex(index, query, limit, options);
}

export const SEARCH_CAPABILITIES = Object.freeze([
  "exact", "token", "phrase", "field-aware", "cross-collection", "deduplicated", "ranked",
  "knowledge-graph-aware", "multilingual-unicode", "deep-limit", "federated-source-ready",
  "inverted-index", "candidate-pruning", "filter-aware", "stable-ranking"
]);
