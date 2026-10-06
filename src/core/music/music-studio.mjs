import crypto from "node:crypto";
import { z } from "zod";
import { AUDIO_PRODUCTION_ROLES, normalizeContentDomain } from "../content/content-domains.mjs";
import { musicAssetChecksum } from "./music-radar-contract.mjs";

export const MUSIC_GENRES = Object.freeze([
  "cinematic","dark-fantasy","orchestral","ambient","rock","metal","hip-hop",
  "electronic","folk","gospel","worship","epic","trap","jazz","classical"
]);

export const musicTrackSchema = z.object({
  trackId: z.string().min(1),
  projectId: z.string().min(1),
  title: z.string().min(1),
  role: z.enum(AUDIO_PRODUCTION_ROLES),
  contentDomain: z.enum(["bible","korn","original"]),
  genre: z.array(z.string()).default([]),
  mood: z.array(z.string()).default([]),
  bpm: z.number().positive().optional(),
  durationSeconds: z.number().nonnegative().optional(),
  gardenPackage: z.object({
    system: z.literal("garden-of-apex"),
    graphVersion: z.string().min(1),
    packageHash: z.string().min(1),
    references: z.array(z.string()).min(1)
  }).optional(),
  sourceAsset: z.object({
    assetId: z.string().min(1),
    checksum: z.string().min(1),
    url: z.string().min(1).optional(),
    path: z.string().min(1).optional()
  }).optional(),
  provenance: z.object({
    source: z.enum(["music-radar","studio","garden"]),
    sourceId: z.string().min(1).optional(),
    sourceVersion: z.string().min(1).optional()
  }).strict()
}).strict();

export function createMusicTrack(input = {}) {
  const domain = normalizeContentDomain(input.contentDomain);
  if (domain === "korn" && !input.gardenPackage) {
    throw new Error("Korn music requires a verified Garden of Apex package");
  }
  const track = {
    trackId: String(input.trackId || crypto.randomUUID()),
    projectId: String(input.projectId || crypto.randomUUID()),
    title: String(input.title || "Untitled"),
    role: String(input.role || "music"),
    contentDomain: domain,
    genre: Array.isArray(input.genre) ? input.genre.map(String) : [],
    mood: Array.isArray(input.mood) ? input.mood.map(String) : [],
    bpm: input.bpm == null ? undefined : Number(input.bpm),
    durationSeconds: input.durationSeconds == null ? undefined : Number(input.durationSeconds),
    gardenPackage: input.gardenPackage,
    sourceAsset: input.sourceAsset,
    provenance: {
      source: input.provenance?.source || "studio",
      sourceId: input.provenance?.sourceId,
      sourceVersion: input.provenance?.sourceVersion
    }
  };
  return musicTrackSchema.parse(track);
}

export function buildMusicProductionPlan(input = {}) {
  const domain = normalizeContentDomain(input.contentDomain);
  const tracks = (Array.isArray(input.tracks) ? input.tracks : []).map(createMusicTrack);
  if (domain === "korn" && !input.gardenPackage) {
    throw new Error("Korn music production requires a Garden package");
  }
  return {
    contractVersion: "apex-music-production.v1",
    projectId: String(input.projectId || crypto.randomUUID()),
    contentDomain: domain,
    gardenPackage: domain === "korn" ? input.gardenPackage : (input.gardenPackage || null),
    musicalIntent: {
      genre: Array.isArray(input.genre) ? input.genre : [],
      fusion: Array.isArray(input.fusion) ? input.fusion : [],
      mood: Array.isArray(input.mood) ? input.mood : [],
      christianMode: input.christianMode === true,
      purpose: input.purpose || "full-audio"
    },
    tracks,
    roles: [...AUDIO_PRODUCTION_ROLES],
    createdAt: new Date().toISOString()
  };
}

export function verifyMusicGardenPackage(plan, verifiedGardenIds = []) {
  if (plan.contentDomain !== "korn") return { verified: true, references: [] };
  const pkg = plan.gardenPackage;
  if (!pkg?.graphVersion || !pkg.packageHash || !Array.isArray(pkg.references) || !pkg.references.length) {
    throw new Error("Korn music plan has no complete Garden package");
  }
  const missing = pkg.references.filter(id => !verifiedGardenIds.includes(id));
  if (missing.length) throw new Error("Unverified Garden music references: " + missing.join(", "));
  return { verified: true, references: pkg.references };
}

export function buildMusicPrompt({ title, genre = [], mood = [], fusion = [], purpose = "film-score", gardenPackage = null } = {}) {
  const world = gardenPackage
    ? `Garden package ${gardenPackage.graphVersion} / ${gardenPackage.packageHash}; references: ${gardenPackage.references.join(", ")}.`
    : "No Garden package; do not invent Garden canon.";
  return [
    "Apex Music production brief.",
    `Title: ${String(title || "Untitled")}.`,
    `Genre: ${genre.join(", ") || "cinematic"}.`,
    `Fusion: ${fusion.join(", ") || "none"}.`,
    `Mood: ${mood.join(", ") || "cinematic"}.`,
    `Purpose: ${purpose}.`,
    world,
    "Preserve continuity and provenance. Do not invent world facts."
  ].join(" ");
}

export function registerMusicAsset({ buffer, ...input } = {}) {
  if (!buffer && !input.checksum) throw new Error("Music asset requires bytes or checksum");
  return {
    assetId: String(input.assetId || crypto.randomUUID()),
    checksum: String(input.checksum || musicAssetChecksum(buffer)),
    kind: input.kind || "music",
    title: String(input.title || "Untitled"),
    format: String(input.format || "wav"),
    durationSeconds: input.durationSeconds == null ? undefined : Number(input.durationSeconds),
    mediaUrl: input.mediaUrl,
    localPath: input.localPath,
    provenance: {
      source: input.provenance?.source || "studio",
      sourceId: input.provenance?.sourceId,
      sourceVersion: input.provenance?.sourceVersion
    }
  };
}
