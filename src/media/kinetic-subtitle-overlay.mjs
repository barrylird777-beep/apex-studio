import { mkdir, rm, rename } from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../core/resilience/load-shedder.mjs";

function uuid(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) {
    throw new TypeError("Invalid episodeId");
  }
  return id;
}

function positiveDuration(value) {
  const duration = Number(value);
  if (!Number.isFinite(duration) || duration <= 0 || duration > 86_400) {
    throw new RangeError("durationSeconds must be between 0 and 86400");
  }
  return duration;
}

function escapeSrt(text) {
  return String(text)
    .replace(/\r?\n/g, " ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
}

export class KineticSubtitleOverlay {
  constructor({ outputDir = resolve(process.cwd(), ".apex", "subtitles") } = {}) {
    this.outputDir = resolve(outputDir);
  }

  async generateSubtitleFile(episodeIdValue, scriptText, durationSeconds = 30) {
    const episodeId = uuid(episodeIdValue);
    const script = String(scriptText || "").trim();
    if (!script) throw new TypeError("scriptText is required");
    if (script.length > 2_000_000) throw new RangeError("scriptText exceeds maximum size");

    const duration = positiveDuration(durationSeconds);
    await mkdir(this.outputDir, { recursive: true });

    const sentences = script
      .replace(/\s+/g, " ")
      .split(/(?<=[.!?])\s+/)
      .map(escapeSrt)
      .filter(Boolean);

    const segments = sentences.length ? sentences : [escapeSrt(script)];
    const totalWords = segments.reduce((sum, segment) => sum + segment.split(/\s+/).filter(Boolean).length, 0);
    let cursor = 0;
    const rows = [];

    for (let index = 0; index < segments.length; index += 1) {
      const words = segments[index].split(/\s+/).filter(Boolean).length;
      const remainingWords = Math.max(1, totalWords - cursor);
      const remainingTime = Math.max(0, duration - (rows.length ? rows.at(-1).end : 0));
      const segmentDuration = index === segments.length - 1
        ? remainingTime
        : Math.max(0.75, remainingTime * (words / remainingWords));
      const start = index === 0 ? 0 : rows[index - 1].end;
      const end = Math.min(duration, start + segmentDuration);
      rows.push({ text: segments[index], start, end });
      cursor += words;
    }

    const format = (seconds) => {
      const ms = Math.min(999, Math.max(0, Math.round(seconds * 1000)));
      const hours = Math.floor(ms / 3_600_000);
      const minutes = Math.floor((ms % 3_600_000) / 60_000);
      const secs = Math.floor((ms % 60_000) / 1000);
      const millis = ms % 1000;
      return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")},${String(millis).padStart(3,"0")}`;
    };

    const content = rows.map((row, index) =>
      `${index + 1}\n${format(row.start)} --> ${format(row.end)}\n${row.text}\n`
    ).join("\n");

    const finalPath = join(this.outputDir, `subtitles_${episodeId}.srt`);
    const tempPath = join(this.outputDir, `.subtitles_${episodeId}.${randomUUID()}.tmp`);

    try {
      await import("node:fs/promises").then((fs) => fs.writeFile(tempPath, content, { encoding: "utf8", mode: 0o600 }));
      await rename(tempPath, finalPath);
      log("info", "Subtitle file generated", { episode_id: episodeId, segments: rows.length, path: finalPath });
      return finalPath;
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      log("error", "Subtitle generation failed", { episode_id: episodeId, error: error instanceof Error ? error.message : String(error) });
      throw new Error(`SUBTITLE_GENERATION_FAILED: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  formatSrtTimestamp(seconds) {
    const value = Math.max(0, Number(seconds) || 0);
    const ms = Math.round(value * 1000);
    const hours = Math.floor(ms / 3_600_000);
    const minutes = Math.floor((ms % 3_600_000) / 60_000);
    const secs = Math.floor((ms % 60_000) / 1000);
    const millis = ms % 1000;
    return `${String(hours).padStart(2,"0")}:${String(minutes).padStart(2,"0")}:${String(secs).padStart(2,"0")},${String(millis).padStart(3,"0")}`;
  }
}

export default KineticSubtitleOverlay;
