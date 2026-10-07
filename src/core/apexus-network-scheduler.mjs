import { randomUUID } from "node:crypto";

export const APEXUS_BLOCKS = Object.freeze([
  { name: "Apexus Sunrise", lane: "Apexus Family", minutes: 120 },
  { name: "KornKids", lane: "Apexus Family", minutes: 120 },
  { name: "Apex Toonhouse", lane: "Apexus Toonhouse", minutes: 180 },
  { name: "Apexus Action", lane: "Apexus Action", minutes: 180 },
  { name: "Apex Anime", lane: "Apex Anime", minutes: 180 },
  { name: "Dark Garden", lane: "Dark Garden", minutes: 120 },
  { name: "Apexus After Dark", lane: "Apexus After Dark", minutes: 180 },
  { name: "KornSwim", lane: "KornSwim", minutes: 180 },
  { name: "Midnight Apex", lane: "Apexus After Dark", minutes: 120 }
]);

export function buildNetworkSchedule({ episodes, startAt, horizonMinutes = 1440 }) {
  if (!Array.isArray(episodes) || episodes.length === 0) throw new Error("Apexus catalog is empty");
  const start = new Date(startAt);
  if (Number.isNaN(start.getTime())) throw new RangeError("Invalid schedule start");
  const endAt = start.getTime() + Number(horizonMinutes) * 60000;
  const rows = [];
  let cursor = start.getTime();
  let episodeIndex = 0;
  let blockIndex = 0;

  while (cursor < endAt) {
    const block = APEXUS_BLOCKS[blockIndex % APEXUS_BLOCKS.length];
    const eligible = episodes.filter(e => e.audience_lane === block.lane);
    const pool = eligible.length ? eligible : episodes;
    const episode = pool[episodeIndex % pool.length];
    const duration = Math.max(1, Number(episode.runtime_target_seconds || 180));
    const slotEnd = Math.min(endAt, cursor + duration * 1000);
    rows.push({
      id: randomUUID(),
      episodeId: episode.id,
      episodeCode: episode.episode_code,
      blockName: block.name,
      startsAt: new Date(cursor).toISOString(),
      endsAt: new Date(slotEnd).toISOString(),
      status: "scheduled"
    });
    cursor = slotEnd;
    episodeIndex++;
    blockIndex++;
  }
  return rows;
}
