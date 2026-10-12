import { uid, now } from "./id.mjs";

export const GENERATION_MODES=Object.freeze(["local-comfyui","remote-provider","manual"]);
export const APEX_VISUAL_STYLE=Object.freeze({name:"APEX Dark Fantasy Anime",prompt:"dark fantasy anime, sharp cel-shading, high-contrast cinematic lighting, epic and intense, highly detailed, dramatic composition, expressive anime character design, atmospheric depth, rich environmental detail, cinematic color grading",negative:"photorealistic, western cartoon, flat lighting, low detail, soft cel shading, chibi, modern clothing, modern architecture, text, watermark, extra limbs, inconsistent face, inconsistent wardrobe"});
export function buildVisualPrompt({shot,characters=[],location=null,canonEntities=[],style=APEX_VISUAL_STYLE.prompt}={}){
 const refs=characters.map(c=>c?("Character "+c.name+": "+c.description+"; appearance: "+JSON.stringify(c.appearance)+"; wardrobe: "+JSON.stringify(c.wardrobe)):"").filter(Boolean);
 const loc=location?("Location "+location.name+": "+location.description+"; environment: "+JSON.stringify(location.environment)+"; architecture: "+JSON.stringify(location.architecture)):"";
 const canon=canonEntities.map(x=>x?("Canon "+x.type+" "+x.name+": "+JSON.stringify(x.state)+"; locked: "+JSON.stringify(x.locked)):"").filter(Boolean).join(" ");
 const provenance=(shot.sourceRefs??[]).map(x=>x.locator??x.sourceId).filter(Boolean).join(", ");
 return {positive:[style,shot.visualPrompt,refs.join(" "),loc,"Maintain continuity with reference media.",canon?"Persistent world canon: "+canon:"",provenance?"Biblical source context: "+provenance:""].filter(Boolean).join("\n"),negative:[APEX_VISUAL_STYLE.negative,shot.negativePrompt??""] .filter(Boolean).join(", "),seed:shot.seed??null};
}
export function createGenerationJob(input={}){
 return {id:input.id??uid("gen"),type:input.type??"image",mode:input.mode??"local-comfyui",shotId:input.shotId??null,prompt:input.prompt??null,workflow:input.workflow??null,status:"queued",createdAt:now(),updatedAt:now(),resultMediaId:null,error:null};
}
export class GenerationQueue{
 constructor(){this.jobs=new Map();}
 enqueue(i){const j=createGenerationJob(i);this.jobs.set(j.id,j);return j;}
 get(id){return this.jobs.get(id)??null;}
 list(){return [...this.jobs.values()];}
 mark(id,status,patch={}){const j=this.get(id);if(!j)throw new Error("Generation job not found");Object.assign(j,patch,{status,updatedAt:now()});return j;}
 snapshot(){return this.list();}
 restore(xs=[]){this.jobs.clear();for(const x of xs)this.jobs.set(x.id,x);return this;}
}