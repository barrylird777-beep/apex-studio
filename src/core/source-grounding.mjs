import { searchBibleEdition } from "../bible/library.mjs";
import { addStoryEntity, addStoryClaim, addStoryEvent, addChronology } from "./story-intelligence.mjs";

export async function groundPassageFromBible(root, slug, query, options={}) {
  const hits=await searchBibleEdition(root,slug,query,{limit:options.limit??100});
  const sourceRefs=hits.map(h=>({type:"bible",version:h.version,book:h.book,chapter:h.chapter,verse:h.verse}));
  return {query,version:slug,hits,sourceRefs,count:hits.length};
}

export function seedStoryIntelligenceFromHits(input={}) {
  const analysis=input.analysis??{entities:[],events:[],claims:[],chronology:[]};
  let result={...analysis,sourceRefs:[...(analysis.sourceRefs??[]),...(input.sourceRefs??[])]};
  for(const entity of input.entities??[]) result=addStoryEntity(result,{...entity,sourceRefs:entity.sourceRefs??input.sourceRefs??[]});
  for(const event of input.events??[]) result=addStoryEvent(result,{...event,sourceRefs:event.sourceRefs??input.sourceRefs??[]});
  for(const claim of input.claims??[]) result=addStoryClaim(result,{...claim,sourceRefs:claim.sourceRefs??input.sourceRefs??[]});
  for(const item of input.chronology??[]) result=addChronology(result,{...item,sourceRefs:item.sourceRefs??input.sourceRefs??[]});
  return result;
}

export function sourceGroundingPrompt(input={}) {
  return [
    "APEX SCRIPTURE GROUNDING",
    "Treat retrieved verse text as the source boundary.",
    "Every factual claim, event, entity, and chronology item must carry exact source references.",
    "Separate explicit Scripture from paraphrase, inference, history, tradition, and dramatization.",
    "Never invent dialogue, motives, chronology, miracles, relationships, or events.",
    input.context??""
  ].join("\n");
}
