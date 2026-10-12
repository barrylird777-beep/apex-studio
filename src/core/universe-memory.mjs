import { uid, now } from "./id.mjs";

const arr=v=>Array.isArray(v)?v:[];
const clean=v=>String(v??"").trim();

export function createUniverseMemory(input={}){
 return {
  id:input.id??uid("universe-memory"),
  version:"1.0.0",
  episodes:arr(input.episodes),
  characters:arr(input.characters),
  locations:arr(input.locations),
  props:arr(input.props),
  events:arr(input.events),
  threads:arr(input.threads),
  canonChanges:arr(input.canonChanges),
  unresolved:arr(input.unresolved),
  createdAt:input.createdAt??now(),
  updatedAt:now()
 };
}

export function recordEpisode(memory={},episode={}){
 const next={...memory,episodes:[...arr(memory.episodes).filter(x=>x.id!==episode.id),{
  id:episode.id,title:episode.title,passage:episode.passage,sourceRefs:arr(episode.sourceRefs),canonEntityIds:arr(episode.canonEntityIds),createdAt:episode.createdAt??now()
 }]};
 return {...next,updatedAt:now()};
}

export function recordThread(memory={},thread={}){
 const item={id:thread.id??uid("thread"),name:clean(thread.name),status:thread.status??"open",sourceRefs:arr(thread.sourceRefs),episodeIds:arr(thread.episodeIds),notes:clean(thread.notes),updatedAt:now()};
 return {...memory,threads:[...arr(memory.threads).filter(x=>x.id!==item.id),item],updatedAt:now()};
}

export function openThreads(memory={}){
 return arr(memory.threads).filter(thread=>thread.status==="open");
}

export function universeContext(memory={},query={}){
 const terms=arr(query.terms).map(clean).filter(Boolean);
 const match=item=>!terms.length||terms.some(term=>JSON.stringify(item).toLowerCase().includes(term.toLowerCase()));
 return {
  episodes:arr(memory.episodes).filter(match),
  characters:arr(memory.characters).filter(match),
  locations:arr(memory.locations).filter(match),
  events:arr(memory.events).filter(match),
  threads:arr(memory.threads).filter(match),
  unresolved:arr(memory.unresolved).filter(match)
 };
}

export function auditUniverseMemory(memory={}){
 const blockers=[];
 for(const thread of arr(memory.threads)) if(!thread.name) blockers.push({code:"thread-name-missing",message:"Universe thread has no name.",threadId:thread.id});
 for(const episode of arr(memory.episodes)) if(!episode.sourceRefs?.length) blockers.push({code:"episode-provenance-missing",message:"Stored episode has no source references.",episodeId:episode.id});
 return {ready:blockers.length===0,blockers,stats:{episodes:arr(memory.episodes).length,characters:arr(memory.characters).length,threads:arr(memory.threads).length,unresolved:arr(memory.unresolved).length}};
}
