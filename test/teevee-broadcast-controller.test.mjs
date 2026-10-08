import assert from "node:assert/strict";
import test from "node:test";
import { broadcastStatus, currentScheduleWindow, isScheduleContinuous } from "../src/core/teevee-broadcast-controller.mjs";

const rows = [
  { id:"1", episode_code:"APX-0001", starts_at:"2026-10-08T00:00:00.000Z", ends_at:"2026-10-08T00:10:00.000Z", status:"scheduled" },
  { id:"2", episode_code:"APX-0002", starts_at:"2026-10-08T00:10:00.000Z", ends_at:"2026-10-08T00:20:00.000Z", status:"scheduled" }
];

test("TeeVee schedule continuity is enforced", () => {
  assert.equal(isScheduleContinuous(rows), true);
  assert.equal(isScheduleContinuous([{...rows[1], starts_at:"2026-10-08T00:11:00.000Z"}]), true);
  assert.equal(isScheduleContinuous([rows[0], {...rows[1], starts_at:"2026-10-08T00:11:00.000Z"}]), false);
});

test("TeeVee broadcast controller identifies current and next slot", () => {
  const result=currentScheduleWindow(rows,new Date("2026-10-08T00:05:00.000Z"));
  assert.equal(result.current.episode_code,"APX-0001");
  assert.equal(result.next.episode_code,"APX-0002");
  assert.equal(broadcastStatus({rows,now:new Date("2026-10-08T00:05:00.000Z")}).state,"broadcasting");
});
