import { uid, now } from "./id.mjs";

export const PROVENANCE_CLASSES=Object.freeze([
  "scripture","historical","tradition","inference","dramatization"
]);

export const CLAIM_TYPES=Object.freeze([
  "fact","event","person","place","relationship","chronology","dialogue","interpretation"
]);

function clean(value){ return String(value??"").trim(); }

export function createTruthGraph(input={}){
  return {
    id:input.id??uid("truth"),
    version:1,
    entities:Array.isArray(input.entities)?input.entities.map(x=>({...x})):[],
    claims:Array.isArray(input.claims)?input.claims.map(x=>({...x})):[],
    links:Array.isArray(input.links)?input.links.map(x=>({...x})):[],
    createdAt:input.createdAt??now(),
    updatedAt:now()
  };
}

export function addEntity(graph,input={}){
  const name=clean(input.name);
  if(!name) throw new TypeError("entity name is required");
  const entity={id:input.id??uid("entity"),name,type:clean(input.type)||"unknown",aliases:[...(input.aliases??[])],sourceRefs:[...(input.sourceRefs??[])],metadata:{...(input.metadata??{})}};
  graph.entities.push(entity); graph.updatedAt=now(); return entity;
}

export function addClaim(graph,input={}){
  const text=clean(input.text);
  if(!text) throw new TypeError("claim text is required");
  const provenance=clean(input.provenance)||"inference";
  if(!PROVENANCE_CLASSES.includes(provenance)) throw new TypeError("Unknown provenance class");
  const type=clean(input.type)||"fact";
  if(!CLAIM_TYPES.includes(type)) throw new TypeError("Unknown claim type");
  const claim={
    id:input.id??uid("claim"),text,type,provenance,
    sourceRefs:[...(input.sourceRefs??[])],
    entityIds:[...(input.entityIds??[])],
    confidence:input.confidence??null,
    notes:clean(input.notes),
    metadata:{...(input.metadata??{})}
  };
  graph.claims.push(claim); graph.updatedAt=now(); return claim;
}

export function linkTruth(graph,input={}){
  const from=clean(input.from), to=clean(input.to), relation=clean(input.relation);
  if(!from||!to||!relation) throw new TypeError("link requires from, to, and relation");
  const link={id:input.id??uid("truth-link"),from,to,relation,sourceRefs:[...(input.sourceRefs??[])]};
  graph.links.push(link); graph.updatedAt=now(); return link;
}

export function claimsForEntity(graph,entityId){
  return (graph.claims??[]).filter(claim=>claim.entityIds?.includes(entityId));
}

export function auditTruthGraph(graph){
  const claims=Array.isArray(graph?.claims)?graph.claims:[];
  const missingSources=claims.filter(c=>c.provenance==="scripture"&&!c.sourceRefs?.length).map(c=>c.id);
  const invalidProvenance=claims.filter(c=>!PROVENANCE_CLASSES.includes(c.provenance)).map(c=>c.id);
  const invalidTypes=claims.filter(c=>!CLAIM_TYPES.includes(c.type)).map(c=>c.id);
  const dramatizationWithoutBoundary=claims.filter(c=>c.provenance==="dramatization"&&!c.metadata?.boundary).map(c=>c.id);
  const blockers=[
    ...missingSources.map(id=>({code:"scripture-source-missing",claimId:id})),
    ...invalidProvenance.map(id=>({code:"provenance-invalid",claimId:id})),
    ...invalidTypes.map(id=>({code:"claim-type-invalid",claimId:id})),
    ...dramatizationWithoutBoundary.map(id=>({code:"dramatization-boundary-missing",claimId:id}))
  ];
  return {
    ready:blockers.length===0,
    blockers,
    stats:{
      entities:(graph?.entities??[]).length,
      claims:claims.length,
      scriptureClaims:claims.filter(c=>c.provenance==="scripture").length,
      dramatizationClaims:claims.filter(c=>c.provenance==="dramatization").length,
      links:(graph?.links??[]).length
    }
  };
}

export function buildTruthGraphFromEpisode(episode={}){
  const graph=createTruthGraph();
  for(const ref of episode.sourceRefs??[]) addEntity(graph,{name:ref,type:"source",sourceRefs:[ref]});
  if(episode.title) addEntity(graph,{name:episode.title,type:"episode"});
  if(episode.passage||episode.storySummary){
    addClaim(graph,{
      text:episode.passage||episode.storySummary,
      type:"event",
      provenance:"scripture",
      sourceRefs:[...(episode.sourceRefs??[])],
      metadata:{boundary:"source-backed"}
    });
  }
  return graph;
}
