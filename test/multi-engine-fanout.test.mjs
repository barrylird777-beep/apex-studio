import test from "node:test";
import assert from "node:assert/strict";
import { decomposeQuery, normalizeResults } from "../src/core/multi-engine-fanout.mjs";

test("fanout decomposes multi-facet research input into routed subqueries", () => {
  const rows = decomposeQuery("Exodus chronology; archaeological research; latest news");
  assert.ok(rows.length >= 3);
  assert.ok(rows.some(x => x.engine === "general"));
  assert.ok(rows.some(x => x.engine === "academic"));
  assert.ok(rows.some(x => x.engine === "news"));
});

test("fanout normalization removes duplicate URLs and tracking noise", () => {
  const rows = normalizeResults([
    [{ engine:"a", query:"x", status:200, url:"https://example.com/result/?utm_source=test", text:"one" }],
    [{ engine:"b", query:"y", status:200, url:"https://example.com/result/#section", text:"two" }],
    [{ engine:"c", query:"z", status:200, url:"https://example.com/other", text:"three" }]
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].url, "https://example.com/result/");
  assert.equal(rows[1].url, "https://example.com/other");
});
