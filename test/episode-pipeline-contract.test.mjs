import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const pipeline = fs.readFileSync(new URL("../src/pipelines/episode-pipeline.mjs", import.meta.url), "utf8");
const dispatcher = fs.readFileSync(new URL("../src/core/mesh/episode-job-dispatcher.mjs", import.meta.url), "utf8");

test("episode pipeline only enqueues implemented durable handlers", () => {
  for (const role of ["graph-expansion", "episode-script-generation"]) {
    assert.match(pipeline, new RegExp('"' + role + '"'));
    assert.match(dispatcher, new RegExp('"' + role + '"'));
  }
  for (const role of ["episode-research", "episode-verification", "episode-direction", "episode-visual-direction", "episode-audio-direction", "episode-music-direction", "episode-qc"]) {
    assert.doesNotMatch(pipeline, new RegExp('"' + role + '"'));
  }
});

test("episode research branches preserve distinct context identities", () => {
  assert.match(pipeline, /expansionType: stage/);
  assert.match(dispatcher, /p\.expansionType \|\| p\.type/);
  assert.match(dispatcher, /graph-\$\{String\(p\.expansionType/);
});
