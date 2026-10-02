import { uid, now } from "./id.mjs";

export const CANON_TYPES=Object.freeze(["character","location","prop","faction","event","motif"]);
export const CANON_FIELDS=Object.freeze(["appearance","wardrobe","age","traits","relationships","injuries","props","architecture","environment","lighting","weather","history","motifs"]);

function clean(v){return String(v??"").trim();}
function clone(v){return v==null?v:JSON.parse(JSON.stringify(v));}

export function createWorldCanon(input={}){
 return {
  id:input.id??uid("canon"),version:1,
  entities:Array.isArray(input.entities)?clone(input.entities):[],
  relationships:Array.isArray(input.relationships)?clone(input.relationships):[],
  motifs:Array.isArray(input.motifs)?clone(input.motifs):[],
  events:Array.isArray(input.events)?clone(input.events):[],
  createdAt:input.createdAt??now(),updatedAt:now()
 };
}

export function addCanonEntity(canon,input={}){
 const name=clean(input.name);if(!name)throw new TypeError("canon entity name is required");
 const type=clean(input.type)||"character";if(!CANON_TYPES.includes(type))throw new TypeError("unknown canon type");
 const entity={id:input.id??uid("canon-entity"),name,type,aliases:[...(input.aliases??[])],state:clone(input.state??{}),locked:[...(input.locked??[])],sourceRefs:[...(input.sourceRefs??[])],episodeRefs:[...(input.episodeRefs??[])],approved:input.approved!==false,createdAt:now(),updatedAt:now()};
 canon.entities.push(entity);canon.updatedAt=now();return entity;
}

export function updateCanonEntity(canon,id,patch={}){
 const entity=canon.entities.find(x=>x.id===id);if(!entity)throw new Error("Canon entity not found");
 for(const key of entity.locked??[]) if(Object.prototype.hasOwnProperty.call(patch,key)) throw new Error("Canon field locked: "+key);
 Object.assign(entity,clone(patch),{updatedAt:now()});canon.updatedAt=now();return entity;
}

export function relateCanon(canon,input={}){
 const from=clean(input.from),to=clean(input.to),relation=clean(input.relation);
 if(!from||!to||!relation)throw new TypeError("relationship requires from, to, and relation");
 const x={id:input.id??uid("canon-rel"),from,to,relation,sourceRefs:[...(input.sourceRefs??[])],episodeRefs:[...(input.episodeRefs??[])]};
 canon.relationships.push(x);canon.updatedAt=now();return x;
}

export function recordCanonEvent(canon,input={}){
 const event={id:input.id??uid("canon-event"),name:clean(input.name),entityIds:[...(input.entityIds??[])],changes:clone(input.changes??{}),sourceRefs:[...(input.sourceRefs??[])],episodeId:input.episodeId??null,occurredAt:input.occurredAt??now()};
 canon.events.push(event);canon.updatedAt=now();return event;
}

export function auditCanon(canon,episode={}){
 const blockers=[];
 const entities=canon?.entities??[];
 const ids=new Set(entities.map(x=>x.id));
 for(const rel of canon?.relationships??[]){
  if(!ids.has(rel.from)||!ids.has(rel.to)) blockers.push({code:"canon-relationship-reference-missing",id:rel.id});
 }
 for(const entity of entities){
  if(!entity.name||!CANON_TYPES.includes(entity.type)) blockers.push({code:"canon-entity-invalid",id:entity.id});
  if(entity.approved===false&&episode.episodeRefs?.includes?.(entity.id)) blockers.push({code:"unapproved-canon-used",id:entity.id});
 }
 return {ready:blockers.length===0,blockers,stats:{entities:entities.length,relationships:(canon?.relationships??[]).length,events:(canon?.events??[]).length,motifs:(canon?.motifs??[]).length}};
}

export function canonForEpisode(canon,episodeId){
 return {
  entities:(canon?.entities??[]).filter(x=>x.episodeRefs?.includes(episodeId)),
  relationships:(canon?.relationships??[]).filter(x=>x.episodeRefs?.includes(episodeId)),
  events:(canon?.events??[]).filter(x=>x.episodeId===episodeId),
  motifs:clone(canon?.motifs??[])
 };
}
