import { RenderWorker } from "../core/render-worker.mjs";
import { buildTimelineFfmpegPlan } from "../core/ffmpeg.mjs";
import { masterSoundtrack, masterFinalVideo } from "../core/mastering.mjs";
import { getApexApp } from "./apex-six-apps.mjs";

const APP = getApexApp("xshield");

export function createXShieldProcessor(options = {}) {
  const worker = new RenderWorker(options);
  return Object.freeze({
    app: { ...APP },
    async available() {
      return worker.available();
    },
    async render(job, plan) {
      if (!job || typeof job !== "object") throw new TypeError("Forge job is required");
      if (!plan || typeof plan !== "object") throw new TypeError("Forge render plan is required");
      return worker.render(job, plan);
    },
    timelinePlan(input = {}) {
      return buildTimelineFfmpegPlan(input);
    },
    async masterAudio(items, bgmPath, outputPath) {
      return masterSoundtrack(items, bgmPath, outputPath);
    },
    async masterVideo(videoPath, audioPath, outputPath, options = {}) {
      return masterFinalVideo(videoPath, audioPath, outputPath, options);
    },
    status() {
      return {
        app: { ...APP },
        renderer: "RenderWorker",
        ffmpeg: worker.ffmpegPath,
        outputDir: worker.outputDir,
        checkedAt: new Date().toISOString()
      };
    }
  });
}

export function xshieldStatus(options = {}) {
  const worker = new RenderWorker(options);
  return {
    app: { ...APP },
    renderer: "RenderWorker",
    ffmpeg: worker.ffmpegPath,
    outputDir: worker.outputDir,
    checkedAt: new Date().toISOString()
  };
}
