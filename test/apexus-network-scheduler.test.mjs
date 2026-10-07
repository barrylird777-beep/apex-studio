import test from "node:test";
import assert from "node:assert/strict";
import { buildNetworkSchedule } from "../src/core/apexus-network-scheduler.mjs";

test("Apexus network scheduler fills a continuous horizon from the catalog", () => {
  const episodes = Array.from({length: 7}, (_, i) => ({
    id: String(i + 1), episode_code: `APX-000${i + 1}`,
    audience_lane: ["Apexus Family","Apexus Toonhouse","Apexus Action","Apex Anime","Dark Garden","Apexus After Dark","KornSwim"][i],
    runtime_target_seconds: 180
  }));
  const rows = buildNetworkSchedule({episodes, startAt:"2026-10-08T00:00:00Z", horizonMinutes:1440});
  assert.ok(rows.length > 0);
  assert.equal(rows[0].startsAt, "2026-10-08T00:00:00.000Z");
  for (let i=1;i<rows.length;i++) assert.equal(rows[i-1].endsAt, rows[i].startsAt);
  assert.equal(rows.at(-1).endsAt, "2026-10-09T00:00:00.000Z");
  assert.ok(rows.some(r => r.blockName === "Apexus Toonhouse"));
});
