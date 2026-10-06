#!/usr/bin/env node
/**
 * Apex Bible/artifact discovery harvester.
 *
 * Sources:
 *   - DBS ARC catalogs and expansions
 *   - IIIF Presentation collections/manifests from major public repositories
 *
 * Discovery is source-backed metadata only. It never downloads or republishes
 * copyrighted images/text and never invents records to satisfy a quota.
 */
import fs from "node:fs/promises";
import path from "node:path";

const ROOT = "https://arc.dbs.org";
const OUT = path.resolve("data/bible/discovery-50000.generated.json");
const MIN = Number(process.env.APEX_DISCOVERY_MIN || 50000);
const CONCURRENCY = Math.max(1, Number(process.env.APEX_DISCOVERY_CONCURRENCY || 16));
const IIIF_MAX_MANIFESTS = Math.max(1, Number(process.env.APEX_IIIF_MAX_MANIFESTS || 250000));
const IIIF_MAX_DEPTH = Math.max(1, Number(process.env.APEX_IIIF_MAX_DEPTH || 8));

async function getJson(url) {
  const res = await fetch(url, {
    headers: { accept: "application/ld+json, application/json" },
    signal: AbortSignal.timeout(30000)
  });
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

function labelOf(x, fallback) {
  const value = x?.label ?? x?.title ?? x?.name ?? x?.autonym ?? x?.abbr;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(" / ");
  if (value && typeof value === "object") {
    const first = Object.values(value).flat().find(Boolean);
    if (first) return String(first);
  }
  return fallback;
}

function push(records, kind, source, item, parentId = null, index = 0, extra = {}) {
  const id = idOf(item, index);
  records.push({
    id: `${source}:${kind}:${id}${parentId ? `:${parentId}` : ""}`,
    kind,
    source,
    parentId,
    externalId: id,
    title: labelOf(item, id),
    language: item?.iso ?? item?.language ?? null,
    sourceUrl: item?.url ?? item?.id ?? ROOT,
    metadata: item,
    ...extra
  });
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      try {
        out[i] = await fn(items[i], i);
      } catch (error) {
        console.warn("harvest item failed", error.message);
        out[i] = null;
      }
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
for (const [bibleId, books] of bookLists.filter(Boolean)) {
  books.forEach((book, i) => push(records, "bible-book", "dbs-arc", book, bibleId, i));
}

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
for (const [iso, books] of langBooks.filter(Boolean)) {
  books.forEach((book, i) => push(records, "language-bible-book", "dbs-arc", book, iso, i));
}

/*
 * IIIF discovery sources.
 * These are public Presentation API collection entry points. The crawler walks
 * nested collections and records manifests as digital artifact manifestations.
 */
const IIIF_COLLECTIONS = [
  ["biblissima", "https://biblissima.fr/iiif/collection/top"],
  ["e-codices", "https://www.e-codices.unifr.ch/metadata/iiif/collection.json"],
  ["bodleian", "https://iiif.bodleian.ox.ac.uk/iiif/collection/top"],
  ["durham", "https://iiif.durham.ac.uk/manifests/trifle/collection/index"],
  ["nls", "https://view.nls.uk/collections/top.json"],
  ["textgrid", "https://textgridlab.org/1.0/iiif/manifests/collection.json"]
];

const seenIIIF = new Set();
let iiifManifestCount = 0;

function iiifType(item) {
  return String(item?.type ?? item?.["@type"] ?? "").toLowerCase();
}

function iiifId(item) {
  return item?.id ?? item?.["@id"] ?? null;
}

function isManifest(item) {
  const type = iiifType(item);
  return type.includes("manifest") || /\/manifest(?:\.json)?(?:$|[?#])/i.test(String(iiifId(item) || ""));
}

function isCollection(item) {
  const type = iiifType(item);
  return type.includes("collection");
}

function extractIIIFItems(payload) {
  return Array.isArray(payload?.items) ? payload.items : [];
}

async function walkIIIF(url, source, parent = null, depth = 0) {
  if (!url || depth > IIIF_MAX_DEPTH || iiifManifestCount >= IIIF_MAX_MANIFESTS) return;
  if (seenIIIF.has(url)) return;
  seenIIIF.add(url);

  let payload;
  try {
    payload = await getJson(url);
  } catch (error) {
    console.warn("IIIF unavailable", url, error.message);
    return;
  }

  const type = iiifType(payload);
  const payloadId = iiifId(payload) || url;

  if (isManifest(payload) || type.includes("manifest")) {
    if (iiifManifestCount < IIIF_MAX_MANIFESTS) {
      push(records, "iiif-manifest", source, {
        id: payloadId,
        label: payload.label,
        metadata: payload.metadata,
        rights: payload.rights,
        license: payload.license,
        provider: payload.provider,
        homepage: payload.homepage
      }, parent, iiifManifestCount++, {
        manifestation: "digital",
        protocol: "IIIF Presentation"
      });
    }
    return;
  }

  const items = extractIIIFItems(payload);
  for (const item of items) {
    const childId = iiifId(item);
    if (!childId) continue;

    if (isManifest(item)) {
      push(records, "iiif-manifest", source, item, payloadId, iiifManifestCount++, {
        manifestation: "digital",
        protocol: "IIIF Presentation"
      });
      if (iiifManifestCount >= IIIF_MAX_MANIFESTS) return;
    } else if (isCollection(item)) {
      await walkIIIF(childId, source, payloadId, depth + 1);
    } else if (typeof item === "object") {
      const itemType = iiifType(item);
      if (itemType.includes("manifest")) {
        push(records, "iiif-manifest", source, item, payloadId, iiifManifestCount++, {
          manifestation: "digital",
          protocol: "IIIF Presentation"
        });
      }
    }
  }

  // Some repositories expose collection members only as URLs with no type.
  for (const item of items) {
    const childId = iiifId(item);
    if (!childId || seenIIIF.has(childId)) continue;
    if (/manifest/i.test(childId) || /collection/i.test(childId)) {
      await walkIIIF(childId, source, payloadId, depth + 1);
    }
  }
}

for (const [source, endpoint] of IIIF_COLLECTIONS) {
  await walkIIIF(endpoint, source);
}

const unique = [...new Map(records.map(r => [r.id, r])).values()];
unique.sort((a, b) => a.id.localeCompare(b.id));

if (unique.length < MIN) {
  throw new Error(
    `Discovery harvest produced ${unique.length} records; required minimum is ${MIN}. ` +
    "Refusing to publish a false quota."
  );
}

const byKind = {};
for (const record of unique) byKind[record.kind] = (byKind[record.kind] || 0) + 1;

const payload = {
  schemaVersion: 3,
  generatedAt: new Date().toISOString(),
  policy: {
    discovery: "source-backed",
    deduplication: "stable source/kind/externalId/parent identity",
    rights: "metadata only; discovery never grants redistribution rights",
    authority: "public source APIs and IIIF Presentation resources",
    images: "not downloaded by this discovery job"
  },
  counts: {
    total: unique.length,
    minimumRequired: MIN,
    iiifManifests: unique.filter(x => x.kind === "iiif-manifest").length,
    byKind
  },
  sources: {
    dbsArc: catalogs.map(([, endpoint]) => ROOT + endpoint),
    iiif: IIIF_COLLECTIONS
  },
  records: unique
};

await fs.mkdir(path.dirname(OUT), { recursive: true });
await fs.writeFile(OUT, JSON.stringify(payload, null, 2) + "\n");
console.log(JSON.stringify(payload.counts, null, 2));
