import express from "express";
import { randomUUID } from "node:crypto";
import { apexPureStore } from "../core/apex-pure-store.mjs";
import { buildEpisode, episodeCode, deterministicEpisodeId, TEEVEE_EPISODE_COUNT } from "../core/teevee-production.mjs";
import { createDownloadUrl } from "../storage/cloud-object-store.mjs";

export function createTeeVeeProductionRouter({ enqueue, requireAuth, store = apexPureStore, enabled = process.env.TEEVEE_PIPELINE_ENABLED === "true" } = {}) {
  if (typeof enqueue !== "function") throw new TypeError("TeeVee production enqueue function is required");
  const router = express.Router();
  router.use(express.json({ limit: "64kb" }));

  router.get("/assets/:id/download", requireAuth || ((_req, _res, next) => next()), async (req, res) => {
    try {
      const asset = await store.get("teevee_episode_assets", String(req.params.id));
      if (!asset) return res.status(404).json({ success: false, error: "TeeVee asset not found" });
      const key = String(asset.assetUri || asset.asset_uri || "");
      if (!key.startsWith("teevee/")) return res.status(404).json({ success: false, error: "Asset is not stored in cloud object storage" });
      const download = await createDownloadUrl({ key, prefix: "apex-business" });
      return res.json({ success: true, assetId: asset.id, key: download.key, url: download.url });
    } catch (error) {
      const status = Number(error?.status) || 503;
      return res.status(status).json({ success: false, error: String(error?.message || error).slice(0, 500) });
    }
  });

  router.get("/status", async (_req, res) => {
    try {
      const episodes = await store.list("teevee_episodes");
      const counts = new Map();
      for (const episode of episodes) counts.set(String(episode.state || "UNKNOWN"), (counts.get(String(episode.state || "UNKNOWN")) || 0) + 1);
      const jobs = typeof store.jobs === "function" ? store.jobs().filter(job => String(job.type || "").startsWith("teevee.episode.")) : [];
      return res.json({
        success: true,
        network: "TeeVee",
        episodeStates: [...counts.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([state, count]) => ({ state, count })),
        inventoryTotal: TEEVEE_EPISODE_COUNT,
        seededEpisodes: episodes.length,
        queuedJobs: jobs.filter(job => job.status === "queued").length,
        runningJobs: jobs.filter(job => job.status === "running").length,
        storage: "Pure-WAL/Ring-WAL",
        pipelineEnabled: enabled,
        startBlockedReason: enabled ? null : "Remote worker state and durable artifact handoff are not yet verified.",
        checkedAt: new Date().toISOString()
      });
    } catch (error) {
      return res.status(503).json({ success: false, error: String(error?.message || error).slice(0, 500) });
    }
  });

  router.post("/start", requireAuth || ((_req, _res, next) => next()), async (req, res) => {
    if (!enabled) return res.status(503).json({ success: false, error: "TeeVee production is disabled until remote worker state and durable artifact handoff are verified." });
    const n = Number(req.body?.episodeNumber || 1);
    try {
      const code = episodeCode(n);
      const id = deterministicEpisodeId(n);
      let episode = await store.get("teevee_episodes", id);
      if (!episode) {
        episode = buildEpisode(n);
        await store.put("teevee_episodes", id, episode);
      }
      const dedupeKey = `teevee:${code}:story`;
      const existing = typeof store.jobs === "function"
        ? store.jobs().find(job => job.dedupeKey === dedupeKey && ["queued", "running"].includes(job.status))
        : null;
      if (existing) {
        return res.status(200).json({ success: true, episodeCode: code, status: "already-queued", jobId: existing.id, storage: "Pure-WAL/Ring-WAL" });
      }
      const job = await enqueue({
        id: randomUUID(),
        workerId: "teevee-production-api",
        role: "teevee",
        task: "teevee.episode.story",
        payload: { episodeId: episode.id, episodeCode: episode.episodeCode, stage: "story" },
        maxAttempts: 8,
        dedupeKey,
        traceId: episode.id
      });
      return res.status(202).json({ success: true, episodeCode: code, status: "queued", jobId: job.id, storage: "Pure-WAL/Ring-WAL" });
    } catch (error) {
      const message = String(error?.message || error);
      const status = error instanceof RangeError ? 400 : 503;
      return res.status(status).json({ success: false, error: message.slice(0, 500) });
    }
  });

  return router;
}
