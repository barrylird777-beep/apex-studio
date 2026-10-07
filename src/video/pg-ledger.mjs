import { apexPureStore } from "../core/apex-pure-store.mjs";
export function createPgLedger(){return{async record(entry){await apexPureStore.put("video_provenance",crypto.randomUUID(),{ts:new Date().toISOString(),...entry});},async read(){return apexPureStore.list("video_provenance");}};}
