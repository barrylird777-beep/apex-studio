import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, stat, unlink, rename } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { log } from "../core/resilience/load-shedder.mjs";

const execFileAsync = promisify(execFile);

const GENRES = Object.freeze({
  epic_orchestral: { source: "sine=frequency=110:sample_rate=44100:duration=15", filter: "chorus=0.5:0.9:55:0.4:0.25:2" },
  ambient_meditative: { source: "anoisesrc=d=15:c=pink:r=44100", filter: "lowpass=f=300,volume=0.4" },
  cinematic_choral: { source: "sine=frequency=130.81:sample_rate=44100:duration=15", filter: "flanger=delay=5:depth=2:regen=50:width=71" },
  lofi_acoustic: { source: "sine=frequency=196:sample_rate=44100:duration=15", filter: "highpass=f=200,lowpass=f=2500,volume=0.6" },
  electronic_synthwave: { source: "sine=frequency=146.83:sample_rate=44100:duration=15", filter: "vibrato=f=4:d=0.5,volume=0.5" },
  gospel_soul: { source: "sine=frequency=220:sample_rate=44100:duration=15", filter: "treble=g=5,volume=0.7" },
  industrial_apocalyptic: { source: "sine=frequency=65.41:sample_rate=44100:duration=15", filter: "distortion=gain=20,lowpass=f=1200" }
});

function safeEpisodeId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Invalid episodeId");
  return id;
}

function safeBook(value) {
  const book = String(value || "").trim();
  if (!/^\p{L}[\p{L}\p{N} .'-]{0,79}$/u.test(book)) throw new TypeError("Invalid Bible book");
  return book;
}

export class MultiGenreMusicGenerator {
  constructor({ outputDir = resolve(process.cwd(), ".apex", "music") } = {}) {
    this.outputDir = resolve(outputDir);
  }

  async generateTrack(episodeId, book, requestedGenre = null) {
    const id = safeEpisodeId(episodeId);
    const safeBookName = safeBook(book);
    const genre = GENRES[requestedGenre] ? requestedGenre : this.inferGenreFromBook(safeBookName);
    const profile = GENRES[genre];

    await mkdir(this.outputDir, { recursive: true });

    const outputPath = join(this.outputDir, `score_${genre}_${id}.wav`);
    const tempPath = join(this.outputDir, `.score_${id}.${randomUUID()}.tmp.wav`);

    try {
      await execFileAsync("ffmpeg", [
        "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", profile.source,
        "-af", `${profile.filter},aformat=sample_fmts=s16:sample_rates=44100:channel_layouts=stereo`,
        "-t", "15", "-ac", "2", "-ar", "44100", "-c:a", "pcm_s16le",
        "-y", tempPath
      ], { timeout: 120_000, maxBuffer: 1024 * 1024 });

      const info = await stat(tempPath);
      if (info.size <= 44) throw new Error("Generated music file is empty or invalid");

      await execFileAsync("ffprobe", [
        "-v", "error", "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1", tempPath
      ], { timeout: 30_000, maxBuffer: 64 * 1024 });

      await unlink(outputPath).catch(() => {});
      await rename(tempPath, outputPath);

      log("info", "Synthetic music bed generated", {
        episode_id: id,
        book: safeBookName,
        genre,
        duration_seconds: 15
      });

      return { genre, outputPath, durationSeconds: 15, synthetic: true };
    } catch (error) {
      await unlink(tempPath).catch(() => {});
      log("error", "Music generation failed", {
        episode_id: id,
        genre,
        error: error instanceof Error ? error.message : String(error)
      });
      throw error;
    }
  }

  inferGenreFromBook(book) {
    const apocalyptic = new Set(["Revelation", "Daniel", "Ezekiel"]);
    const wisdom = new Set(["Psalms", "Proverbs", "Ecclesiastes", "Job", "Song of Solomon"]);
    const prophetic = new Set(["Isaiah", "Jeremiah", "Lamentations", "Amos", "Habakkuk"]);
    const gospels = new Set(["Matthew", "Mark", "Luke", "John"]);

    if (apocalyptic.has(book)) return "industrial_apocalyptic";
    if (wisdom.has(book)) return "ambient_meditative";
    if (prophetic.has(book)) return "cinematic_choral";
    if (gospels.has(book)) return "gospel_soul";
    return "epic_orchestral";
  }
}

export default MultiGenreMusicGenerator;
