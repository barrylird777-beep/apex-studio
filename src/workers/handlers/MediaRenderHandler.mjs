import { log } from "../../core/resilience/load-shedder.mjs";
import { AudioWaveformSynthesizer } from "../../media/audio-waveform-synthesizer.mjs";
import { MultiGenreMusicGenerator } from "../../media/multi-genre-music-generator.mjs";
import { SceneVisualAssetManager } from "../../media/scene-visual-asset-manager.mjs";
import { KineticSubtitleOverlay } from "../../media/kinetic-subtitle-overlay.mjs";
import { MasterVideoComposer } from "../../media/master-video-composer.mjs";
import { rm } from "node:fs/promises";

function validId(value) {
  const id = String(value || "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new TypeError("Invalid episodeId");
  return id;
}

export class MediaRenderHandler {
  constructor(pool) {
    if (!pool) throw new TypeError("PostgreSQL pool is required");
    this.pool = pool;
    this.waveformSynthesizer = new AudioWaveformSynthesizer();
    this.musicGenerator = new MultiGenreMusicGenerator();
    this.visualManager = new SceneVisualAssetManager({ pool });
    this.subtitleOverlay = new KineticSubtitleOverlay();
    this.composer = new MasterVideoComposer();
  }

  async process(payload = {}) {
    const episodeId = validId(payload.episodeId);
    const book = String(payload.book || "").trim();
    const chapter = Number(payload.chapter);
    if (!book || !Number.isInteger(chapter) || chapter < 1) {
      throw new TypeError("book and positive integer chapter are required");
    }

    const result = await this.pool.query(
      `SELECT raw_data
         FROM apex_episode_context
        WHERE episode_id = $1 AND context_type = 'narrative_script'
        LIMIT 1`,
      [episodeId]
    );
    const scriptText = String(result.rows[0]?.raw_data?.script || "").trim();
    if (!scriptText) throw new Error("MEDIA_RENDER_FAILED: narrative_script context is missing");

    const durationSeconds = Math.max(1, Math.min(600, Number(payload.durationSeconds) || Math.max(15, Math.ceil(scriptText.length / 14))));
    log("info", "Media render started", { episode_id: episodeId, book, chapter, duration_seconds: durationSeconds });

    let audioPath = null, scorePath = null, visualPath = null, subtitlePath = null;
    try {
      const audio = await this.waveformSynthesizer.synthesizeWaveform(episodeId, scriptText);
      audioPath = audio.audioPath;
      const music = await this.musicGenerator.generateTrack(episodeId, book);
      scorePath = music.outputPath;
      visualPath = await this.visualManager.compileSceneVisualStream(episodeId, durationSeconds);
      subtitlePath = await this.subtitleOverlay.generateSubtitleFile(episodeId, scriptText, audio.durationSeconds);

      const master = await this.composer.composeMasterEpisode(
        episodeId, book, chapter, visualPath, audioPath, scorePath, subtitlePath
      );

      log("info", "Media render completed", { episode_id: episodeId, output_path: master.outputPath, synthetic_audio: Boolean(audio.synthetic), synthetic_music: Boolean(music.synthetic) });
      return { episodeId, ...master, syntheticAudio: Boolean(audio.synthetic), syntheticMusic: Boolean(music.synthetic) };
    } finally {
      await Promise.all([
        audioPath ? rm(audioPath, { force: true }).catch(() => {}) : null,
        scorePath ? rm(scorePath, { force: true }).catch(() => {}) : null,
        visualPath ? rm(visualPath, { force: true }).catch(() => {}) : null,
        subtitlePath ? rm(subtitlePath, { force: true }).catch(() => {}) : null
      ]);
    }
  }
}
export default MediaRenderHandler;
