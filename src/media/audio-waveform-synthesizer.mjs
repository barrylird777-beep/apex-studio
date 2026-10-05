import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../core/resilience/load-shedder.mjs";

const execFileAsync = promisify(execFile);

function safeEpisodeId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Invalid episodeId");
  return id;
}

function safeScript(value) {
  const text = String(value ?? "").trim();
  if (!text) throw new TypeError("scriptText is required");
  if (text.length > 2_000_000) throw new RangeError("scriptText is too large");
  return text;
}

export class AudioWaveformSynthesizer {
  constructor({ outputDir = resolve(process.cwd(), ".apex", "audio") } = {}) {
    this.outputDir = resolve(outputDir);
  }

  async synthesizeWaveform(episodeId, scriptText) {
    const id = safeEpisodeId(episodeId);
    const text = safeScript(scriptText);
    await mkdir(this.outputDir, { recursive: true });

    const finalPath = join(this.outputDir, `audio_${id}.wav`);
    const tempPath = join(this.outputDir, `.audio_${id}.${randomUUID()}.tmp.wav`);

    try {
      // This is a deterministic audio-bed generator, not a TTS engine.
      // Real narration must be supplied by a voice provider before final mastering.
      const duration = Math.max(1, Math.min(600, Math.ceil(text.length / 14)));
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi",
        "-i", `sine=frequency=440:sample_rate=44100:duration=${duration}`,
        "-ac", "2",
        "-ar", "44100",
        "-c:a", "pcm_s16le",
        "-y", tempPath
      ], { timeout: 120_000, maxBuffer: 1024 * 1024 });

      const info = await stat(tempPath);
      if (info.size <= 44) throw new Error("Generated WAV is empty or invalid");

      await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        tempPath
      ], { timeout: 30_000, maxBuffer: 64 * 1024 });

      await unlink(finalPath).catch(() => {});
      const { rename } = await import("node:fs/promises");
      await rename(tempPath, finalPath);

      const waveformData = this.generateWaveformPoints(duration, 120);

      log("info", "Audio bed synthesized", {
        episode_id: id,
        duration_seconds: duration,
        waveform_points: waveformData.length
      });

      return { audioPath: finalPath, durationSeconds: duration, waveformData, synthetic: true };
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      log("error", "Audio synthesis failed", {
        episode_id: id,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  generateWaveformPoints(durationSeconds, count = 120) {
    const total = Math.max(1, Math.min(2000, Math.floor(Number(count) || 120)));
    const duration = Math.max(1, Number(durationSeconds) || 1);
    return Array.from({ length: total }, (_, index) => {
      const t = index / Math.max(1, total - 1);
      return Number((0.12 + 0.76 * Math.abs(Math.sin(t * Math.PI * 8) * Math.cos(t * Math.PI * 3))).toFixed(4));
    });
  }
}

export default AudioWaveformSynthesizer;
