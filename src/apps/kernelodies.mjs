import { getApexApp } from "./apex-six-apps.mjs";
import { createMusicTrack, buildMusicProductionPlan, buildMusicPrompt, registerMusicAsset } from "../core/music/music-studio.mjs";
import { listVoiceOptions } from "../core/audio-station.mjs";
const APP=getApexApp("kernelodies");
export { createMusicTrack, buildMusicProductionPlan, buildMusicPrompt, registerMusicAsset };
export async function kernelodiesStatus(){let voices=0;try{voices=(await listVoiceOptions()).length;}catch{}return{app:{...APP},role:APP.role,capabilities:["music tracks","production plans","music prompts","asset provenance","local audio voice catalog"],voiceCatalogCount:voices,canonical:true,checkedAt:new Date().toISOString()};}
