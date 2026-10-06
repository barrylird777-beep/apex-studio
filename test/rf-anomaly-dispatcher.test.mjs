import test from "node:test";
import assert from "node:assert/strict";
import { createEpisodeJobDispatcher } from "../src/core/mesh/episode-job-dispatcher.mjs";

test("RF anomaly dispatcher rejects missing BSSID", async () => {
  const dispatch = createEpisodeJobDispatcher({ pool: {} });
  await assert.rejects(
    dispatch({
      role: "rf-anomaly-evaluate",
      payload: { embedding: Array(1536).fill(0) }
    }),
    /requires bssid/
  );
});

test("RF anomaly dispatcher rejects non-1536 embeddings", async () => {
  const dispatch = createEpisodeJobDispatcher({ pool: {} });
  await assert.rejects(
    dispatch({
      role: "rf-anomaly-evaluate",
      payload: {
        bssid: "00:11:22:33:44:55",
        embedding: [0]
      }
    }),
    /1536-dimensional/
  );
});

test("RF anomaly dispatcher rejects non-finite embeddings", async () => {
  const dispatch = createEpisodeJobDispatcher({ pool: {} });
  const embedding = Array(1536).fill(0);
  embedding[17] = Number.NaN;

  await assert.rejects(
    dispatch({
      role: "rf-anomaly-evaluate",
      payload: {
        bssid: "00:11:22:33:44:55",
        embedding
      }
    }),
    /invalid values/
  );
});
