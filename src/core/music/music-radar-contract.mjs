import crypto from "node:crypto";
import { z } from "zod";
import { AUDIO_PRODUCTION_ROLES, normalizeContentDomain } from "../content/content-domains.mjs";

export const musicRadarAssetSchema = z.object({
  assetId: z.string().min(1),
  kind: z.enum(AUDIO_PRODUCTION_ROLES),
  title: z.string().min(1),
  format: z.string().min(1),
  durationSeconds: z.number().nonnegative().optional(),
  mediaUrl: z.string().min(1).optional(),
  localPath: z.string().min(1).optional(),
  checksum: z.string().min(1),
  provenance: z.object({
    source: z.enum(["music-radar", "studio", "garden"]),
    sourceId: z.string().min(1).optional(),
    sourceVersion: z.string().min(1).optional()
  }).strict()
}).strict();

export const musicRadarHandoffSchema = z.object({
  contractVersion: z.literal("music-radar-studio-handoff.v1"),
  projectId: z.string().min(1),
  contentDomain: z.enum(["bible", "korn", "original"]),
  worldPackage: z.object({
    system: z.enum(["garden-of-apex", "none"]),
    graphVersion: z.string().min(1).optional(),
    packageHash: z.string().min(1).optional(),
    references: z.array(z.string()).default([])
  }).strict(),
  musicalIntent: z.object({
    genre: z.array(z.string()).default([]),
    fusion: z.array(z.string()).default([]),
    mood: z.array(z.string()).default([]),
    christianMode: z.boolean().default(false),
    purpose: z.enum(["film-score", "song", "narration", "dialogue", "ambience", "sfx", "full-audio"]).default("full-audio")
  }).strict(),
  assets: z.array(musicRadarAssetSchema).default([]),
  provenance: z.object({
    verified: z.boolean(),
    source: z.literal("Music Radar"),
    exportedAt: z.string().datetime()
  }).strict()
}).strict();

export function createMusicRadarHandoff(input = {}) {
  const contentDomain = normalizeContentDomain(input.contentDomain);
  const assets = Array.isArray(input.assets) ? input.assets : [];
  const handoff = musicRadarHandoffSchema.parse({
    contractVersion: "music-radar-studio-handoff.v1",
    projectId: String(input.projectId || crypto.randomUUID()),
    contentDomain,
    worldPackage: input.worldPackage || {
      system: "none",
      references: []
    },
    musicalIntent: input.musicalIntent || {},
    assets,
    provenance: {
      verified: input.provenance?.verified === true,
      source: "Music Radar",
      exportedAt: input.provenance?.exportedAt || new Date().toISOString()
    }
  });
  return handoff;
}

export function musicAssetChecksum(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}
