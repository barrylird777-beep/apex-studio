import { createHash, randomUUID } from "node:crypto";
import pg from "pg";
import { createDurableJobsStore } from "../jobs/durable-jobs-store.mjs";
const { Pool } = pg;
const DEFAULT_FEEDS = ["https://trends.google.com/trending/rss?geo=US"];
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 15000, ssl: process.env.APEX_PG_SSL === "false" ? false : { rejectUnauthorized: false } }) : null;
const clean = (v,n=500) => String(v ?? "").replace(/[\\u0000-\\u001f\\u007f]/g," ").trim().slice(0,n);
const hash = v => createHash("sha256").update(String(v)).digest("hex");
const feeds = () => String(process.env.APEX_TREND_FEEDS || DEFAULT_FEEDS.join(",")).split(",").map(clean).filter(Boolean).slice(0,12);
function xmlItems(xml) {
  return [...String(xml).matchAll(/<item[\\s\\S]*?<\\/item>/gi)].map(m=>m[0]).map(item=>({
    title:clean((item.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i)?.[1]||"").replace(/<!\\[CDATA\\[|\\]\\]>/g,""),240),
    link:clean((item.match(/<link[^>]*>([\\s\\S]*?)<\\/link>/i)?.[1]||"").replace(/<!\\[CDATA\\[|\\]\\]>/g,""),1000),
    pubDate:clean(item.match(/<pubDate[^>]*>([\\s\\S]*?)<\\/pubDate>/i)?.[1]||"",80)
  })).filter(x=>x.title);
}
async function fetchFeed(url) {
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),10000);
  try { const r=await fetch(url,{headers:{"user-agent":"Apex-Rapid-Trend-Research/1.0"},signal:controller.signal}); if(!r.ok) throw new Error("trend feed HTTP "+r.status); return xmlItems(await r.text()).slice(0,30).map(x=>({...x,source:url})); }
  finally { clearTimeout(timer); }
}
export async function pollTrendSwarm() {
  if(!pool) return {durable:false,discovered:0,queued:0,errors:[]};
  const store=createDurableJobsStore(pool), discovered=[], errors=[];
  for(const url of feeds()) try { discovered.push(...await fetchFeed(url)); } catch(error) { errors.push({source:url,error:clean(error?.message||error,300)}); }
  let queued=0;
  for(const trend of discovered) {
    const fingerprint=hash(trend.source+"|"+trend.title.toLowerCase());
    const result=await store.enqueue({id:randomUUID(),type:"trend.analyze",payload:{trend:trend.title,source:trend.source,sourceUrl:trend.link||null,publishedAt:trend.pubDate||null,fingerprint,style:"original dark cinematic anime"},maxAttempts:5,dedupeKey:"trend:"+fingerprint,runAt:new Date()});
    if(result) queued++;
  }
  return {durable:true,discovered:discovered.length,queued,errors};
}
export async function closeTrendSwarm(){ if(pool) await pool.end(); }
