import { access, mkdir, rm, rename, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { log } from "../core/resilience/load-shedder.mjs";

const execFileAsync = promisify(execFile);

function idOf(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Invalid episodeId");
  return id;
}

function durationOf(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || n > 86_400) throw new RangeError("Invalid durationSeconds");
  return n;
}

function pathOf(value, name) {
  const p = resolve(String(value || ""));
  if (!p) throw new TypeError(`Invalid ${name} path`);
  return p;
}

function concatEntry(filePath) {
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

export class SceneVisualAssetManager {
  constructor({ pool, workspaceDir = resolve(process.cwd(), ".apex", "scenes") } = {}) {
    if (!pool) throw new TypeError("PostgreSQL pool is required");
    this.pool = pool;
    this.workspaceDir = resolve(workspaceDir);
  }

  async compileSceneVisualStream(episodeIdValue, durationSeconds = 30) {
    const episodeId = idOf(episodeIdValue);
    const targetDuration = durationOf(durationSeconds);
    await mkdir(this.workspaceDir, { recursive: true });

    const result = await this.pool.query(
      `SELECT raw_data
         FROM apex_episode_context
        WHERE episode_id = $1 AND context_type = 'scene_manifest'
        LIMIT 1`,
      [episodeId]
    );

    const rawScenes = result.rows[0]?.raw_data?.scenes;
    const scenes = Array.isArray(rawScenes) ? rawScenes.filter(Boolean) : [];
    const count = Math.max(1, scenes.length);
    const defaultDuration = targetDuration / count;
    const clips = [];

    try {
      if (scenes.length === 0) {
        clips.push(await this.resolveOrGenerateSceneClip(episodeId, 0, null, "cinematic scripture scene", targetDuration));
      } else {
        for (let i = 0; i < scenes.length; i += 1) {
          const scene = scenes[i];
          const sceneDuration = Math.max(0.25, Number(scene.duration) || defaultDuration);
          clips.push(await this.resolveOrGenerateSceneClip(
            episodeId,
            i,
            scene.visualPath ?? scene.assetPath ?? null,
            scene.prompt ?? scene.description ?? "",
            sceneDuration
          ));
        }
      }

      const concatPath = join(this.workspaceDir, `.concat_${episodeId}.${randomUUID()}.txt`);
      const outputPath = join(this.workspaceDir, `scenes_${episodeId}.mp4`);
      const tempOutput = join(this.workspaceDir, `.scenes_${episodeId}.${randomUUID()}.tmp.mp4`);

      await writeFile(concatPath, clips.map(concatEntry).join("\n") + "\n", { mode: 0o600 });

      try {
        await execFileAsync("ffmpeg", [
          "-hide_banner", "-loglevel", "error",
          "-f", "concat", "-safe", "0", "-i", concatPath,
          "-an",
          "-c:v", "libx264", "-preset", process.env.APEX_FFMPEG_PRESET || "veryfast",
          "-crf", "20", "-pix_fmt", "yuv420p", "-r", "30",
          "-movflags", "+faststart", "-y", tempOutput
        ], { timeout: 300_000, maxBuffer: 1024 * 1024 });

        await execFileAsync("ffprobe", [
          "-v", "error", "-select_streams", "v:0",
          "-show_entries", "stream=width,height:format=duration",
          "-of", "json", tempOutput
        ], { timeout: 30_000, maxBuffer: 256 * 1024 });

        await rm(outputPath, { force: true });
        await rename(tempOutput, outputPath);
        log("info", "Scene visual stream compiled", { episode_id: episodeId, scenes: clips.length, output_path: outputPath });
        return outputPath;
      } finally {
        await rm(tempOutput, { force: true }).catch(() => {});
        await rm(concatPath, { force: true }).catch(() => {});
      }
    } catch (error) {
      log("error", "Scene visual compilation failed", {
        episode_id: episodeId,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`SCENE_VISUAL_COMPILATION_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  async resolveOrGenerateSceneClip(episodeIdValue, index, assetPath, prompt, duration) {
    const episodeId = idOf(episodeIdValue);
    const seconds = durationOf(duration);
    if (assetPath) {
      const candidate = pathOf(assetPath, "visual asset");
      try {
        await access(candidate);
        return candidate;
      } catch {
        log("warn", "Scene asset missing; using procedural fallback", { episode_id: episodeId, index, path: candidate });
      }
    }

    const outputPath = join(this.workspaceDir, `scene_${episodeId}_${index}.mp4`);
    const tempPath = join(this.workspaceDir, `.scene_${episodeId}_${index}.${randomUUID()}.tmp.mp4`);
    const colors = ["0x0B0F19", "0x1A1F2C", "0x111827", "0x0F172A"];
    const color = colors[index % colors.length];

    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", `color=c=${color}:s=1920x1080:r=30:d=${seconds}`,
        "-an", "-c:v", "libx264", "-preset", "ultrafast", "-crf", "22",
        "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-y", tempPath
      ], { timeout: 60_000, maxBuffer: 512 * 1024 });
      await rm(outputPath, { force: true });
      await rename(tempPath, outputPath);
      log("warn", "Procedural scene fallback generated", { episode_id: episodeId, index, prompt: String(prompt || "").slice(0, 200) });
      return outputPath;
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      throw error;
    }
  }
}

export default SceneVisualAssetManager;
