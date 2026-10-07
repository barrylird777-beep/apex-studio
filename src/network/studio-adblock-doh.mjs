const DEFAULT_UPSTREAM = process.env.APEX_ADBLOCK_DOH_UPSTREAM || "https://dns.adguard-dns.com/dns-query";
const MAX_BODY = 65535;
const DIAGNOSTICS = process.env.APEX_DOH_DIAGNOSTICS === "1";

function parseQuestion(message){
  if(!Buffer.isBuffer(message)||message.length<12) throw Error("Invalid DNS message");
  let o=12; const labels=[];
  while(o<message.length){
    const n=message[o++];
    if(n===0) break;
    if((n&0xc0)!==0||n>63||o+n>message.length) throw Error("Invalid DNS QNAME");
    labels.push(message.subarray(o,o+n).toString("utf8")); o+=n;
  }
  if(o+4>message.length) throw Error("Incomplete DNS question");
  return {hostname:labels.join("."),questionEnd:o+4};
}
function decodeQueryParam(v){
  const s=String(v||"");
  return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4),"base64");
}
export async function initializeStudioAdBlock(){ return; }
export function studioAdBlockStatus(){
  return {enabled:false,mode:"passthrough-doh",blockedDomains:0,filtering:false,upstream:DEFAULT_UPSTREAM};
}
export async function handleStudioAdBlockDoH(req,res,url){
  if(req.method!=="GET"&&req.method!=="POST"){res.writeHead(405,{allow:"GET, POST"});res.end();return;}
  try{
    let query;
    if(req.method==="GET") query=decodeQueryParam(url.searchParams.get("dns"));
    else{
      const chunks=[]; let size=0;
      for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY) throw Error("DNS message too large");chunks.push(chunk);}
      query=Buffer.concat(chunks);
    }
    const {hostname}=parseQuestion(query);
    if(DIAGNOSTICS) console.log(JSON.stringify({event:"apex-doh-query",hostname,decision:"PASSTHROUGH",at:new Date().toISOString()}));
    const upstream=await fetch(DEFAULT_UPSTREAM,{method:"POST",headers:{"content-type":"application/dns-message",accept:"application/dns-message"},body:query,signal:AbortSignal.timeout(5000)});
    if(!upstream.ok) throw Error("upstream DNS HTTP "+upstream.status);
    const body=Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200,{"content-type":"application/dns-message","cache-control":"no-store"});
    res.end(body);
  }catch(e){
    if(DIAGNOSTICS) console.log(JSON.stringify({event:"apex-doh-error",error:e instanceof Error?e.message:"DNS request failed",at:new Date().toISOString()}));
    res.writeHead(400,{"content-type":"application/json","cache-control":"no-store"});
    res.end(JSON.stringify({error:e instanceof Error?e.message:"DNS request failed"}));
  }
}
