import { APEX_CREW, SURFACES } from "./apex-crew.mjs";

export const APEX_CREW_MANIFEST=Object.freeze({
  version:1,
  principle:"One shared capability plane; six distinct surfaces; specialized workers; final inspector gate.",
  crew:Object.keys(APEX_CREW),
  surfaces:Object.fromEntries(Object.entries(SURFACES)),
  execution:{
    storage:"Pure-WAL",
    state:"atomic-files",
    coordination:"Raft-inspired",
    leases:"fenced",
    recovery:"lease-reclamation",
    inference:"device-local when supported",
    network:"public-web with SSRF-safe transport"
  },
  gates:["security","inspector"],
  priorityOrder:Object.values(APEX_CREW).sort((a,b)=>b.priority-a.priority).map(x=>x.role)
});
