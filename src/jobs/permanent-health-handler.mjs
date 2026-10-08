import { getProjectState } from "../services/projectManager.mjs";
import { RenderWorker } from "../core/render-worker.mjs";
import { capacitySnapshot } from "../core/capacity.mjs";

const clean = (value, max = 500) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);

export async function permanentHealth(job) {
  const payload = job?.payload || {};
  const role = clean(payload.role || "general", 120);
  const startedAt = Date.now();

  if (["project-storage", "media-ingest", "publishing"].includes(role)) {
    await getProjectState();
  } else if (["video-engine", "export", "render-cache", "visual-direction"].includes(role)) {
    await new RenderWorker().available();
  } else if (["voiceover", "audio-reference"].includes(role)) {
    const { voiceoverWorkerStatus } = await import("../workers/voiceover-worker.mjs");
    await voiceoverWorkerStatus();
  } else {
    capacitySnapshot();
  }

  return {
    ok: true,
    workerId: clean(payload.workerId || "", 255),
    role,
    task: clean(payload.task || "", 500),
    durationMs: Date.now() - startedAt,
    completedAt: new Date().toISOString()
  };
}

export default permanentHealth;
