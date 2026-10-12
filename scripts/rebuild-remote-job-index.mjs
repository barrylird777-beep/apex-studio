import { ApexPureStore } from "../src/core/apex-pure-store.mjs";

if (String(process.env.APEX_CAS_REMOTE_ENABLED || "").toLowerCase() !== "true") {
  throw new Error("Remote job-index rebuild requires APEX_CAS_REMOTE_ENABLED=true; refusing local fallback.");
}
const store = new ApexPureStore();
await store.init();
const result = await store.ensureRemoteQueueIndex();
console.log("[REMOTE_JOB_INDEX] verified", JSON.stringify(result));
