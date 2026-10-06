import { z } from "zod";

export const gardenReferenceSchema = z.object({
  id: z.string().min(1),
  type: z.string().min(1),
  graphVersion: z.string().min(1),
}).strict();

export const productionHandoffSchema = z.object({
  contractVersion: z.literal("apex-production-handoff.v1"),
  projectId: z.union([z.string(), z.number()]),
  episodeId: z.string().min(1),
  gardenPackage: z.object({
    graphVersion: z.string().min(1),
    packageHash: z.string().min(1),
    references: z.array(gardenReferenceSchema).min(1)
  }).strict(),
  artifact: z.object({
    kind: z.enum(["research","script","scene-plan","visual-plan","audio-plan","render-plan","master"]),
    version: z.string().min(1),
    contentHash: z.string().min(1)
  }).strict(),
  provenance: z.object({
    source: z.string().min(1),
    verified: z.boolean(),
    verifiedAt: z.string().datetime().optional()
  }).strict()
}).strict();

export function assertProductionHandoff(value) {
  return productionHandoffSchema.parse(value);
}

export function validateScriptGardenReferences(references, verifiedIds) {
  if (!Array.isArray(references)) throw new Error("Script Garden references must be an array");
  for (const reference of references) rejectUnverifiedGardenReference(reference, verifiedIds);
  return true;
}

export function rejectUnverifiedGardenReference(reference, verifiedIds) {
  const id = String(reference?.id || "");
  if (!verifiedIds.has(id)) throw new Error(`Unverified Garden reference rejected: ${id || "missing id"}`);
  return true;
}
