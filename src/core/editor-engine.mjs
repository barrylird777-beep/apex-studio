import crypto from "node:crypto";

const uid=()=>crypto.randomUUID();
const n=(v,d=0)=>Number.isFinite(Number(v))?Number(v):d;

export function createEditorProject(input={}) {
  return {
    id:input.id??uid(),fps:n(input.fps,30),width:n(input.width,3840),height:n(input.height,2160),
    duration:n(input.duration,0),tracks:[],groups:[],markers:[],captions:[],createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()
  };
}
export function addTrack(project,type="video",name="Track") {
  const track={id:uid(),type,name,muted:false,solo:false,locked:false,clips:[],effects:[]};
  project.tracks.push(track); project.updatedAt=new Date().toISOString(); return track;
}
export function addClip(project,trackId,input={}) {
  const t=project.tracks.find(x=>x.id===trackId); if(!t) throw new Error("Track not found");
  const clip={id:input.id??uid(),mediaId:input.mediaId??null,source:input.source??null,start:n(input.start,0),duration:Math.max(0,n(input.duration,0)),in:n(input.in,0),out:input.out==null?null:n(input.out),speed:Math.max(.01,n(input.speed,1)),volume:n(input.volume,1),opacity:Math.max(0,Math.min(1,n(input.opacity,1))),transform:{x:n(input.x,0),y:n(input.y,0),scale:n(input.scale,1),rotation:n(input.rotation,0)},blendMode:input.blendMode??"normal",keyframes:[],effects:[],transitions:{in:null,out:null}};
  if(t.locked) throw new Error("Track is locked");
  t.clips.push(clip); t.clips.sort((a,b)=>a.start-b.start); project.duration=Math.max(project.duration,clip.start+clip.duration); project.updatedAt=new Date().toISOString(); return clip;
}
export function addKeyframe(project,trackId,clipId,input={}) {
  const clip=project.tracks.find(t=>t.id===trackId)?.clips.find(c=>c.id===clipId); if(!clip) throw new Error("Clip not found");
  const key={id:uid(),time:n(input.time,0),property:String(input.property||"opacity"),value:input.value};
  clip.keyframes.push(key); clip.keyframes.sort((a,b)=>a.time-b.time); project.updatedAt=new Date().toISOString(); return key;
}
export function addEffect(project,trackId,clipId,effect={}) {
  const clip=project.tracks.find(t=>t.id===trackId)?.clips.find(c=>c.id===clipId); if(!clip) throw new Error("Clip not found");
  const item={id:uid(),type:String(effect.type||"adjustment"),params:{...(effect.params||{})},enabled:effect.enabled!==false};
  clip.effects.push(item); project.updatedAt=new Date().toISOString(); return item;
}
export function addCaption(project,input={}) {
  const caption={id:uid(),start:n(input.start,0),duration:Math.max(0,n(input.duration,2)),text:String(input.text??""),style:{font:input.font??"system-ui",size:n(input.size,48),align:input.align??"center",position:input.position??"bottom",outline:input.outline!==false,background:input.background??null},animation:input.animation??"none"};
  project.captions.push(caption); project.updatedAt=new Date().toISOString(); return caption;
}
export function addMarker(project,input={}) {
  const marker={id:uid(),time:n(input.time,0),label:String(input.label??"Marker"),color:input.color??null};
  project.markers.push(marker); project.markers.sort((a,b)=>a.time-b.time); project.updatedAt=new Date().toISOString(); return marker;
}
export function setTransition(project,trackId,clipId,edge,type,duration=.5) {
  const clip=project.tracks.find(t=>t.id===trackId)?.clips.find(c=>c.id===clipId); if(!clip) throw new Error("Clip not found");
  if(edge!=="in"&&edge!=="out") throw new Error("Transition edge must be in or out");
  clip.transitions[edge]={type:String(type||"crossfade"),duration:Math.max(0,n(duration,.5))}; project.updatedAt=new Date().toISOString(); return clip.transitions[edge];
}
export function createExportPlan(project,input={}) {
  const format=input.format??"mp4"; const codec=input.codec??(format==="webm"?"vp9":"h264");
  return {id:uid(),projectId:project.id,format,codec,resolution:{width:project.width,height:project.height},fps:project.fps,duration:project.duration,audioSampleRate:48000,audioChannels:2,hardwareAcceleration:input.hardwareAcceleration!==false,bitrate:input.bitrate??"auto",twoPass:input.twoPass===true,proxy:input.proxy===true,captionBurnIn:input.captionBurnIn===true};
}
export function validateEditorProject(project) {
  const errors=[]; const ids=new Set();
  for(const t of project.tracks??[]) for(const c of t.clips??[]) {
    if(ids.has(c.id)) errors.push("duplicate clip "+c.id); ids.add(c.id);
    if(c.duration<0||c.start<0) errors.push("invalid clip timing "+c.id);
  }
  return {ok:errors.length===0,errors,tracks:project.tracks?.length??0,clips:ids.size,captions:project.captions?.length??0};
}

function findClip(project,trackId,clipId){const t=project.tracks.find(x=>x.id===trackId);if(!t)throw new Error("Track not found");const clip=t.clips.find(x=>x.id===clipId);if(!clip)throw new Error("Clip not found");return {t,clip};}
function touch(project){project.updatedAt=new Date().toISOString();}
export function trimClip(project,trackId,clipId,{start,duration}={}){const {t,clip}=findClip(project,trackId,clipId);if(t.locked)throw new Error("Track is locked");if(start!=null)clip.start=Math.max(0,n(start,clip.start));if(duration!=null)clip.duration=Math.max(0,n(duration,clip.duration));touch(project);return clip;}
export function splitClip(project,trackId,clipId,time){const {t,clip}=findClip(project,trackId,clipId);if(t.locked)throw new Error("Track is locked");const cut=n(time,clip.start);if(cut<=clip.start||cut>=clip.start+clip.duration)throw new Error("Split time must be inside clip");const left={...structuredClone(clip),id:uid(),duration:cut-clip.start};const right={...structuredClone(clip),id:uid(),start:cut,duration:clip.start+clip.duration-cut};t.clips=t.clips.flatMap(x=>x.id===clipId?[left,right]:[x]);touch(project);return {left,right};}
export function moveClip(project,trackId,clipId,start,{ripple=false}={}){const {t,clip}=findClip(project,trackId,clipId);if(t.locked)throw new Error("Track is locked");const previous=clip.start;clip.start=Math.max(0,n(start,previous));if(ripple){const delta=clip.start-previous;for(const other of t.clips)if(other.id!==clip.id&&other.start>=previous)other.start=Math.max(0,other.start+delta);}t.clips.sort((a,b)=>a.start-b.start);touch(project);return clip;}
export function removeClip(project,trackId,clipId,{ripple=false}={}){const {t,clip}=findClip(project,trackId,clipId);if(t.locked)throw new Error("Track is locked");const end=clip.start+clip.duration;t.clips=t.clips.filter(x=>x.id!==clipId);if(ripple)for(const other of t.clips)if(other.start>=end)other.start=Math.max(0,other.start-clip.duration);project.duration=Math.max(0,...project.tracks.flatMap(x=>x.clips.map(y=>y.start+y.duration)),0);touch(project);return clip;}
export function snapshotEditor(project){return structuredClone(project);}
export function restoreEditor(project,snapshot){if(!snapshot||typeof snapshot!=="object")throw new TypeError("Invalid editor snapshot");return Object.assign(project,structuredClone(snapshot));}


export function setTrackState(project, trackId, patch={}) {
  const track=project.tracks.find(x=>x.id===trackId);
  if(!track) throw new Error("Track not found");
  for(const key of ["name","muted","solo","locked","visible","height"]) if(key in patch) track[key]=patch[key];
  touch(project);
  return track;
}
export function addTrackGroup(project, name="Group", trackIds=[]) {
  const ids=new Set(trackIds);
  const tracks=project.tracks.filter(t=>ids.has(t.id));
  if(!tracks.length) throw new Error("No tracks selected");
  const group={id:uid(),name:String(name),trackIds:tracks.map(t=>t.id),collapsed:false};
  project.groups??=[];
  project.groups.push(group);
  touch(project);
  return group;
}
export function toggleTrackGroup(project, groupId, collapsed) {
  const group=(project.groups??[]).find(x=>x.id===groupId);
  if(!group) throw new Error("Track group not found");
  group.collapsed=Boolean(collapsed);
  touch(project);
  return group;
}
export function snapTime(project, time, {trackId=null, threshold=0.12, excludeClipId=null}={}) {
  const target=Math.max(0,n(time,0));
  const points=[0,...(project.markers??[]).map(m=>n(m.time,0))];
  for(const track of project.tracks??[]) for(const clip of track.clips??[]) {
    if(trackId&&track.id!==trackId) continue;
    if(excludeClipId&&clip.id===excludeClipId) continue;
    points.push(n(clip.start,0),n(clip.start+clip.duration,0));
  }
  let best=target, distance=Number.POSITIVE_INFINITY;
  for(const point of points){const d=Math.abs(point-target);if(d<=Math.max(0,n(threshold,.12))&&d<distance){best=point;distance=d;}}
  return {time:best,snapped:best!==target,distance};
}
export function moveClipSnapped(project,trackId,clipId,start,options={}) {
  const {time,snapped}=snapTime(project,start,{...options,trackId,excludeClipId:clipId});
  return {...moveClip(project,trackId,clipId,time,options),snapped};
}
