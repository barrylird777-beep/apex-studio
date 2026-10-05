import { stat, rm } from "node:fs/promises";
import { createHash, createReadStream } from "node:crypto";
import { log } from "../../core/resilience/load-shedder.mjs";
import { AudioWaveformSynthesizer } from "../../media/audio-waveform-synthesizer.mjs";
import { MultiGenreMusicGenerator } from "../../media/multi-genre-music-generator.mjs";
import { SceneVisualAssetManager } from "../../media/scene-visual-asset-manager.mjs";
import { KineticSubtitleOverlay } from "../../media/kinetic-subtitle-overlay.mjs";
import { MasterVideoComposer } from "../../media/master-video-composer.mjs";
import { VideoQualityInspector } from "../../media/video-quality-inspector.mjs";

function episodeId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) throw new Error("MEDIA_RENDER_VALIDATION_ERROR: invalid episodeId");
  return id;
}
function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", chunk => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}
async function loadScript(pool, id) {
  const result = await pool.query(
    `SELECT raw_data FROM apex_episode_context WHERE episode_id=$1 AND context_type='script' LIMIT 1`, [id]
  );
  const script = String(result.rows[0]?.raw_data?.script || "").trim();
  if (!script) throw new Error("MEDIA_RENDER_FAILED: script context is missing");
  return script;
}

export class MediaRenderHandler {
  constructor(pool, { maxRetries = 3 } = {}) {
    if (!pool) throw new TypeError("MediaRenderHandler requires PostgreSQL");
    this.pool = pool;
    this.maxRetries = Math.max(1, Math.min(5, Number(maxRetries) || 3));
    this.waveformSynthesizer = new AudioWaveformSynthesizer();
    this.musicGenerator = new MultiGenreMusicGenerator();
    this.visualManager = new SceneVisualAssetManager({ pool });
    this.subtitleOverlay = new KineticSubtitleOverlay();
    this.composer = new MasterVideoComposer();
    this.qualityInspector = new VideoQualityInspector();
  }

  async process(payload = {}) {
    const id = episodeId(payload.episodeId);
    const book = String(payload.book || "").trim();
    const chapter = Number(payload.chapter);
    if (!book || !Number.isInteger(chapter) || chapter < 1) {
      throw new Error("MEDIA_RENDER_VALIDATION_ERROR: book and positive integer chapter are required");
    }

    const scriptText = await loadScript(this.pool, id);
    const durationHint = Number(payload.durationSeconds);
    const requestedDuration = Number.isFinite(durationHint) && durationHint > 0 ? Math.min(600, durationHint) : null;
    const intermediates = [];

    await this.pool.query(
      `INSERT INTO apex_media_assets (episode_id, asset_type, file_path, status)
       VALUES ($1,'final_render','PENDING','rendering')
       ON CONFLICT (episode_id, asset_type) WHERE asset_type='final_render'
       DO UPDATE SET file_path='PENDING', status='rendering', error=NULL, updated_at=NOW()`, [id]
    );

    try {
      log("info", "Media render started", { episode_id: id, book, chapter });

      const audio = await this.waveformSynthesizer.synthesizeWaveform(id, scriptText);
      intermediates.push(audio.audioPath);
      const duration = requestedDuration || audio.durationSeconds;

      const score = await this.musicGenerator.generateTrack(id, book);
      intermediates.push(score.outputPath);

      const visual = await this.visualManager.compileSceneVisualStream(id, duration);
      intermediates.push(visual);

      const subtitles = await this.subtitleOverlay.generateSubtitleFile(id, scriptText, duration);
      intermediates.push(subtitles);

      const master = await this.composer.composeMasterEpisode(
        id, book, chapter, visual, audio.audioPath, score.outputPath, subtitles
      );
      const qc = await this.qualityInspector.inspectMasterAsset(master.outputPath);
      const file = await stat(master.outputPath);
      const sha256 = await sha256File(master.outputPath);

      await this.pool.query(
        `UPDATE apex_media_assets
            SET file_path=$2,status='completed',mime_type='video/mp4',size_bytes=$3,sha256=$4,
                duration_seconds=$5,width=1920,height=1080,error=NULL,updated_at=NOW()
          WHERE episode_id=$1 AND asset_type='final_render'`,
        [id, master.outputPath, file.size, sha256, qc.durationSeconds]
      );
      await this.pool.query(
        `UPDATE apex_episode_pipelines SET status='rendered',updated_at=NOW() WHERE id=$1`, [id]
      );

      log("info", "Media render completed", { episode_id: id, output_path: master.outputPath, bytes: file.size, sha256 });
      return { episodeId: id, assetType: "final_render", status: "completed", outputPath: master.outputPath, sha256, sizeBytes: file.size, qc };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await this.pool.query(
        `UPDATE apex_media_assets SET status='failed',error=$2,updated_at=NOW()
         WHERE episode_id=$1 AND asset_type='final_render'`, [id, message.slice(0, 4000)]
      ).catch(() => {});
      log("error", "Media render failed", { episode_id: id, error: message });
      throw error;
    } finally {
      await Promise.all(intermediates.map(filePath => rm(filePath, { force: true }).catch(() => {})));
    }
  }
}
export default MediaRenderHandler;
