import express from "express";
import { enqueuePopcornVerseBatch } from "../workers/popcorn-worker.mjs";
import { getPopcorn, listPopcorns } from "../core/bible/popcorn-store.mjs";

const router = express.Router();

router.get("/", async (req, res) => {
  try {
    res.json({ success: true, popcorns: await listPopcorns({
      collectionId: req.query.collectionId || "default",
      q: req.query.q || "",
      limit: req.query.limit,
      offset: req.query.offset
    })});
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.get("/:id", async (req, res) => {
  try {
    const popcorn = await getPopcorn(req.params.id);
    if (!popcorn) return res.status(404).json({ success: false, error: "Popcorn not found" });
    res.json({ success: true, popcorn });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

router.post("/discover", async (req, res) => {
  try {
    const verses = Array.isArray(req.body?.verses) ? req.body.verses : [];
    if (!verses.length) return res.status(400).json({ success: false, error: "verses[] is required" });
    const ids = await enqueuePopcornVerseBatch({
      verses,
      collectionId: req.body?.collectionId || "default"
    });
    res.status(202).json({ success: true, queued: ids.length, taskIds: ids });
  } catch (error) {
    res.status(503).json({ success: false, error: error.message });
  }
});

export default router;
