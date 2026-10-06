#!/usr/bin/env node
/**
 * Apex Bible discovery harvester.
 * Harvests source-backed catalog records only; never invents candidates.
 * Output is a generated discovery manifest suitable for later PostgreSQL ingestion.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = "https://arc.dbs.org";
const OUT = path.resolve("data/bible/discovery-50000.generated.json");
const MIN = Number(process.env.APEX_DISCOVERY_MIN || 50000);
const CONCURRENCY = Number(process.env.APEX_DISCOVERY_CONCURRENCY || 12);

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}: ${url}`);
  return res.json();
}

function arr(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  for (const key of ["data", "items", "results", "records", "bibles", "books", "languages", "countries", "organizations", "films", "art", "artists", "libraries", "alphabets"]) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function idOf(x, fallback) {
  return String(x?.id ?? x?.iso ?? x?.slug ?? x?.abbr ?? fallback);
}

function push(records, kind, source, item, parentId = null, index = 0) {
  const id = idOf(item, index);
  records.push({
    id: `${source}:${kind}:${id}${parentId ? `:${parentId}` : ""}`,
    kind,
    source,
    parentId,
    externalId: id,
    title: item?.title ?? item?.name ?? item?.autonym ?? item?.abbr ?? id,
    language: item?.iso ?? null,
    sourceUrl: item?.url ?? `${ROOT}`,
    metadata: item
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

const records = [];
const catalogs = [
  ["language", "/api/languages"],
  ["country", "/api/countries"],
  ["organization", "/api/organizations"],
  ["film", "/api/films"],
  ["artwork", "/api/art"],
  ["artist", "/api/artists"],
  ["library", "/api/libraries"],
  ["alphabet", "/api/alphabets"],
  ["book", "/api/books"],
  ["bible", "/api/bibles"],
  ["audio-bible", "/api/bible-audio/"]
];

for (const [kind, endpoint] of catalogs) {
  const list = arr(await getJson(ROOT + endpoint));
  list.forEach((item, i) => push(records, kind, "dbs-arc", item, null, i));
}

// A Bible's books are first-class discovery records: they are actual catalog
// manifestations with a parent Bible ID, not fabricated padding.
const bibles = arr(await getJson(ROOT + "/api/bibles"));
const bookLists = await mapLimit(bibles, CONCURRENCY, async (bible) => {
  const id = idOf(bible);
  try {
    return [id, arr(await getJson(ROOT + "/api/bibles/" + encodeURIComponent(id) + "/books"))];
  } catch (error) {
    console.warn("books unavailable", id, error.message);
    return [id, []];
  }
});
for (const [bibleId, books] of bookLists) {
  books.forEach((book, i) => push(records, "bible-book", "dbs-arc", book, bibleId, i));
}

// Also retain language-level chapterized book catalogs where available.
const languages = arr(await getJson(ROOT + "/api/languages"));
const langBooks = await mapLimit(languages, CONCURRENCY, async (language) => {
  const iso = language?.iso;
  if (!iso) return [null, []];
  try {
    return [iso, arr(await getJson(ROOT + "/api/bible-books/" + encodeURIComponent(iso)))];
  } catch {
    return [iso, []];
  }
});
for (const [iso, books] of langBooks) {
  books.forEach((book, i) => push(records, "language-bible-book", "dbs-arc", book, iso, i));
}

const unique = [...new Map(records.map(r => [r.id, r])).values()];
unique.sort((a, b) => a.id.localeCompare(b.id));

if (unique.length < MIN) {
  throw new Error(`Discovery harvest produced ${unique.length} records; required minimum is ${MIN}. Refusing to publish a false 50k count.`);
}

const payload = {
  schemaVersion: 2,
  generatedAt: new Date().toISOString(),
  policy: {
    discovery: "source-backed",
    deduplication: "stable source/kind/externalId/parent identity",
    rights: "metadata only; discovery never grants redistribution rights",
    authority: "generated from public DBS ARC APIs"
  },
  counts: {
    total: unique.length,
    minimumRequired: MIN,
    byKind: Object.fromEntries([...new Set(unique.map(x => x.kind))].map(k => [k, unique.filter(x => x.kind === k).length]))
  },
  records: unique
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload.counts, null, 2));
