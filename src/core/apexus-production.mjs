import { createHash, randomUUID } from "node:crypto";

export const APEXUS_EPISODE_COUNT = 2785;
export const APEXUS_LANES = Object.freeze([
  "Apexus Family","Apexus Toonhouse","Apexus Action","Apex Anime",
  "Dark Garden","Apexus After Dark","KornSwim"
]);

export const APEXUS_STATES = Object.freeze([
  "IDEA","STORY","SCRIPT","STORYBOARD","VOICE","AUDIO",
  "VISUAL_DEVELOPMENT","ANIMATION","EDIT","QC","MASTER",
  "SCHEDULED","BROADCAST","CATALOG"
]);

const prerequisites = Object.freeze({
  STORY: ["creative_brief"],
  SCRIPT: ["story"],
  STORYBOARD: ["script"],
  VOICE: ["storyboard"],
  AUDIO: ["voice"],
  VISUAL_DEVELOPMENT: ["storyboard"],
  ANIMATION: ["visual_development","audio"],
  EDIT: ["animation","audio"],
  QC: ["edit"],
  MASTER: ["qc"],
  SCHEDULED: ["master","catalog"],
  BROADCAST: ["scheduled"],
  CATALOG: ["master","qc"]
});

export function episodeCode(globalEpisodeNumber) {
  const n = Number(globalEpisodeNumber);
  if (!Number.isInteger(n) || n < 1 || n > APEXUS_EPISODE_COUNT) {
    throw new RangeError("Apexus global episode number must be 1..2785");
  }
  return `APX-${String(n).padStart(4, "0")}`;
}

export function deterministicEpisodeId(globalEpisodeNumber) {
  const code = episodeCode(globalEpisodeNumber);
  const hex = createHash("sha256").update(`apexus:episode:${code}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export function buildEpisode(globalEpisodeNumber, input = {}) {
  const n = Number(globalEpisodeNumber);
  const code = episodeCode(n);
  const now = new Date().toISOString();
  return {
    id: deterministicEpisodeId(n),
    globalEpisodeNumber: n,
    episodeCode: code,
    seriesId: String(input.seriesId ?? "APEXUS-ORIGINALS"),
    seasonId: String(input.seasonId ?? "SEASON-01"),
    episodeNumber: Number(input.episodeNumber ?? n),
    title: String(input.title ?? `${code} Development Slot`),
    logline: String(input.logline ?? ""),
    audienceLane: input.audienceLane ?? "Apexus Toonhouse",
    maturityRating: input.maturityRating ?? "TV-PG",
    visualStyle: input.visualStyle ?? "apexus-dark-fantasy-cel",
    runtimeTargetSeconds: Number(input.runtimeTargetSeconds ?? 1320),
    state: "IDEA",
    statuses: {
      script: "pending", storyboard: "pending", voice: "pending", audio: "pending",
      animation: "pending", edit: "pending", qc: "pending", master: "pending",
      programming: "pending"
    },
    creativeBrief: input.creativeBrief ?? {},
    metadata: input.metadata ?? {},
    createdAt: now,
    updatedAt: now
  };
}

function hasArtifact(episode, key) {
  if (key === "creative_brief") return Object.keys(episode.creativeBrief ?? {}).length > 0;
  if (key === "catalog") return episode.catalogRegistered === true;
  if (key === "master") return episode.statuses?.master === "approved";
  if (key === "qc") return episode.statuses?.qc === "passed";
  if (key === "scheduled") return episode.scheduled === true;
  const map = { story:"story", script:"script", storyboard:"storyboard", voice:"voice", audio:"audio", visual_development:"visualDevelopment", animation:"animation", edit:"edit" };
  return episode.statuses?.[map[key]] === "approved";
}

export function canAdvanceEpisode(episode, nextState) {
  if (!episode || !APEXUS_STATES.includes(nextState)) return false;
  const current = APEXUS_STATES.indexOf(episode.state);
  const next = APEXUS_STATES.indexOf(nextState);
  if (next !== current + 1) return false;
  return (prerequisites[nextState] ?? []).every(key => hasArtifact(episode, key));
}

export function advanceEpisode(episode, nextState) {
  if (!canAdvanceEpisode(episode, nextState)) {
    throw new Error(`Apexus episode cannot advance from ${episode?.state ?? "unknown"} to ${nextState}`);
  }
  return { ...episode, state: nextState, updatedAt: new Date().toISOString() };
}

export function validateBroadcastReadiness(episode) {
  const errors = [];
  if (!episode || !episode.id) errors.push("episode identity missing");
  if (episode?.state !== "SCHEDULED" && episode?.state !== "BROADCAST") errors.push("episode is not scheduled");
  if (episode?.statuses?.qc !== "passed") errors.push("QC has not passed");
  if (episode?.statuses?.master !== "approved") errors.push("master is not approved");
  if (episode?.catalogRegistered !== true) errors.push("catalog asset is not registered");
  if (!episode?.scheduled) errors.push("broadcast slot is missing");
  return { ready: errors.length === 0, errors };
}

export function buildLaunchManifest() {
  return Object.freeze({
    network: "Apexus",
    purpose: "24/7 original animated entertainment network",
    episodeCount: APEXUS_EPISODE_COUNT,
    firstEpisode: episodeCode(1),
    lastEpisode: episodeCode(APEXUS_EPISODE_COUNT),
    lanes: APEXUS_LANES,
    states: APEXUS_STATES,
    continuousInventory: ["episodes","shorts","bumpers","interstitials","station_ids","promos","premieres","specials","movies","catalog_rotations"]
  });
}

export function buildEpisodeProductionJobs(episode) {
  const id = episode.id;
  const stages = ["story","script","storyboard","voice","audio","visual-development","animation","edit","qc","master","catalog","schedule"];
  return stages.map((stage, index) => ({
    id: randomUUID(),
    type: `apexus.episode.${stage}`,
    payload: { episodeId: id, episodeCode: episode.episodeCode, stage },
    priority: 1000 - index,
    dedupeKey: `apexus:${episode.episodeCode}:${stage}`
  }));
}

export function buildInitialProductionBatch({ start = 1, end = APEXUS_EPISODE_COUNT } = {}) {
  const first = Math.max(1, Number(start));
  const last = Math.min(APEXUS_EPISODE_COUNT, Number(end));
  if (first > last) throw new RangeError("Invalid Apexus episode batch");
  return Array.from({ length: last - first + 1 }, (_, i) => buildEpisode(first + i));
}
