import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { stat } from "node:fs/promises";
import { resolve } from "node:path";
import { log } from "../core/resilience/load-shedder.mjs";

const execFileAsync = promisify(execFile);

function numberEnv(name, fallback, min, max) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
}

export class VideoQualityInspector {
  async inspectMasterAsset(filePath) {
    const assetPath = resolve(String(filePath || ""));
    if (!assetPath || assetPath === resolve(process.cwd())) {
      throw new TypeError("A concrete video asset path is required");
    }

    try {
      const file = await stat(assetPath);
      if (!file.isFile() || file.size < 4096) {
        throw new Error("QC_FAILURE: Asset is missing, not a file, or too small.");
      }

      const probe = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format=format_name,duration,size:stream=index,codec_type,codec_name,width,height,pix_fmt,duration",
        "-of", "json",
        assetPath
      ], { timeout: 30_000, maxBuffer: 512 * 1024 });

      const data = JSON.parse(probe.stdout);
      const video = data.streams?.find((stream) => stream.codec_type === "video");
      const audio = data.streams?.find((stream) => stream.codec_type === "audio");

      if (!video) throw new Error("QC_FAILURE: No valid video stream detected.");
      if (!audio) throw new Error("QC_FAILURE: No audio stream detected.");
      if (video.width !== 1920 || video.height !== 1080) {
        throw new Error(`QC_FAILURE: Invalid resolution ${video.width}x${video.height}; expected 1920x1080.`);
      }

      const duration = Number(data.format?.duration ?? video.duration ?? 0);
      if (!Number.isFinite(duration) || duration <= 0) {
        throw new Error("QC_FAILURE: Missing or invalid media duration.");
      }

      const maxDuration = numberEnv("APEX_QC_MAX_DURATION_SECONDS", 3600, 1, 86_400);
      if (duration > maxDuration) {
        throw new Error(`QC_FAILURE: Duration ${duration.toFixed(2)}s exceeds configured maximum ${maxDuration}s.`);
      }

      const blackDuration = numberEnv("APEX_QC_BLACK_MAX_SECONDS", 3, 0, 60);
      const silenceDuration = numberEnv("APEX_QC_SILENCE_MAX_SECONDS", 5, 0, 60);
      const blackRatio = numberEnv("APEX_QC_BLACK_RATIO", 0.98, 0.5, 1);
      const silenceNoise = numberEnv("APEX_QC_SILENCE_NOISE_DB", -50, -100, 0);

      const blackProbe = await execFileAsync("ffmpeg", [
        "-hide_banner", "-nostats", "-i", assetPath,
        "-vf", `blackdetect=d=${blackDuration}:pix_th=${blackRatio}`,
        "-an", "-f", "null", "-"
      ], { timeout: 120_000, maxBuffer: 1024 * 1024 }).catch((error) => {
        throw new Error(`Black-screen analysis failed: ${error?.message || error}`);
      });

      const blackMatches = [...String(blackProbe.stderr || "").matchAll(/black_duration:([0-9.]+)/g)]
        .map((match) => Number(match[1]))
        .filter(Number.isFinite);

      const maxBlack = blackMatches.length ? Math.max(...blackMatches) : 0;
      if (maxBlack > blackDuration) {
        throw new Error(`QC_FAILURE: Excessive black-screen interval detected (${maxBlack.toFixed(2)}s).`);
      }

      const silenceProbe = await execFileAsync("ffmpeg", [
        "-hide_banner", "-nostats", "-i", assetPath,
        "-vn", "-af", `silencedetect=noise=${silenceNoise}dB:d=${silenceDuration}`,
        "-f", "null", "-"
      ], { timeout: 120_000, maxBuffer: 1024 * 1024 }).catch((error) => {
        throw new Error(`Silence analysis failed: ${error?.message || error}`);
      });

      const silenceMatches = [...String(silenceProbe.stderr || "").matchAll(/silence_duration:([0-9.]+)/g)]
        .map((match) => Number(match[1]))
        .filter(Number.isFinite);

      const maxSilence = silenceMatches.length ? Math.max(...silenceMatches) : 0;
      if (maxSilence > silenceDuration) {
        throw new Error(`QC_FAILURE: Excessive audio silence detected (${maxSilence.toFixed(2)}s).`);
      }

      const result = {
        passed: true,
        resolution: `${video.width}x${video.height}`,
        codec: video.codec_name || null,
        pixelFormat: video.pix_fmt || null,
        audioCodec: audio.codec_name || null,
        durationSeconds: duration,
        maxBlackIntervalSeconds: maxBlack,
        maxSilenceIntervalSeconds: maxSilence,
        bytes: file.size
      };

      log("info", "Video QC passed", { file_path: assetPath, ...result });
      return result;
    } catch (error) {
      log("error", "Video QC rejected asset", {
        file_path: assetPath,
        error: error instanceof Error ? error.message : String(error)
      });
      throw new Error(`QC_INSPECTION_REJECTED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export default VideoQualityInspector;
