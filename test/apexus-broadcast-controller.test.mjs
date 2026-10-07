import assert from "node:assert/strict";
import test from "node:test";
import { broadcastStatus, currentScheduleWindow, isScheduleContinuous } from "../src/core/apexus-broadcast-controller.mjs";

const rows = [
  { id:"1", episode_code:"APX-0001", block_name:"Apexus Sunrise", starts_at:"2026-10-08T00:00:00.000Z", ends_at:"2026-10-08T00:10:00.000Z", status:"scheduled" },
  { id:"2", episode_code:"APX-0002", block_name:"KornKids", starts_at:"2026-10-08T00:10:00.000Z", ends_at:"2026-10-08T00:20:00.000Z", status:"scheduled" },
  { id:"3", episode_code:"APX-0003", block_name:"Apex Toonhouse", starts_at:"2026-10-08T00:20:00.000Z", ends_at:"2026-10-08T00:30:00.000Z", status:"scheduled" }
];

test("broadcast controller resolves current and next", () => {
  const result = currentScheduleWindow(rows, new Date("2026-10-08T00:15:00.000Z"));
  assert.equal(result.current.episode_code, "APX-0002");
  assert.equal(result.next.episode_code, "APX-0003");
  assert.equal(result.queue.length, 1);
  assert.equal(result.continuity, "on-air");
});

test("broadcast status reports waiting when no item is on air", () => {
  const result = broadcastStatus({ rows, now: new Date("2026-10-07T23:59:00.000Z") });
  assert.equal(result.state, "waiting");
  assert.equal(result.next.episode_code, "APX-0001");
});

test("schedule continuity rejects gaps", () => {
  assert.equal(isScheduleContinuous(rows), true);
  assert.equal(isScheduleContinuous([rows[0], rows[2]]), false);
});
