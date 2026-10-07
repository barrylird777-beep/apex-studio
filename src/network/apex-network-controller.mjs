import { searchAnything, fetchAnything, sanitizeOutboundHeaders, assertPublicUrl } from "../core/apex-web-search.mjs";

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

export async function gatewayFetch(target,{method="GET",headers={},body,signal,maxRedirects=5}={}) {
  let url=await assertPublicUrl(target);
  for(let redirects=0;;redirects++){
    const response=await fetch(url,{method,headers:sanitizeOutboundHeaders(headers),body,signal,redirect:"manual"});
    if(response.status>=300&&response.status<400){
      if(redirects>=Math.min(10,Math.max(0,Number(maxRedirects)||5)))throw new Error("Too many redirects");
      const location=response.headers.get("location");
      if(!location)throw new Error("Redirect without location");
      url=await assertPublicUrl(new URL(location,url).href);
      continue;
    }
    return response;
  }
}
export async function networkStatus(){
  return {
    capabilities:[...NETWORK_CAPABILITIES],
    searchEngines:["DuckDuckGo","Google","Bing"],
    outboundTransport:"standard fetch",
    outboundMetadataPolicy:"tracking headers stripped",
    ssrfPolicy:"public HTTP(S) targets only; DNS-resolved private/local addresses blocked",
    redirectPolicy:"every redirect revalidated",
    maxSearchResults:100,
    maxFetchBytes:20*1024*1024
  };
}
