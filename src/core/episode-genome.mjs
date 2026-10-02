import { uid, now } from "./id.mjs";

export const GENOME_VERSION = "1.1.0";

const arr = value => Array.isArray(value) ? value : [];
const clean = value => String(value ?? "").trim();

export function createEpisodeGenome(input = {}) {
  return {
    id: input.id ?? uid("genome"),
    version: GENOME_VERSION,
    episodeId: clean(input.episodeId),
    sourceRefs: arr(input.sourceRefs),
    story: {
      hook: clean(input.hook),
      stakes: clean(input.stakes),
      escalation: clean(input.escalation),
      reversal: clean(input.reversal),
      payoff: clean(input.payoff)
    },
    production: {
      sceneCount: arr(input.scenes).length,
      shotCount: arr(input.storyboard).length,
      characterCount: arr(input.characters).length,
      locationCount: arr(input.locations).length,
      audioTrackCount: arr(input.audio).length
    },
    quality: {
      readiness: input.readiness ?? null,
      continuity: input.continuity ?? null,
      truth: input.truth ?? null,
      entertainment: input.entertainment ?? null
    },
    outcomes: {
      published: Boolean(input.published),
      metrics: input.metrics ?? {},
      notes: arr(input.notes),
      growth: input.growth ?? null
    },
    createdAt: input.createdAt ?? now(),
    updatedAt: now()
  };
}

export function auditEpisodeGenome(genome = {}) {
  const blockers = [];
  if (!genome.episodeId) blockers.push({code:"episode-id-missing",message:"Episode Genome has no episodeId."});
  if (!genome.sourceRefs?.length) blockers.push({code:"source-refs-missing",message:"Episode Genome has no source provenance."});
  if (!genome.story?.hook) blockers.push({code:"hook-missing",message:"Episode Genome has no recorded hook."});
  return {ready:blockers.length===0,blockers,stats:{
    scenes:genome.production?.sceneCount??0,
    shots:genome.production?.shotCount??0,
    characters:genome.production?.characterCount??0,
    locations:genome.production?.locationCount??0
  }};
}

export function compareEpisodeGenomes(current={}, history=[]) {
  const prior = arr(history);
  return {
    episodesCompared: prior.length,
    sourceContinuity: prior.filter(item => arr(item.sourceRefs).some(ref => arr(current.sourceRefs).includes(ref))).length,
    productionAverage: prior.length
      ? prior.reduce((sum,item)=>sum+(item.production?.shotCount??0),0)/prior.length
      : 0,
    current: {
      shots: current.production?.shotCount??0,
      scenes: current.production?.sceneCount??0
    }
  };
}

export function buildLearningPrompt({genome={},history=[]}={}) {
  return [
    "Analyze Apex production history.",
    "Identify repeatable production patterns, continuity risks, pacing opportunities, and workflow bottlenecks.",
    "Do not infer audience preferences from missing data.",
    "Do not alter Scripture provenance.",
    "Use observed analytics only; separate measurements from hypotheses.",
    "Recommend the next experiment by identifying one variable to change and the metric that would test it.",
    "Prefer evidence-backed iteration over assumed virality.",
    `Current genome: ${JSON.stringify(genome)}`,
    `History: ${JSON.stringify(history)}`
  ].join(" ");
}
