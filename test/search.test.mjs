import test from "node:test";
import assert from "node:assert/strict";
import { buildSearchIndex, searchIndex, universalSearch } from "../src/core/search.mjs";

test("search index prunes candidates and ranks exact Bible records", () => {
  const index = buildSearchIndex([
    { type: "bible", items: [
      { id: "gen", title: "Genesis", tradition: "Hebrew Bible", language: "Hebrew" },
      { id: "john", title: "John", tradition: "Christian Bible", language: "Greek" },
      { id: "genesis-commentary", title: "Commentary on Genesis", content: "creation" }
    ] }
  ]);

  assert.ok(index.inverted instanceof Map);
  assert.ok(index.recordsById instanceof Map);
  assert.equal(searchIndex(index, "Genesis", 1)[0].item.id, "gen");
  assert.equal(searchIndex(index, "Genesis", 10, { filters: { tradition: "Hebrew Bible" } })[0].item.id, "gen");
});

test("Unicode and multilingual tokens remain searchable", () => {
  const results = universalSearch("Ἰωάννης", [
    { type: "texts", items: [{ id: "1", title: "Κατὰ Ἰωάννην", language: "Greek" }] }
  ]);
  assert.equal(results[0].item.id, "1");
});

test("duplicate manifestations collapse to one result", () => {
  const results = universalSearch("dead sea scrolls", [
    { type: "a", items: [{ id: "same", title: "Dead Sea Scrolls" }] },
    { type: "b", items: [{ id: "same", title: "Dead Sea Scrolls", source: "other" }] }
  ]);
  assert.equal(results.length, 1);
});
