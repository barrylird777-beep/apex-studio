import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ApexPureStore } from "../src/core/apex-pure-store.mjs";
import { ApexRingWAL } from "../src/core/apex-ring-wal.mjs";
import { runRenderQC, requireRenderQC } from "../src/core/validation/render-qc.mjs";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", chunk => { stdout += chunk.toString(); });
    child.stderr.on("data", chunk => { stderr += chunk.toString(); });
    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${command} exited with ${code}: ${stderr.slice(-3000)}`));
    });
  });
}

const root = await mkdtemp(path.join(os.tmpdir(), "kernelvision-sovereign-render-"));
try {
  const renderDir = path.join(root, "renders");
  const output = path.join(renderDir, "sovereign-render-smoke.mp4");
  const projects = path.join(root, "projects");
  const walFile = path.join(root, "wal", "ring.wal.jsonl");
  await import("node:fs/promises").then(fs => fs.mkdir(renderDir, { recursive: true }));

  await run(process.env.FFMPEG_PATH || "ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-y",
    "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=24:d=2",
    "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
    "-t", "2", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
    "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "128k",
    "-shortest", "-movflags", "+faststart", output
  ]);

  const fileInfo = await stat(output);
  assert.ok(fileInfo.size > 1024, "FFmpeg output must be a non-empty MP4");
  const qc = requireRenderQC(await runRenderQC({
    mediaPath: output,
    expectedWidth: 1920,
    expectedHeight: 1080,
    expectedAspect: 16 / 9,
    expectedDurationSeconds: 2,
    toleranceSeconds: 0.6
  }));
  const sha256 = createHash("sha256").update(await readFile(output)).digest("hex");
  const artifactId = "render-smoke-" + Date.now();
  const metadata = {
    id: artifactId,
    kind: "verification-render",
    status: "verified",
    source: "local-ffmpeg-lavfi",
    provenance: { class: "synthetic-test-media", licensing: "not-for-publication" },
    sha256,
    bytes: fileInfo.size,
    width: 1920,
    height: 1080,
    durationSeconds: qc.duration,
    qc,
    verifiedAt: new Date().toISOString()
  };

  const store = new ApexPureStore({
    root: projects,
    wal: new ApexRingWAL({ file: walFile })
  });
  await store.init();
  await store.put("artifacts", artifactId, metadata);

  const reopened = new ApexPureStore({
    root: projects,
    wal: new ApexRingWAL({ file: walFile })
  });
  await reopened.init();
  const recovered = await reopened.get("artifacts", artifactId);
  assert.equal(recovered?.sha256, sha256, "artifact hash must survive WAL reopen");
  assert.equal(recovered?.status, "verified");
  assert.equal(recovered?.provenance?.licensing, "not-for-publication");

  console.log(JSON.stringify({
    ok: true,
    scope: "isolated synthetic render smoke; not a Bible-story production",
    render: { outputBytes: fileInfo.size, sha256, width: 1920, height: 1080, durationSeconds: qc.duration, hasAudio: qc.checks.hasAudio },
    durableArtifact: { store: "local-pure-wal", reopened: true, provenanceRecorded: true },
    qc
  }, null, 2));
} finally {
  await rm(root, { recursive: true, force: true });
}
