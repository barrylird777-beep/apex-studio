import { createHash } from "node:crypto";
import { lookup } from "node:dns/promises";
import net from "node:net";

const timeoutMs=Math.max(1000,Math.min(120000,Number(process.env.APEX_WEB_SEARCH_TIMEOUT_MS||30000)));
const clean=v=>String(v??"").normalize("NFKC").trim();
const decode=v=>clean(v).replace(/&amp;/g,"&").replace(/&quot;/g,'"').replace(/&#x27;/g,"'").replace(/&lt;/g,"<").replace(/&gt;/g,">");
const engines=[
  {name:"DuckDuckGo",url:q=>"https://html.duckduckgo.com/html/?q="+encodeURIComponent(q)},
  {name:"Google",url:q=>"https://www.google.com/search?q="+encodeURIComponent(q)},
  {name:"Bing",url:q=>"https://www.bing.com/search?q="+encodeURIComponent(q)}
];

function privateIp(ip){
  if(net.isIPv4(ip)){const [a,b]=ip.split(".").map(Number);return a===10||a===127||a===0||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&b===168)||a>=224;}
  if(net.isIPv6(ip)){const x=ip.toLowerCase();return x==="::1"||x==="::"||x.startsWith("fc")||x.startsWith("fd")||x.startsWith("fe8")||x.startsWith("fe9")||x.startsWith("fea")||x.startsWith("feb");}
  return true;
}
async function assertPublicUrl(target){
  const u=new URL(String(target));
  if(!["http:","https:"].includes(u.protocol))throw new Error("Only HTTP(S) targets are supported");
  const host=u.hostname.replace(/^\[|\]$/g,"").toLowerCase();
  if(["localhost","localhost.localdomain","metadata.google.internal"].includes(host)||host.endsWith(".local")||host.endsWith(".internal"))throw new Error("Private/local targets are blocked");
  if(net.isIP(host)){if(privateIp(host))throw new Error("Private/local IP targets are blocked");}
  else {
    const records=await lookup(host,{all:true,verbatim:true});
    if(!records.length||records.some(r=>privateIp(r.address)))throw new Error("Target resolves to a private/local address");
  }
  return u;
}

function parse(html,engine,limit){
  const out=[],seen=new Set();
  const patterns=engine==="ddg"
    ? [/<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi]
    : [/<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi];
  for(const re of patterns){let m;while((m=re.exec(html))&&out.length<limit){
    let url=decode(m[1]);try{url=new URL(url,engine==="ddg"?"https://html.duckduckgo.com":"https://www.google.com").href;}catch{continue}
    if(!/^https?:$/.test(new URL(url).protocol)||seen.has(url))continue;
    const title=decode(m[2].replace(/<[^>]+>/g,"").replace(/\s+/g," "));if(!title||title.length<2)continue;
    seen.add(url);out.push({title,url,engine});
  }}
  return out;
}

async function request(url){
  const safe=await assertPublicUrl(url),c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
  try{const r=await fetch(safe.href,{signal:c.signal,redirect:"manual",headers:{"user-agent":"Apex-Universal-Research/3.0","accept":"text/html,application/xhtml+xml,application/json"}});
    if(r.status>=300&&r.status<400){const location=r.headers.get("location");if(!location)throw new Error("Redirect without location");return request(new URL(location,safe).href);}
    if(!r.ok)throw new Error("HTTP "+r.status);return await r.text();
  }finally{clearTimeout(t);}
}

export async function searchAnything(query,{limit=50,engines:"all"}={}){
  const q=clean(query);if(!q)throw new Error("Search query is required");
  const chosen=engines==="all"?enginesList():enginesList().filter(x=>String(engines).split(",").map(clean).includes(x.name));
  if(!chosen.length)throw new Error("No valid search engine selected");
  const results=[],errors=[];
  for(const engine of chosen)try{results.push(...parse(await request(engine.url(q)),engine.name==="DuckDuckGo"?"ddg":engine.name,Math.ceil((Number(limit)||50)/chosen.length)));}catch(error){errors.push({engine:engine.name,error:String(error?.message||error)});}
  const unique=[...new Map(results.map(x=>[x.url,x])).values()].slice(0,Math.max(1,Math.min(200,Number(limit)||50)));
  return{query:q,providers:chosen.map(x=>x.name),results:unique,errors,requestHash:createHash("sha256").update(q).digest("hex")};
}
function enginesList(){return engines;}

export async function fetchAnything(target,{maxBytes=20971520}={}){
  let url=await assertPublicUrl(target);
  for(let redirects=0;redirects<=5;redirects++){
    const c=new AbortController(),t=setTimeout(()=>c.abort(),timeoutMs);
    try{
      const r=await fetch(url.href,{signal:c.signal,redirect:"manual",headers:{"user-agent":"Apex-Universal-Research/3.0","accept":"text/html,application/xhtml+xml,application/json,text/plain"}});
      if(r.status>=300&&r.status<400){
        const location=r.headers.get("location");if(!location)throw new Error("Redirect without location");
        url=await assertPublicUrl(new URL(location,url).href);continue;
      }
      if(!r.ok)throw new Error("HTTP "+r.status);
      const length=Number(r.headers.get("content-length")||0);if(length>maxBytes)throw new Error("Response exceeds configured fetch size");
      const b=Buffer.from(await r.arrayBuffer());if(b.length>maxBytes)throw new Error("Response exceeds configured fetch size");
      const contentType=r.headers.get("content-type")||"";
      return{url:r.url,status:r.status,contentType,bytes:b.length,text:/^(text\/|application\/json|application\/xml)/i.test(contentType)?b.toString("utf8"):""};
    }finally{clearTimeout(t);}
  }
  throw new Error("Too many redirects");
}
