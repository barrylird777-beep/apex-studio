import { createHash } from "node:crypto";

const STYLE_LOCK = Object.freeze([
  "1990s dark fantasy anime",
  "sharp hand-painted cel shading",
  "deep cinematic shadows",
  "high-contrast theatrical lighting",
  "dense atmospheric perspective",
  "detailed ink linework",
  "textured painted backgrounds",
  "dynamic film composition",
  "16:9 widescreen",
  "24 fps cinematic keyframe"
]);

function clean(value, max = 1200) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

export function buildVisualPrompt({
  subject,
  action,
  environment,
  camera = "cinematic medium-wide shot",
  lighting = "volumetric rim light with deep shadow",
  palette = [],
  aspectRatio = "16:9",
  negative = ["3d render", "photorealism", "plastic CGI", "watermark", "text"]
} = {}) {
  const prompt = [
    clean(subject),
    clean(action),
    clean(environment),
    `camera: ${clean(camera, 300)}`,
    `lighting: ${clean(lighting, 300)}`,
    `palette: ${palette.map(clean).join(", ")}`,
    `aspect ratio: ${clean(aspectRatio, 20)}`,
    STYLE_LOCK.join(", "),
    `avoid: ${negative.map(clean).join(", ")}`
  ].filter(Boolean).join(", ");

  return prompt.slice(0, 4000);
}

export function hashPrompt(prompt) {
  return createHash("sha256").update(String(prompt), "utf8").digest("hex");
}

export const DARK_ANIME_STYLE_LOCK = STYLE_LOCK;
