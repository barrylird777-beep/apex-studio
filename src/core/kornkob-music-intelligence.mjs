import { spawn } from "node:child_process";
import { searchAnything } from "./apex-web-search.mjs";
import { apexPureStore } from "./apex-pure-store.mjs";

const MODEL_PATH=process.env.KORNKOB_MUSIC_MODEL_PATH||process.env.APEX_LOCAL_MODEL_PATH||null;
const MODEL_ID=process.env.KORNKOB_MUSIC_MODEL_ID||"kornkob-music-specialist";
const SYSTEM_PROMPT=`You are KORNKOB, the specialized music intelligence of Apex.
You are the EARS of Apex. Think like a musicologist, producer, composer, sound designer,
mix engineer, mastering engineer, music researcher and trend analyst simultaneously.
Serve KORNKOB first, then GardenOfApex, ApexStudios, ApexRapidVideo and ApexEngine when useful.
Track music history, Korn history, genres, instruments, production techniques, sonic references,
copyright/provenance concerns, audio engineering and audience trends. Never invent sources.`;

export function musicModelStatus(){
  return {modelId:MODEL_ID,modelPath:MODEL_PATH,localConfigured:Boolean(MODEL_PATH),systemPromptVersion:1};
}

export async function researchMusic(query,{limit=20}={}){
  const result=await searchAnything(String(query),{limit});
  await apexPureStore.put("kornkob_research",Date.now().toString(),{
    query:String(query),results:result.results,providers:result.providers,createdAt:new Date().toISOString()
  });
  return result;
}

export async function createMusicBrief({task,context={},needs=[]}={}){
  const brief={
    id:crypto.randomUUID(),
    surface:"KORNKOB",
    task:String(task||""),
    needs:Array.isArray(needs)?needs.map(String):[],
    context,
    system:SYSTEM_PROMPT,
    model:musicModelStatus(),
    createdAt:new Date().toISOString()
  };
  await apexPureStore.put("kornkob_briefs",brief.id,brief);
  return brief;
}

export async function analyzeAudioFile(filePath){
  return new Promise((resolve,reject)=>{
    const p=spawn("ffprobe",["-v","error","-print_format","json","-show_format","-show_streams",filePath],{stdio:["ignore","pipe","pipe"]});
    let out="",err="";p.stdout.on("data",x=>out+=x);p.stderr.on("data",x=>err+=x);
    p.once("error",reject);p.once("close",code=>{
      if(code!==0)return reject(new Error(err||"ffprobe failed"));
      try{resolve(JSON.parse(out));}catch(e){reject(e);}
    });
  });
}
