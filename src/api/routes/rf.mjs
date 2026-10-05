import crypto from "node:crypto";
import express from "express";
import { enqueueWorkerTask } from "../../core/mesh/durable-worker-store.mjs";
import { validateBssid, validateEmbedding } from "../../core/mesh/rf-mesh-swarm.mjs";
import { requireTitanAuth } from "../../security/require-titan-auth.mjs";

export function createRfRouter() {
  const router = express.Router();

  router.post("/evaluate", requireTitanAuth, async (req, res) => {
    try {
      const bssid = validateBssid(req.body?.bssid);
      validateEmbedding(req.body?.embedding);

      const fingerprint = crypto
        .createHash("sha256")
        .update(JSON.stringify({ bssid, embedding: req.body.embedding }))
        .digest("hex");

      const id = crypto.randomUUID();
      const queued = await enqueueWorkerTask({
        id,
        workerId: "rf-anomaly-api",
        role: "rf-anomaly-evaluate",
        task: "rf-anomaly-evaluate",
        payload: {
          bssid,
          embedding: req.body.embedding
        },
        maxAttempts: 5,
        dedupeKey: `rf-anomaly:${fingerprint}`
      });

      return res.status(202).json({
        success: true,
        status: "queued",
        taskId: queued.id
      });
    } catch (error) {
      return res.status(400).json({
        success: false,
        error: String(error?.message || error)
      });
    }
  });

  return router;
}
