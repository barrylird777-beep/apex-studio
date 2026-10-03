import { uid } from "./id.mjs";

export const STUDIO_TOOL_CATALOG = Object.freeze([
  { id:"timecode", name:"Timecode", description:"Convert frames, seconds and SMPTE timecode at common frame rates." },
  { id:"subtitles", name:"Subtitle Builder", description:"Turn timed dialogue/captions into SRT or WebVTT." },
  { id:"script-stats", name:"Script Analyzer", description:"Estimate runtime, words, speaking time and pacing." },
  { id:"shot-audit", name:"Shot Audit", description:"Check coverage, durations, source grounding and continuity fields." },
  { id:"prompt-pack", name:"Prompt Pack", description:"Build consistent visual, motion and negative prompts from production metadata." },
  { id:"aspect-ratios", name:"Delivery Presets", description:"Resolve cinema, YouTube, vertical and square output dimensions." },
  { id:"filename", name:"Asset Filename", description:"Generate safe, deterministic production asset filenames." },
  { id:"production-checklist", name:"Production Checklist", description:"Run a lightweight artifact completeness check before render/release." }
]);

const FPS=Object.freeze([23.976,24,25,29.97,30,50,59.94,60]);

export function listStudioTools(){ return STUDIO_TOOL_CATALOG.map(x=>({...x})); }

function finite(n,fallback=0){ const x=Number(n); return Number.isFinite(x)?x:fallback; }

export function secondsToTimecode(seconds=0,fps=24){
  fps=FPS.includes(Number(fps))?Number(fps):24;
  const total=Math.max(0,finite(seconds));
  const frames=Math.round(total*fps);
  const ff=frames%Math.round(fps), totalFrames=Math.floor(frames/Math.round(fps));
  const ss=totalFrames%60, mm=Math.floor(totalFrames/60)%60, hh=Math.floor(totalFrames/3600);
  return [hh,mm,ss,ff].map((n,i)=>String(n).padStart(i===3?2:2,"0")).join(":");
}

export function timecodeToSeconds(value="",fps=24){
  fps=FPS.includes(Number(fps))?Number(fps):24;
  const s=String(value).trim();
  if(/^\d+(?:\.\d+)?$/.test(s)) return Number(s);
  const p=s.split(":").map(Number);
  if(p.some(x=>!Number.isFinite(x))||p.length<2||p.length>4) throw new Error("Invalid timecode");
  if(p.length===2) return p[0]*60+p[1];
  if(p.length===3) return p[0]*3600+p[1]*60+p[2];
  return p[0]*3600+p[1]*60+p[2]+p[3]/fps;
}

function subtitleTime(seconds,format,fps){
  const total=Math.max(0,finite(seconds));
  const ms=Math.round((total-Math.floor(total))*1000);
  const whole=Math.floor(total), s=whole%60, m=Math.floor(whole/60)%60, h=Math.floor(whole/3600);
  const base=[h,m,s].map(x=>String(x).padStart(2,"0")).join(":");
  if(format==="vtt") return base+"."+String(ms).padStart(3,"0");
  return base+","+String(ms).padStart(3,"0");
}

export function buildSubtitles(cues=[],{format="srt",fps=24}={}){
  const mode=String(format).toLowerCase()==="vtt"?"vtt":"srt";
  const items=(Array.isArray(cues)?cues:[]).map((cue,i)=>{
    const start=typeof cue.start==="string"?timecodeToSeconds(cue.start,fps):finite(cue.start);
    const end=typeof cue.end==="string"?timecodeToSeconds(cue.end,fps):Math.max(start+0.5,finite(cue.end,start+2));
    return {index:i+1,start,end,text:String(cue.text??cue.caption??"").trim()};
  }).filter(x=>x.text);
  const body=items.map(x=>`${mode==="srt"?x.index+"\n":""}${subtitleTime(x.start,mode,fps)} --> ${subtitleTime(x.end,mode,fps)}\n${x.text}\n`).join("\n");
  return {format:mode,cues:items,content:mode==="vtt"?"WEBVTT\n\n"+body:body};
}

export function analyzeScript(input="",{wordsPerMinute=145}={}){
  const text=String(input??"").replace(/\s+/g," ").trim();
  const words=text?text.split(" ").length:0;
  const wpm=Math.max(60,finite(wordsPerMinute,145));
  const minutes=words/wpm;
  const dialogue=(String(input??"").match(/(?:^|\n)\s*[A-Z][A-Za-z0-9 _'-]{1,40}:\s*.+/g)||[]).length;
  const paragraphs=String(input??"").split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean).length;
  return {words,estimatedMinutes:Number(minutes.toFixed(2)),estimatedSeconds:Math.round(minutes*60),wordsPerMinute:wpm,dialogueLines:dialogue,paragraphs,charactersPerMinute:Number((words/Math.max(minutes,0.01)/60).toFixed(1))};
}

export const DELIVERY_PRESETS=Object.freeze({
  master:{width:1920,height:1080,fps:24,label:"Master 16:9"},
  "youtube-1080p":{width:1920,height:1080,fps:24,label:"YouTube 1080p"},
  vertical:{width:1080,height:1920,fps:24,label:"Vertical 9:16"},
  square:{width:1080,height:1080,fps:24,label:"Square 1:1"},
  "cinema-2k":{width:2048,height:1080,fps:24,label:"Cinema 2K"}
});

export function deliveryPreset(id="master"){ return {...(DELIVERY_PRESETS[id]??DELIVERY_PRESETS.master),id:id in DELIVERY_PRESETS?id:"master"}; }

export function safeAssetFilename({project="apex",batch="batch",kind="asset",ext="bin"}={}){
  const clean=v=>String(v).toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"").slice(0,80)||"untitled";
  const e=String(ext).replace(/[^a-z0-9]/gi,"").toLowerCase()||"bin";
  return [clean(project),clean(batch),clean(kind)].join("_")+"."+e;
}

export function productionChecklist(input={}){\n  const checks=[\n    ["source",Boolean(input.source||input.sourceRefs?.length),"Source/provenance attached."],\n    ["script",Boolean(String(input.script??"").trim()),"Production script exists."],\n    ["visuals",Boolean(input.visuals||input.media?.length),"Visual assets/plan exists."],\n    ["audio",Boolean(input.audio||input.audioTracks?.length),"Audio exists."],\n    ["timeline",Boolean(input.timeline),"Timeline exists."],\n    ["release",Boolean(input.releasePackage||input.release),"Release package exists."]\n  ].map(([id,ok,detail])=>({id,ok,detail}));\n  return {ready:checks.every(x=>x.ok),checks};\n}\n\nexport function runStudioTool(tool,input={}){
  switch(tool){
    case "timecode": return input.direction==="toSeconds"?{seconds:timecodeToSeconds(input.value,input.fps)}:{timecode:secondsToTimecode(input.seconds,input.fps)};
    case "subtitles": return buildSubtitles(input.cues,input);
    case "script-stats": return analyzeScript(input.text,input);
    case "shot-audit": return auditShotList(input.shots);
    case "prompt-pack": return buildPromptPack(input);
    case "aspect-ratios": return deliveryPreset(input.preset);
    case "filename": return {filename:safeAssetFilename(input)};
    case "production-checklist": return productionChecklist(input);
    default: throw new Error("Unknown studio tool: "+tool);
  }
}
