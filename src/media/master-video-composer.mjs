import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, unlink, rename, access } from "node:fs/promises";
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
async function requireFile(value, name) {
  const p = inputPath(value, name);
  await access(p);
  return p;
}
function subtitleFilter(filePath) {
  return `subtitles=filename='${String(filePath).replace(/\\/g, "\\\\").replace(/'/g, "'\\\\\\''").replace(/:/g, "\\\:")}'`;
}

export class MasterVideoComposer {
  constructor({ outputDir = resolve(process.cwd(), ".apex", "master") } = {}) {
    this.outputDir = resolve(outputDir);
  }

  async composeMasterEpisode(idValue, bookValue, chapterValue, visualStreamPath, audioTrackPath, scoreTrackPath, subtitlePath = null) {
    const id = episodeId(idValue);
    const book = bibleBook(bookValue);
    const chapter = Number(chapterValue);
    if (!Number.isInteger(chapter) || chapter < 1) throw new TypeError("Invalid chapter");

    const visual = await requireFile(visualStreamPath, "visual stream");
    const voice = await requireFile(audioTrackPath, "audio track");
    const score = await requireFile(scoreTrackPath, "score track");
    const subtitles = subtitlePath ? await requireFile(subtitlePath, "subtitle file") : null;

    await mkdir(this.outputDir, { recursive: true });
    const outputPath = join(this.outputDir, `master_episode_${id}.mp4`);
    const tempPath = join(this.outputDir, `.master_${id}.${randomUUID()}.tmp.mp4`);

    try {
      const args = [
        "-hide_banner", "-loglevel", "error",
        "-i", visual,
        "-i", voice,
        "-stream_loop", "-1", "-i", score
      ];

      const filters = [
        "[0:v]scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1[v0]",
        "[1:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=1.0[voice]",
        "[2:a]aformat=sample_rates=48000:channel_layouts=stereo,volume=0.35[music]",
        "[voice][music]amix=inputs=2:duration=first:dropout_transition=2:weights=1 0.35[aout]"
      ];
      let videoMap = "[v0]";
      if (subtitles) {
        filters.push(`[v0]${subtitleFilter(subtitles)}[vout]`);
        videoMap = "[vout]";
      }

      args.push(
        "-filter_complex", filters.join(";"),
        "-map", videoMap,
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
      );

      await execFileAsync("ffmpeg", args, {
        timeout: Math.max(60_000, Number(process.env.APEX_MASTER_RENDER_TIMEOUT_MS || 600_000)),
        maxBuffer: 2 * 1024 * 1024
      });

      const outputStat = await stat(tempPath);
      if (outputStat.size < 4096) throw new Error("Rendered master is empty or invalid");

      const probe = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=format_name,duration:stream=codec_type,width,height,pix_fmt,codec_name",
        "-of", "json",
        tempPath
      ], { timeout: 30_000, maxBuffer: 256 * 1024 });

      const metadata = JSON.parse(probe.stdout);
      const videoStream = metadata.streams?.find((stream) => stream.codec_type === "video");
      const audioStream = metadata.streams?.find((stream) => stream.codec_type === "audio");
      const duration = Number(metadata.format?.duration || 0);
      if (!videoStream || !audioStream || videoStream.width !== 1920 || videoStream.height !== 1080 || !Number.isFinite(duration) || duration <= 0) {
        throw new Error("Master validation failed: expected 1920x1080 video, audio, and positive duration");
      }

      await unlink(outputPath).catch(() => {});
      await rename(tempPath, outputPath);

      log("info", "Master video composed and validated", {
        episode_id: id, book, chapter, output_path: outputPath,
        bytes: outputStat.size, duration_seconds: duration,
        subtitles: Boolean(subtitles)
      });
      return { outputPath, width: 1920, height: 1080, durationSeconds: duration, validated: true };
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      log("error", "Master video composition failed", {
        episode_id: id, error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }
}
export default MasterVideoComposer;
