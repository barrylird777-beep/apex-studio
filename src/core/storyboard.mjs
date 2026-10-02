import { uid, now } from "./id.mjs";

export const SHOT_TYPES=Object.freeze(["establishing","wide","medium","close","extreme-close","over-shoulder","tracking","aerial","insert","reaction"]);

export function createStoryboardShot(input={}){
 const type=input.type??"wide";
 if(!SHOT_TYPES.includes(type))throw new Error("Unknown shot type: "+type);
 return {id:input.id??uid("sbshot"),sceneId:input.sceneId??null,beatId:input.beatId??null,index:Number.isFinite(input.index)?input.index:0,type,visualPrompt:input.visualPrompt??"",motionPrompt:input.motionPrompt??"",camera:{...(input.camera??{})},duration:Number.isFinite(input.duration)?input.duration:4,characterIds:[...(input.characterIds??[])],locationId:input.locationId??null,mediaId:input.mediaId??null,continuityRefs:[...(input.continuityRefs??[])],sourceRefs:[...(input.sourceRefs??[])],notes:input.notes??"",createdAt:input.createdAt??now()};
}

export function buildStoryboard(scene){
 const shots=[];
 for(const beat of scene.beats??[]){
   shots.push(createStoryboardShot({sceneId:scene.id,beatId:beat.id,index:shots.length,type:"wide",duration:Math.max(3,Math.min(8,Number(beat.duration)||4)),visualPrompt:beat.description??beat.title,characterIds:scene.characters,locationId:scene.locationId,continuityRefs:scene.continuityRefs,sourceRefs:scene.sourceRefs}));
 }
 if(!shots.length) shots.push(createStoryboardShot({sceneId:scene.id,index:0,visualPrompt:scene.notes||scene.title,characterIds:scene.characters,locationId:scene.locationId,continuityRefs:scene.continuityRefs,sourceRefs:scene.sourceRefs}));
 return shots;
}
