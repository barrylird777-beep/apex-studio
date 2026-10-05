import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config, validateConfig } from "./config.mjs";
import { runTitan } from "./titan.mjs";

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const jobs = new Map();

app.use(express.json({ limit: "1mb" }));
app.use(express.static(path.join(root, "../public")));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "apex-coder-titan",
    configured: Boolean(config.apiKey),
    activeRuns: [...jobs.values()].filter(job => job.status === "running").length
  });
});

app.post("/api/titan/run", async (req, res) => {
  const check = validateConfig();
  if (!check.ok) return res.status(503).json(check);

  const { repoPath, assignment } = req.body || {};
  if (typeof repoPath !== "string" || !repoPath.trim()) {
    return res.status(400).json({ error: "repoPath is required." });
  }
  if (typeof assignment !== "string" || assignment.trim().length < 10) {
    return res.status(400).json({ error: "assignment is required." });
  }

  const runId = cryptoRandomId();
  const job = {
    runId,
    status: "running",
    events: [],
    listeners: new Set(),
    result: null,
    error: null,
    controller: new AbortController()
  };
  jobs.set(runId, job);

  const emit = event => {
    job.events.push(event);
    for (const listener of job.listeners) listener(event);
  };

  runTitan({
    repoPath: repoPath.trim(),
    assignment: assignment.trim(),
    signal: job.controller.signal,
    onEvent: emit
  }).then(result => {
    job.status = "complete";
    job.result = result;
    emit({ at: new Date().toISOString(), event: "run.complete", runId });
  }).catch(error => {
    job.status = job.controller.signal.aborted ? "cancelled" : "failed";
    job.error = error.message;
    emit({ at: new Date().toISOString(), event: "run.failed", runId, status: job.status, error: error.message });
  });

  res.status(202).json({ runId, status: job.status, eventsUrl: `/api/titan/run/${runId}/events`, resultUrl: `/api/titan/run/${runId}` });
});

app.get("/api/titan/run/:runId", (req, res) => {
  const job = jobs.get(req.params.runId);
  if (!job) return res.status(404).json({ error: "Run not found." });
  res.json({
    runId: job.runId,
    status: job.status,
    result: job.result,
    error: job.error
  });
});

app.get("/api/titan/run/:runId/events", (req, res) => {
  const job = jobs.get(req.params.runId);
  if (!job) return res.status(404).json({ error: "Run not found." });

  res.status(200).set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.flushHeaders();

  for (const event of job.events) res.write(`data: ${JSON.stringify(event)}\n\n`);

  const listener = event => res.write(`data: ${JSON.stringify(event)}\n\n`);
  job.listeners.add(listener);
  req.on("close", () => job.listeners.delete(listener));
});

app.post("/api/titan/run/:runId/cancel", (req, res) => {
  const job = jobs.get(req.params.runId);
  if (!job) return res.status(404).json({ error: "Run not found." });
  if (job.status !== "running") return res.status(409).json({ error: `Run is already ${job.status}.` });
  job.controller.abort();
  res.status(202).json({ runId: job.runId, status: "cancelling" });
});

function cryptoRandomId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

app.listen(config.port, "127.0.0.1", () => {
  console.log(`Apex Coder Titan listening on http://127.0.0.1:${config.port}`);
});
