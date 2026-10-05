import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { TitanPathJail } from "../../security/titan-path-jail.mjs";

const execFileAsync = promisify(execFile);

function safePart(value) {
  const normalized = String(value ?? "").replace(/[^a-zA-Z0-9._-]/g, "_");
  if (!normalized || normalized === "." || normalized === "..") throw new Error("RENDER_FAILED: invalid path component");
  return normalized.slice(0, 120);
}

function escapeDrawtext(value) {
  return String(value ?? "").replace(/\\/g, "\\\\").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

async function sha256File(filePath) {
  const { createReadStream } = await import("node:fs");
  return await new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

export class MediaRenderHandler {
  constructor(pool, { outputDir = path.resolve(process.cwd(), "output_media") } = {}) {
    if (!pool) throw new TypeError("MediaRenderHandler requires PostgreSQL");
    this.pool = pool;
    this.outputDir = path.resolve(outputDir);
    this.jail = new TitanPathJail(this.outputDir);
  }

  async process(payload = {}) {
    const episodeId = String(payload.episodeId || "").trim();
    if (!/^[0-9a-f-]{36}$/i.test(episodeId)) throw new Error("RENDER_FAILED: invalid episodeId");

    const book = safePart(payload.book || "episode");
    const chapter = safePart(payload.chapter || "0");
    const episodeTag = safePart(episodeId.slice(0, 8));
    const finalPath = this.jail.enforceStrictBoundary(path.join(this.outputDir, `episode_${book}_${chapter}_${episodeTag}.mp4`));
    const tempPath = this.jail.enforceStrictBoundary(path.join(this.outputDir, `.${path.basename(finalPath)}.${randomUUID()}.tmp.mp4`));
    await mkdir(this.outputDir, { recursive: true });

    const context = await this.pool.query(`SELECT context_type, raw_data FROM apex_episode_context WHERE episode_id = $1`, [episodeId]);
    const contextMap = Object.fromEntries(context.rows.map(row => [row.context_type, row.raw_data]));
    const script = String(contextMap.script?.script || "");
    if (!script) throw new Error("RENDER_FAILED: script context is missing");

    const title = `${book} ${chapter}`;
    const subtitle = String(payload.translation || "Apex Studio");
    const draw = `drawtext=text='${escapeDrawtext(title)}':fontsize=72:fontcolor=white:x=(w-text_w)/2:y=420,drawtext=text='${escapeDrawtext(subtitle)}':fontsize=42:fontcolor=white:x=(w-text_w)/2:y=520`;

    await this.pool.query(`INSERT INTO apex_media_assets (episode_id, asset_type, file_path, status)
      VALUES ($1, 'final_render', $2, 'rendering')
      ON CONFLICT (episode_id, asset_type) WHERE asset_type = 'final_render'
      DO UPDATE SET file_path=EXCLUDED.file_path, status='rendering', error=NULL, updated_at=NOW()`, [episodeId, finalPath]);

    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "color=c=black:s=1920x1080:r=30",
        "-f", "lavfi", "-i", "anullsrc=r=48000:cl=stereo",
        "-vf", draw, "-t", "10",
        "-c:v", "libx264", "-preset", process.env.APEX_FFMPEG_PRESET || "veryfast",
        "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-shortest",
        "-movflags", "+faststart", "-y", tempPath
      ], { timeout: Math.max(30000, Number(process.env.APEX_RENDER_TIMEOUT_MS || 300000)) });

      const info = await stat(tempPath);
      if (!info.size) throw new Error("FFmpeg produced an empty output");
      await rename(tempPath, finalPath);
      const finalInfo = await stat(finalPath);
      const sha256 = await sha256File(finalPath);

      await this.pool.query(`UPDATE apex_media_assets SET status='completed', size_bytes=$2, sha256=$3,
        mime_type='video/mp4', duration_seconds=10, width=1920, height=1080, updated_at=NOW(), error=NULL
        WHERE episode_id=$1 AND asset_type='final_render'`, [episodeId, finalInfo.size, sha256]);
      await this.pool.query(`UPDATE apex_episode_pipelines SET status='rendered', updated_at=NOW() WHERE id=$1`, [episodeId]);

      return { episodeId, assetType: "final_render", status: "completed", filePath: finalPath,
        sizeBytes: finalInfo.size, sha256, durationSeconds: 10, width: 1920, height: 1080 };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query(`UPDATE apex_media_assets SET status='failed', error=$2, updated_at=NOW()
        WHERE episode_id=$1 AND asset_type='final_render'`, [episodeId, message.slice(0, 4000)]).catch(() => {});
      throw new Error(`RENDER_FAILED: ${message}`);
    }
  }
}

export default MediaRenderHandler;
