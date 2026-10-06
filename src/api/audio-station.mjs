import express from "express";
import { listVoiceOptions, synthesizeSpeech, generateSfx, audioEdit } from "../core/audio-station.mjs";

export function createAudioStationRouter() {
  const router = express.Router();
  router.get("/voices", async (_req, res) => {
    try { res.json({ ok: true, voices: await listVoiceOptions() }); }
    catch (error) { res.status(503).json({ ok: false, error: error?.message || String(error) }); }
  });
  router.post("/tts", async (req, res) => {
    try { res.json(await synthesizeSpeech(req.body || {})); }
    catch (error) { res.status(400).json({ ok: false, error: error?.message || String(error) }); }
  });
  router.post("/sfx", async (req, res) => {
    try { res.json(await generateSfx(req.body || {})); }
    catch (error) { res.status(400).json({ ok: false, error: error?.message || String(error) }); }
  });
  router.post("/edit", async (req, res) => {
    try { res.json(await audioEdit(req.body || {})); }
    catch (error) { res.status(400).json({ ok: false, error: error?.message || String(error) }); }
  });
  return router;
}
