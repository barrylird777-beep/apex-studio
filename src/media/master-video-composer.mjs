import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, unlink, rename } from "node:fs/promises";
import { join, resolve, basename } from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../core/resilience/load-shedder.mjs";

const execFileAsync = promisify(execFile);

function episodeId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Invalid episodeId");
  return id;
}

function bibleBook(value) {
  const book = String(value || "").trim();
  if (!/^\p{L}[\p{L}\p{N} .'-]{0,79}$/u.test(book)) throw new TypeError("Invalid Bible book");
  return book;
}

function inputPath(value, name) {
  const p = resolve(String(value || ""));
  if (!p || basename(p).startsWith(".")) throw new TypeError(`Invalid ${name} path`);
  return p;
}

export class MasterVideoComposer {
  constructor({ outputDir = resolve(process.cwd(), ".apex", "master") } = {}) {
    this.outputDir = resolve(outputDir);
  }

  async composeMasterEpisode(idValue, bookValue, chapterValue, audioTrackPath, scoreTrackPath) {
    const id = episodeId(idValue);
    const book = bibleBook(bookValue);
    const chapter = Number(chapterValue);
    if (!Number.isInteger(chapter) || chapter < 1) throw new TypeError("Invalid chapter");

    const voicePath = inputPath(audioTrackPath, "audio track");
    const scorePath = inputPath(scoreTrackPath, "score track");
    await mkdir(this.outputDir, { recursive: true });

    const outputPath = join(this.outputDir, `master_episode_${id}.mp4`);
    const tempPath = join(this.outputDir, `.master_${id}.${randomUUID()}.tmp.mp4`);

    try {
      await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", voicePath
      ], { timeout: 30_000, maxBuffer: 64 * 1024 });

      await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", scorePath
      ], { timeout: 30_000, maxBuffer: 64 * 1024 });

      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", "color=c=0x0B0F19:s=1920x1080:r=30",
        "-i", voicePath,
        "-i", scorePath,
        "-filter_complex", "[1:a]volume=1.0[voice];[2:a]volume=0.4[music];[voice][music]amix=inputs=2:duration=first:dropout_transition=2:weights=1 0.4[aout]",
        "-map", "0:v:0",
        "-map", "[aout]",
        "-c:v", "libx264",
        "-preset", process.env.APEX_FFMPEG_PRESET || "veryfast",
        "-crf", "20",
        "-pix_fmt", "yuv420p",
        "-c:a", "aac",
        "-b:a", "192k",
        "-movflags", "+faststart",
        "-shortest",
        "-y", tempPath
      ], { timeout: 600_000, maxBuffer: 1024 * 1024 });

      const outputStat = await stat(tempPath);
      if (outputStat.size < 4096) throw new Error("Rendered master is empty or invalid");

      const probe = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=format_name,duration:stream=codec_type,width,height",
        "-of", "json",
        tempPath
      ], { timeout: 30_000, maxBuffer: 256 * 1024 });

      const metadata = JSON.parse(probe.stdout);
      const video = metadata.streams?.find((stream) => stream.codec_type === "video");
      const audio = metadata.streams?.find((stream) => stream.codec_type === "audio");
      if (!video || !audio || video.width !== 1920 || video.height !== 1080) {
        throw new Error("Master validation failed: expected 1920x1080 video and audio streams");
      }

      await unlink(outputPath).catch(() => {});
      await rename(tempPath, outputPath);

      log("info", "Master video composed and validated", {
        episode_id: id,
        book,
        chapter,
        output_path: outputPath,
        bytes: outputStat.size
      });

      return { outputPath, width: 1920, height: 1080, validated: true };
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      log("error", "Master video composition failed", {
        episode_id: id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}

export default MasterVideoComposer;
