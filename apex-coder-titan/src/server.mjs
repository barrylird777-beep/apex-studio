import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, validateConfig } from "./config.mjs";
import { runTitan } from "./titan.mjs";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "../public")));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "apex-coder-titan", configured: Boolean(config.apiKey) });
});

app.post("/api/titan/run", async (req, res) => {
  const check = validateConfig();
  if (!check.ok) return res.status(503).json(check);

  const { repoPath, assignment } = req.body || {};
  if (typeof repoPath !== "string" || !repoPath.trim()) return res.status(400).json({ error: "repoPath is required." });
  if (typeof assignment !== "string" || assignment.trim().length < 10) return res.status(400).json({ error: "assignment is required." });

  const events = [];
  try {
    const result = await runTitan({
      repoPath: repoPath.trim(),
      assignment: assignment.trim(),
      onEvent: event => events.push(event)
    });
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message, events });
  }
});

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Apex Coder Titan listening on http://127.0.0.1:${config.port}`);
});
