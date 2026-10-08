import { createHash } from "node:crypto";

export const TOONX_BLOCKS = Object.freeze([
  { name: "TOONX Sunrise", lane: "TOONX Family", minutes: 120 },
  { name: "KornKids", lane: "TOONX Family", minutes: 120 },
  { name: "Apex Toonhouse", lane: "TOONX Toonhouse", minutes: 180 },
  { name: "TOONX Action", lane: "TOONX Action", minutes: 180 },
  { name: "Apex Anime", lane: "Apex Anime", minutes: 180 },
  { name: "Dark Garden", lane: "Dark Garden", minutes: 120 },
  { name: "TOONX After Dark", lane: "TOONX After Dark", minutes: 180 },
  { name: "KornSwim", lane: "KornSwim", minutes: 180 },
  { name: "Midnight Apex", lane: "TOONX After Dark", minutes: 120 }
]);

function stableId(blockName, episodeId, startsAt) {
  const hex = createHash("sha256").update(`toonx:schedule:${blockName}:${episodeId}:${startsAt}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-8${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

function lanePool(episodes) {
  return new Map(TOONX_BLOCKS.map(block => [
    block.lane,
    episodes.filter(episode => episode.audience_lane === block.lane)
  ]));
}

export function buildNetworkSchedule({ episodes, startAt, horizonMinutes = 1440 }) {
  if (!Array.isArray(episodes) || episodes.length === 0) throw new Error("TOONX catalog is empty");
  const start = new Date(startAt);
  const horizon = Number(horizonMinutes);
  if (Number.isNaN(start.getTime())) throw new RangeError("Invalid schedule start");
  if (!Number.isFinite(horizon) || horizon <= 0) throw new RangeError("Schedule horizon must be positive");

  const endAt = start.getTime() + horizon * 60000;
  const rows = [];
  const pools = lanePool(episodes);
  const indexes = new Map();
  let cursor = start.getTime();
  let blockIndex = 0;

  while (cursor < endAt) {
    const block = TOONX_BLOCKS[blockIndex % TOONX_BLOCKS.length];
    const blockEnd = Math.min(endAt, cursor + block.minutes * 60000);
    const eligible = pools.get(block.lane) || [];
    const pool = eligible.length ? eligible : episodes;
    let index = indexes.get(block.lane) || 0;

    while (cursor < blockEnd) {
      const episode = pool[index % pool.length];
      const duration = Math.max(1, Number(episode.runtime_target_seconds || 180));
      const proposedEnd = cursor + duration * 1000;
      // Never split an episode across programming blocks. If the next episode
      // does not fit, close this block early and let the next block begin
      // immediately at the same cursor. Continuity beats arbitrary block math.
      // Episodes are atomic broadcast units. Never truncate or stall the network
    // merely because an episode crosses a nominal programming-block boundary.
      const slotEnd = proposedEnd;
      const startsAt = new Date(cursor).toISOString();
      rows.push({
        id: stableId(block.name, episode.id, startsAt),
        episodeId: episode.id,
        episodeCode: episode.episode_code,
        blockName: block.name,
        startsAt,
        endsAt: new Date(slotEnd).toISOString(),
        status: "scheduled"
      });
      cursor = slotEnd;
      indexes.set(block.lane, index + 1);
    }
    blockIndex++;
  }
  return rows;
}
