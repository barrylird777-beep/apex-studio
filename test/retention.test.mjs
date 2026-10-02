import test from "node:test";
import assert from "node:assert/strict";
import { buildRetentionPrompt, RETENTION_BEATS } from "../src/core/retention.mjs";
test("retention opening is exactly structured as a 30 second cold open",()=>{
 const p=buildRetentionPrompt({title:"David and Goliath",passage:"1 Samuel 17",storySummary:"David faces Goliath."});
 assert.equal(RETENTION_BEATS.at(-1).end,30);
 assert.match(p,/0-3s/);assert.match(p,/23-30s/);
 assert.match(p,/Do not fabricate/);
});
