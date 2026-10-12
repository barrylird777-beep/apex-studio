import test from "node:test";
import assert from "node:assert/strict";
import { searchAnything } from "../src/core/apex-web-search.mjs";

function response(body, contentType = "application/json") {
  return new Response(body, { status: 200, headers: { "content-type": contentType } });
}

function fixtureFetch({ fail = [] } = {}) {
  const calls = [];
  const fetchImpl = async input => {
    const url = new URL(String(input));
    calls.push(url);
    if (fail.includes(url.hostname)) return new Response("provider unavailable", { status: 503 });
    if (url.hostname === "html.duckduckgo.com") {
      return response(
        '<div class="result"><a class="result__a" href="https://example.org/web">Web result</a><div class="result__snippet">Public web snippet</div></div>',
        "text/html"
      );
    }
    if (url.hostname === "en.wikipedia.org") {
      return response(JSON.stringify({ query: { search: [{ pageid: 42, title: "Encyclopedia result", snippet: "Wiki <b>snippet</b>" }] } }));
    }
    if (url.hostname === "api.openalex.org") {
      return response(JSON.stringify({ results: [{
        id: "https://openalex.org/W1",
        display_name: "Open research result",
        publication_year: 2024,
        primary_location: { landing_page_url: "https://example.org/openalex" },
        authorships: [{ author: { display_name: "A. Researcher" } }]
      }] }));
    }
    if (url.hostname === "api.crossref.org") {
      return response(JSON.stringify({ message: { items: [{
        title: ["Crossref research result"],
        URL: "https://example.org/crossref",
        DOI: "10.1234/test",
        author: [{ given: "Ada", family: "Lovelace" }],
        published: { "date-parts": [[2023]] }
      }] } }));
    }
    if (url.hostname === "export.arxiv.org") {
      return response('<feed><entry><id>http://arxiv.org/abs/1234.5678</id><title>arXiv research result</title><summary>arXiv abstract</summary><published>2024-01-01T00:00:00Z</published></entry></feed>', "application/atom+xml");
    }
    throw new Error("Unexpected provider " + url.hostname);
  };
  return { fetchImpl, calls };
}

test("federated search returns web, encyclopedia, and scholarly results with provenance", async () => {
  const { fetchImpl, calls } = fixtureFetch();
  const result = await searchAnything("sovereign networks", { fetchImpl, limit: 50 });
  assert.equal(result.success, true);
  assert.equal(result.partial, false);
  assert.equal(result.providers.length, 5);
  assert.equal(calls.length, 5);
  assert.ok(result.results.some(item => item.source === "DuckDuckGo" && item.category === "web"));
  assert.equal(result.results.find(item => item.source === "DuckDuckGo")?.snippet, "Public web snippet");
  assert.ok(result.results.some(item => item.source === "Wikipedia" && item.category === "encyclopedia"));
  assert.ok(result.results.some(item => item.source === "OpenAlex" && item.category === "research"));
  assert.ok(result.results.some(item => item.source === "Crossref"));
  assert.ok(result.results.some(item => item.source === "arXiv"));
  assert.ok(result.results.every(item => item.url.startsWith("https://") && item.retrievedAt));
  assert.equal(result.requestHash.length, 64);
});

test("one unavailable provider produces honest partial results instead of losing all sources", async () => {
  const { fetchImpl } = fixtureFetch({ fail: ["api.openalex.org"] });
  const result = await searchAnything("network security", { fetchImpl, limit: 20 });
  assert.equal(result.success, true);
  assert.equal(result.partial, true);
  assert.equal(result.providers.find(provider => provider.source === "OpenAlex").ok, false);
  assert.ok(result.results.length > 0);
});

test("search validates queries and bounds pagination and result count", async () => {
  await assert.rejects(() => searchAnything("  ", { fetchImpl: async () => response("{}") }), /query is required/i);
  await assert.rejects(() => searchAnything("x".repeat(513), { fetchImpl: async () => response("{}") }), /512 characters/i);
  const { fetchImpl, calls } = fixtureFetch();
  const result = await searchAnything("Bible research", { fetchImpl, limit: 1000, page: 999 });
  assert.equal(result.limit, 100);
  assert.equal(result.page, 100);
  assert.ok(calls.every(url => url.href.includes("page=100") || url.href.includes("offset=") || url.href.includes("s=") || url.href.includes("sroffset=") || url.href.includes("start=")));
});

test("provider responses are size-limited", async () => {
  const fetchImpl = async () => new Response("{}", { status: 200, headers: { "content-length": String(3 * 1024 * 1024) } });
  const result = await searchAnything("bounded response", { fetchImpl, limit: 5 });
  assert.equal(result.success, false);
  assert.equal(result.partial, true);
  assert.ok(result.providers.every(provider => !provider.ok));
});
