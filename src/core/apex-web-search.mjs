import { createHash } from "node:crypto";
const timeoutMs=Math.max(1000,Math.min(120000,Number(process.env.APEX_WEB_SEARCH_TIMEOUT_MS||30000)));
const clean=v=>String(v??"").normalize("NFKC").trim();
const decode=v=>clean(v).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
const engines=[
 q=>"https://html.duckduckgo.com/html/?q="+encodeURIComponent(q),
 q=>"https://www.google.com/search?q="+encodeURIComponent(q),
 q=>"https://www.bing.com/search?q="+encodeURIComponent(q)
];
function parse(html,engine,limit){
 const out=[],seen=new Set();
 const patterns=engine==="ddg"?[/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi]:[/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi];
 for(const re of patterns){let m;while((m=re.exec(html))&&out.length<limit){let url=decode(m[1]);try{url=new URL(url,engine==="ddg"?"https://html.duckduckgo.com":"https://www.google.com").href;}catch{continue}if(!/^https?:$/.test(new URL(url).protocol)||seen.has(url))continue;const title=decode(m[2].replace(/<[^>]+>/g,"").replace(/\s+/g," "));if(!title||title.length<2)continue;seen.add(url);out.push({title,url,engine});}}
 return out;
}
async function request(url){const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(url,{signal:c.signal,redirect:"follow",headers:{"user-agent":"Apex-Universal-Research/2.0","accept":"text/html,application/xhtml+xml,application/json"}});if(!r.ok)throw new Error("HTTP "+r.status);return await r.text();}finally{clearTimeout(t);}}
export async function searchAnything(query,{limit=50,engines:"all"}={}){const q=clean(query);if(!q)throw new Error("Search query is required");const chosen=engines==="all"?enginesList():String(engines).split(",").map(clean).filter(Boolean);const results=[];const errors=[];for(const engine of chosen){try{const html=await request(engine.url(q));results.push(...parse(html,engine.name,Math.ceil(Number(limit)||50/chosen.length)));}catch(error){errors.push({engine:engine.name,error:String(error?.message||error)});}}const unique=[...new Map(results.map(x=>[x.url,x])).values()].slice(0,Math.max(1,Math.min(200,Number(limit)||50)));return{query:q,providers:chosen.map(x=>x.name),results,errors,requestHash:createHash("sha256").update(q).digest("hex")};}
function enginesList(){return[{name:"DuckDuckGo",url:engines[0]},{name:"Google",url:engines[1]},{name:"Bing",url:engines[2]}];}
export async function fetchAnything(target,{maxBytes=20971520}={}){const u=new URL(String(target));if(!/^https?:$/.test(u.protocol))throw new Error("Only HTTP(S) targets are supported");const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);try{const r=await fetch(u.href,{signal:c.signal,redirect:"follow",headers:{"user-agent":"Apex-Universal-Research/2.0"}});const b=Buffer.from(await r.arrayBuffer());if(b.length>maxBytes)throw new Error("Response exceeds configured fetch size");return{url:r.url,status:r.status,contentType:r.headers.get("content-type")||"",bytes:b.length,text:/^(text\/|application\/json|application\/xml)/i.test(r.headers.get("content-type")||"")?b.toString("utf8"):""};}finally{clearTimeout(t);}}
