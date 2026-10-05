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

const NORMALIZE_CACHE = new Map();
function normalize(value) {
  const raw = String(value ?? "");
  const cached = NORMALIZE_CACHE.get(raw);
  if (cached !== undefined) return cached;
  const value = raw.normalize("NFKC").toLowerCase().trim();
  if (NORMALIZE_CACHE.size < 20000) NORMALIZE_CACHE.set(raw, value);
  return value;
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
  const postings = tokens.map(token => index.inverted.get(token));
  const usable = postings.filter(Boolean);
  if (!usable.length) return [];
  if (usable.length !== tokens.length) return [...new Set(usable.flat())];

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
