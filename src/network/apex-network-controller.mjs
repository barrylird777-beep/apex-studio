import { searchAnything, fetchAnything } from "../core/apex-web-search.mjs";

export const NETWORK_CAPABILITIES=Object.freeze([
  "public-web-search","multi-engine-search","https-fetch","source-discovery",
  "content-fetch","research-aggregation","network-diagnostics"
]);

export async function networkSearch(query,options={}){
  if(!String(query||"").trim())throw new Error("query required");
  return searchAnything(String(query),{limit:Math.min(100,Math.max(1,Number(options.limit)||20)),engines:options.engines||"all"});
}

export async function networkFetch(target,options={}){
  return fetchAnything(target,{maxBytes:Math.min(20*1024*1024,Math.max(1024,Number(options.maxBytes)||5*1024*1024))});
}

export async function networkResearch(query,{limit=20,engines="all"}={}){
  const search=await networkSearch(query,{limit,engines});
  const documents=[];
  for(const result of search.results||[]){
    if(!result.url)continue;
    try{
      const fetched=await networkFetch(result.url);
      documents.push({url:result.url,title:result.title||null,content:fetched.content||fetched.text||"",contentType:fetched.contentType||null});
    }catch(error){
      documents.push({url:result.url,error:String(error.message||error)});
    }
  }
  return {query:String(query),results:search.results||[],documents,errors:search.errors||[]};
}
