import { apexPureDataStore as store } from "../core/apex-pure-data.mjs";

const clean=(x:any)=>({
  projectId:Number(x.projectId),
  sceneNumber:x.sceneNumber==null?null:Number(x.sceneNumber),
  title:String(x.title||"").trim()||null,
  scriptureRef:String(x.scriptureRef||x.verses||"").trim(),
  location:String(x.location||"").trim()||null,
  charactersPresent:Array.isArray(x.charactersPresent)?x.charactersPresent.map(Number).filter(Number.isInteger):[],
  actionSummary:String(x.actionSummary||"").trim()||null,
  emotionalBeat:typeof x.emotionalBeat==="string"?x.emotionalBeat:JSON.stringify(x.emotionalBeat??null),
  productionNotes:String(x.productionNotes||"").trim()||null,
  estimatedPages:x.estimatedPages==null?null:Number(x.estimatedPages),
  dayOrNight:String(x.dayOrNight||"").trim()||null
});

export const listScenes=async(projectId:number)=>store.query("scenes",x=>Number(x.projectId)===Number(projectId),{sort:(a,b)=>(Number(a.sceneNumber??0)-Number(b.sceneNumber??0))||String(a.id).localeCompare(String(b.id))});

export const createScene=async(x:any)=>{
  if(!(await store.get("projects",String(x.projectId))))return null;
  if(!String(x.scriptureRef||x.verses||"").trim())throw new Error("Scripture reference is required");
  return store.create("scenes",clean(x));
};

export const updateScene=async(id:number,x:any)=>{
  const old=await store.get("scenes",String(id)); if(!old)return null;
  return store.put("scenes",String(id),clean({...old,...x}));
};

export const deleteScene=async(id:number)=>{
  if(!(await store.get("scenes",String(id))))return false;
  await store.delete("scenes",String(id)); return true;
};
