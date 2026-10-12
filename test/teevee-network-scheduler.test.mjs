import test from "node:test";
import assert from "node:assert/strict";
import { buildNetworkSchedule } from "../src/core/teevee-network-scheduler.mjs";

function catalog() {
  return Array.from({length: 7}, (_, i) => ({
    id: String(i + 1),
    episode_code: `APX-000${i + 1}`,
    audience_lane: ["TeeVee Family","TeeVee Toonhouse","TeeVee Action","Apex Anime","Dark Garden","TeeVee After Dark","KornSwim"][i],
    runtime_target_seconds: 180
  }));
}

test("TeeVee network scheduler fills a continuous horizon", () => {
  const rows = buildNetworkSchedule({episodes:catalog(), startAt:"2026-10-08T00:00:00Z", horizonMinutes:1440});
  assert.ok(rows.length > 0);
  assert.equal(rows[0].startsAt, "2026-10-08T00:00:00.000Z");
  for (let i=1;i<rows.length;i++) assert.equal(rows[i-1].endsAt, rows[i].startsAt);
  assert.equal(rows.at(-1).endsAt, "2026-10-09T00:00:00.000Z");
});

test("TeeVee block boundaries are respected", () => {
  const rows = buildNetworkSchedule({episodes:catalog(), startAt:"2026-10-08T00:00:00Z", horizonMinutes:240});
  const sunrise = rows.filter(row => row.blockName === "TeeVee Sunrise");
  const kids = rows.filter(row => row.blockName === "KornKids");
  assert.ok(sunrise.length > 0 && kids.length > 0);
  assert.equal(sunrise.at(-1).endsAt, "2026-10-08T02:00:00.000Z");
  assert.equal(kids[0].startsAt, "2026-10-08T02:00:00.000Z");
});

test("TeeVee schedule IDs are deterministic", () => {
  const a = buildNetworkSchedule({episodes:catalog(), startAt:"2026-10-08T00:00:00Z", horizonMinutes:60});
  const b = buildNetworkSchedule({episodes:catalog(), startAt:"2026-10-08T00:00:00Z", horizonMinutes:60});
  assert.deepEqual(a, b);
});

test("TeeVee scheduler terminates when an episode exceeds a block", () => {
  const rows = buildNetworkSchedule({
    episodes: [{
      id: "oversized",
      episode_code: "APX-OVERSIZED",
      audience_lane: "TeeVee Family",
      runtime_target_seconds: 900
    }],
    startAt: "2026-10-08T00:00:00Z",
    horizonMinutes: 10
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].startsAt, "2026-10-08T00:00:00.000Z");
  assert.equal(rows[0].endsAt, "2026-10-08T00:15:00.000Z");
});
