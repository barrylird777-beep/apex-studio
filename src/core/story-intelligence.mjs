import { uid, now } from "./id.mjs";

export const CLAIM_CLASSES=Object.freeze(["scripture","historical","tradition","inference","dramatization"]);
export const EVENT_TYPES=Object.freeze(["action","speech","conflict","journey","revelation","miracle","decision","death","birth","relationship","setting"]);

function clean(v){return String(v??"").trim();}
function arr(v){return Array.isArray(v)?[...v]:[];}

export function createStoryIntelligence(input={}){
 return {
  id:input.id??uid("story-intel"),
  episodeId:input.episodeId??null,
  passage:clean(input.passage),
  sourceRefs:arr(input.sourceRefs),
  entities:arr(input.entities),
  events:arr(input.events),
  claims:arr(input.claims),
  chronology:arr(input.chronology),
  conflicts:arr(input.conflicts),
  uncertainties:arr(input.uncertainties),
  questions:arr(input.questions),
  createdAt:input.createdAt??now(),updatedAt:now()
 };
}

export function addStoryEntity(graph,input={}){
 const name=clean(input.name);if(!name)throw new TypeError("entity name is required");
 const entity={id:input.id??uid("story-entity"),name,type:clean(input.type)||"person",sourceRefs:arr(input.sourceRefs),attributes:{...(input.attributes??{})}};
 graph.entities.push(entity);graph.updatedAt=now();return entity;
}

export function addStoryEvent(graph,input={}){
 const type=clean(input.type)||"action";
 if(!EVENT_TYPES.includes(type))throw new TypeError("unknown event type");
 const event={id:input.id??uid("story-event"),type,title:clean(input.title),description:clean(input.description),entityIds:arr(input.entityIds),sourceRefs:arr(input.sourceRefs),sequence:input.sequence??null,certainty:input.certainty??"source-backed"};
 graph.events.push(event);graph.updatedAt=now();return event;
}

export function addStoryClaim(graph,input={}){
 const classification=clean(input.classification)||"scripture";
 if(!CLAIM_CLASSES.includes(classification))throw new TypeError("unknown claim classification");
 const claim={id:input.id??uid("story-claim"),text:clean(input.text),classification,sourceRefs:arr(input.sourceRefs),entityIds:arr(input.entityIds),certainty:input.certainty??"source-backed"};
 if(!claim.text)throw new TypeError("claim text is required");
 graph.claims.push(claim);graph.updatedAt=now();return claim;
}

export function addChronology(graph,input={}){
 const item={id:input.id??uid("story-order"),eventId:input.eventId,position:input.position??graph.chronology.length,relation:clean(input.relation)||"follows",sourceRefs:arr(input.sourceRefs)};
 graph.chronology.push(item);graph.updatedAt=now();return item;
}

export function auditStoryIntelligence(graph={}){
 const blockers=[];
 const entityIds=new Set((graph.entities??[]).map(x=>x.id));
 const eventIds=new Set((graph.events??[]).map(x=>x.id));
 for(const event of graph.events??[]) if((event.entityIds??[]).some(id=>!entityIds.has(id))) blockers.push({code:"event-entity-missing",id:event.id});
 for(const order of graph.chronology??[]) if(!eventIds.has(order.eventId)) blockers.push({code:"chronology-event-missing",id:order.id});
 for(const claim of graph.claims??[]) if(!CLAIM_CLASSES.includes(claim.classification)||!claim.sourceRefs?.length) blockers.push({code:"claim-provenance-missing",id:claim.id});
 return {ready:blockers.length===0,blockers,stats:{entities:(graph.entities??[]).length,events:(graph.events??[]).length,claims:(graph.claims??[]).length,chronology:(graph.chronology??[]).length,conflicts:(graph.conflicts??[]).length,uncertainties:(graph.uncertainties??[]).length}};
}

export function storyIntelligencePrompt({passage="",sourceRefs=[]}={}){
 return `Analyze this Bible passage as a source before writing entertainment.

PASSAGE:
${passage}

SOURCE REFERENCES:
${sourceRefs.join(", ")}

Extract only what can be supported by the supplied source. Separate:
1. People, places, objects, groups.
2. Explicit events and actions.
3. Explicit speech versus paraphrase.
4. Chronological relationships.
5. Conflicts and stakes directly supported by the text.
6. Unknowns and ambiguities that should NOT be silently invented.
7. Historical/traditional context, clearly separated from Scripture.
8. Potential dramatization opportunities, explicitly labeled as dramatization.

Every factual claim must carry exact source references.
Do not invent motives, dialogue, events, chronology, miracles, or relationships.`;
}
