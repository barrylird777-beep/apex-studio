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


function normalizeRef(ref={}){
  return {type:"bible",version:String(ref.version??""),book:String(ref.book??""),chapter:Number(ref.chapter),verse:Number(ref.verse)};
}

export async function resolveBiblePassage(root,slug,passage,options={}){
  const match=String(passage??"").trim().match(/^(.+?)\\s+(\\d+):(\\d+)(?:-(\\d+))?$/);
  if(!match) throw new TypeError("Passage must look like Book 1:1 or Book 1:1-4.");
  const [,book,chapterRaw,startRaw,endRaw]=match;
  const chapter=Number(chapterRaw), start=Number(startRaw), end=endRaw?Number(endRaw):start;
  if(end<start) throw new RangeError("Passage verse range is reversed.");
  const bible=await (await import("../bible/library.mjs")).loadBibleEdition(root,slug);
  const target=(bible.books??[]).find(x=>String(x.book).toLowerCase()===book.toLowerCase());
  if(!target) throw new Error(`Book not found: ${book}`);
  const chapterData=target.chapters?.[chapter-1];
  if(!chapterData) throw new Error(`Chapter not found: ${book} ${chapter}`);
  const verses=(chapterData.verses??[]).filter(v=>Number(v.number)>=start&&Number(v.number)<=end);
  if(verses.length!==end-start+1) throw new Error(`Verse range not fully available: ${book} ${chapter}:${start}-${end}`);
  const sourceRefs=verses.map(v=>normalizeRef({version:slug,book:target.book,chapter,verse:v.number}));
  return {passage:`${target.book} ${chapter}:${start}${end===start?"":`-${end}`}`,version:slug,book:target.book,chapter,start,end,verses,sourceRefs,count:verses.length};
}

export function auditSourceRefs(sourceRefs=[]){
  const blockers=[];
  for(const ref of sourceRefs){
    if(!ref?.type||!ref?.version||!ref?.book||!Number.isInteger(Number(ref.chapter))||!Number.isInteger(Number(ref.verse)))
      blockers.push({code:"invalid-source-ref",ref});
  }
  return {ready:blockers.length===0,blockers,count:sourceRefs.length};
}
