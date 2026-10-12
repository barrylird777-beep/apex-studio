import { uid, now } from "./id.mjs";

const num=v=>Number.isFinite(Number(v))?Number(v):0;
const arr=v=>Array.isArray(v)?v:[];
const text=v=>String(v??"").trim();

export const SCRIPT_FORMATS=Object.freeze(["long-form","short","documentary","narration","episode"]);

export function createScriptPrompt(input={}){
 const topic=text(input.topic||input.subject);
 if(!topic)throw new Error("topic is required");
 const format=SCRIPT_FORMATS.includes(input.format)?input.format:"long-form";
 const targetWords=Math.max(30,num(input.targetWords)||1800);
 const facts=arr(input.facts).map(x=>typeof x==="string"?x:x?.text).filter(Boolean);
 const patterns=arr(input.analytics?.topPatterns).slice(0,15);
 return {
  id:uid("script"),format,topic,targetWords,
  prompt:[
   "Write a production-ready YouTube script.",
   "Topic: "+topic,
   "Format: "+format,
   "Target words: "+targetWords,
   "Audience: "+text(input.audience||"YouTube audience"),
   "Style: "+text(input.channelStyle||"cinematic documentary"),
   facts.length?"SOURCE FACTS:\n"+facts.join("\n"):"",
   patterns.length?"CHANNEL PERFORMANCE SIGNALS:\n"+patterns.map(JSON.stringify).join("\n"):"",
   "Open with a strong information gap. Maintain forward momentum with escalation, pattern interrupts and clear transitions. Deliver a satisfying payoff and natural ending.",
   "Do not invent factual claims. Mark material requiring verification.",
   "Return only the script."
  ].filter(Boolean).join("\n\n")
 };
}

export function analyzeChannelLifetime(input={}){
 const videos=arr(input.videos),daily=arr(input.daily),traffic=arr(input.traffic);
 const keys=["views","watchTimeMinutes","likes","comments","shares","subscribersGained","subscribersLost","impressions","engagedViews"];
 const totals=Object.fromEntries(keys.map(k=>[k,videos.reduce((z,x)=>z+num(x[k]),0)]));
 const ranked=videos.map(v=>({...v,
  engagementRate:(num(v.likes)+num(v.comments)+num(v.shares))/Math.max(1,num(v.views)),
  watchMinutesPerView:num(v.watchTimeMinutes)/Math.max(1,num(v.views)),
  audienceConversion:num(v.subscribersGained)/Math.max(1,num(v.views))
 })).sort((a,b)=>num(b.views)-num(a.views));
 const sources={};
 for(const r of traffic){
  const k=text(r.trafficSourceType||r.source||"unknown");
  sources[k]??={source:k,views:0,watchTimeMinutes:0};
  sources[k].views+=num(r.views); sources[k].watchTimeMinutes+=num(r.watchTimeMinutes);
 }
 const dates=videos.map(v=>v.publishedAt||v.date).filter(Boolean).sort();
 return {
  id:uid("channel-analysis"),generatedAt:now(),
  period:{first:dates[0]??null,last:dates.at(-1)??null},
  videoCount:videos.length,totals,
  averages:Object.fromEntries(keys.map(k=>[k,totals[k]/Math.max(1,videos.length)])),
  topVideos:ranked.slice(0,25),
  trafficSources:Object.values(sources).sort((a,b)=>b.views-a.views),
  trends:computeTrends(daily),
  topPatterns:ranked.slice(0,20)
 };
}

export function computeTrends(daily=[]){
 const rows=arr(daily).map(x=>({date:x.date||x.day,views:num(x.views),watchTimeMinutes:num(x.watchTimeMinutes),audienceGained:num(x.subscribersGained)})).filter(x=>x.date).sort((a,b)=>String(a.date).localeCompare(String(b.date)));
 if(rows.length<2)return {status:"insufficient-data",rows};
 const mid=Math.max(1,Math.floor(rows.length/2)),a=rows.slice(0,mid),b=rows.slice(mid);
 const avg=(set,key)=>set.reduce((z,x)=>z+x[key],0)/Math.max(1,set.length);
 const growth=(key)=>(avg(b,key)-avg(a,key))/Math.max(1,avg(a,key));
 return {status:"ok",rows,recent:{views:avg(b,"views"),watchTimeMinutes:avg(b,"watchTimeMinutes"),audienceGained:avg(b,"audienceGained")},prior:{views:avg(a,"views"),watchTimeMinutes:avg(a,"watchTimeMinutes"),audienceGained:avg(a,"audienceGained")},growth:{views:growth("views"),watchTimeMinutes:growth("watchTimeMinutes"),audience:growth("audienceGained")}};
}

export function findWinningPatterns(videos=[]){
 const rows=arr(videos);
 const buckets={};
 for(const v of rows){
  const key=text(v.topic||v.category||v.format||"uncategorized");
  buckets[key]??={pattern:key,count:0,views:0,watchTimeMinutes:0,engagement:0};
  buckets[key].count++;
  buckets[key].views+=num(v.views);
  buckets[key].watchTimeMinutes+=num(v.watchTimeMinutes);
  buckets[key].engagement+=(num(v.likes)+num(v.comments)+num(v.shares))/Math.max(1,num(v.views));
 }
 return Object.values(buckets).map(x=>({...x,averageViews:x.views/Math.max(1,x.count),averageWatchTime:x.watchTimeMinutes/Math.max(1,x.count),averageEngagement:x.engagement/Math.max(1,x.count)})).sort((a,b)=>b.averageViews-a.averageViews);
}
