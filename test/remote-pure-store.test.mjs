import test from "node:test";
import assert from "node:assert/strict";

const previousUrl = process.env.APEX_WORKER_API_URL;
const previousToken = process.env.APEX_WORKER_TOKEN;
process.env.APEX_WORKER_API_URL = "https://apex-worker-test.invalid";
process.env.APEX_WORKER_TOKEN = "test-worker-token";
const { createRemotePureStore } = await import("../src/core/remote-pure-store.mjs?remote-store-test");

test("remote Pure-WAL store authenticates and returns filtered API records", async () => {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(JSON.stringify({ success: true, records: [{ id: "asset-1", episodeId: "episode-1" }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const store = createRemotePureStore();
    const records = await store.queryFiltered("teevee_episode_assets", { episodeId: "episode-1" }, { limit: 5 });
    assert.deepEqual(records, [{ id: "asset-1", episodeId: "episode-1" }]);
    assert.equal(calls[0].url, "https://apex-worker-test.invalid/api/internal/store/query");
    assert.equal(calls[0].options.headers["x-apex-worker-token"], "test-worker-token");
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      collection: "teevee_episode_assets", filters: { episodeId: "episode-1" }, sortField: "", descending: false, limit: 5
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("remote Pure-WAL store sends TeeVee stage jobs to the API queue", async () => {
  const originalFetch = globalThis.fetch;
  let sent;
  globalThis.fetch = async (url, options) => {
    sent = { url: String(url), body: JSON.parse(options.body), token: options.headers["x-apex-worker-token"] };
    return new Response(JSON.stringify({ success: true, task: { id: "job-1", duplicate: false, status: "queued" } }), { status: 202, headers: { "content-type": "application/json" } });
  };
  try {
    const store = createRemotePureStore();
    const result = await store.enqueue({
      id: "job-1", type: "teevee.episode.script",
      payload: { episodeId: "episode-1", episodeCode: "APX-0001", stage: "script" },
      dedupeKey: "teevee:APX-0001:script"
    });
    assert.equal(sent.url, "https://apex-worker-test.invalid/api/internal/teevee/enqueue");
    assert.equal(sent.token, "test-worker-token");
    assert.equal(sent.body.task, "teevee.episode.script");
    assert.equal(result.id, "job-1");
  } finally {
    globalThis.fetch = originalFetch;
    if (previousUrl === undefined) delete process.env.APEX_WORKER_API_URL;
    else process.env.APEX_WORKER_API_URL = previousUrl;
    if (previousToken === undefined) delete process.env.APEX_WORKER_TOKEN;
    else process.env.APEX_WORKER_TOKEN = previousToken;
  }
});
