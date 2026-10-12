import { getApexApp } from "./apex-six-apps.mjs";
import { createMusicTrack, buildMusicProductionPlan, buildMusicPrompt, registerMusicAsset } from "../core/music/music-studio.mjs";
import { listVoiceOptions } from "../core/audio-station.mjs";
import { sovereignAppFabric } from "../core/sovereign-app-fabric.mjs";
const APP=getApexApp("kernelodies");
export { createMusicTrack, buildMusicProductionPlan, buildMusicPrompt, registerMusicAsset };
export async function kernelodiesStatus(){let voices=0;try{voices=(await listVoiceOptions()).length;}catch{}return{app:{...APP},role:APP.role,capabilities:["music tracks","production plans","music prompts","asset provenance","local audio voice catalog"],voiceCatalogCount:voices,canonical:true,checkedAt:new Date().toISOString()};}


// Shared durable records for this app; inject a test/local fabric when needed.
export const saveKernelodiesRecord = (id, record, fabric = sovereignAppFabric) => fabric.put(APP.id, id, record);
export const getKernelodiesRecord = (id, fabric = sovereignAppFabric) => fabric.get(APP.id, id);
export const listKernelodiesRecords = (fabric = sovereignAppFabric) => fabric.list(APP.id);
