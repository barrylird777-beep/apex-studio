const DEFAULT_UPSTREAM = process.env.APEX_ADBLOCK_DOH_UPSTREAM || "https://dns.adguard-dns.com/dns-query";
const startedAt=Date.now();
let lastUpstreamCheck={ok:false,checkedAt:null,latencyMs:null,error:null};
const MAX_BODY = 65535;
const DIAGNOSTICS = process.env.APEX_DOH_DIAGNOSTICS === "1";

const BLOCKED_DOMAINS = [
  "doubleclick.net",
  "googlesyndication.com",
  "googleadservices.com",
  "adnxs.com",
  "adsrvr.org",
  "taboola.com",
  "outbrain.com",
  "rubiconproject.com",
  "pubmatic.com",
  "openx.net",
  "criteo.com"
];

function normalizeHost(value) {
  return String(value || "").trim().toLowerCase().replace(/^\.+|\.+$/g, "");
}

function isUnder(host, root) {
  const h = normalizeHost(host);
  const r = normalizeHost(root);
  return h === r || h.endsWith("." + r);
}

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
  return {
    hostname:normalizeHost(labels.join(".")),
    questionEnd:o+4,
    qtype:message.readUInt16BE(o),
    qclass:message.readUInt16BE(o+2)
  };
}

function decodeQueryParam(v){
  const s=String(v||"");
  return Buffer.from(s.replace(/-/g,"+").replace(/_/g,"/")+"===".slice((s.length+3)%4),"base64");
}

function blocked(hostname){
  return BLOCKED_DOMAINS.some(root => isUnder(hostname, root));
}

function blockedDnsResponse(query, questionEnd) {
  // DNS response: QR=1, RD copied, RA=1, NXDOMAIN. Echo the question only.
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2);
  const requestFlags = query.readUInt16BE(2);
  header.writeUInt16BE(0x8000 | (requestFlags & 0x0100) | 0x0080 | 0x0003, 2);
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(0, 6);
  header.writeUInt16BE(0, 8);
  header.writeUInt16BE(0, 10);
  return Buffer.concat([header, query.subarray(12, questionEnd)]);
}

export async function initializeStudioAdBlock(){
  try{await checkAdBlockUpstream();}catch{}
  return studioAdBlockStatus();
}

export async function checkAdBlockUpstream(){
  const started=Date.now();
  try{
    const r=await fetch(DEFAULT_UPSTREAM,{method:"POST",headers:{"content-type":"application/dns-message","accept":"application/dns-message"},body:Buffer.from([0,0,1,0,0,1,0,0,0,0,0,0,3,119,119,119,6,103,111,111,103,108,101,3,99,111,109,0,0,1,0,1]),signal:AbortSignal.timeout(4000)});
    if(!r.ok)throw Error("HTTP "+r.status);
    await r.arrayBuffer();
    lastUpstreamCheck={ok:true,checkedAt:new Date().toISOString(),latencyMs:Date.now()-started,error:null};
    return lastUpstreamCheck;
  }catch(error){lastUpstreamCheck={ok:false,checkedAt:new Date().toISOString(),latencyMs:Date.now()-started,error:String(error?.message||error)};throw error;}
}

export function studioAdBlockStatus(){
  return {
    enabled:true,
    mode:"dns-blocking-doh",
    blockedDomains:BLOCKED_DOMAINS.length,
    filtering:true,
    upstream:DEFAULT_UPSTREAM,
    uptimeMs:Date.now()-startedAt,
    upstreamHealth:lastUpstreamCheck,
    persistence:"process-independent; client profile remains installed until user removes it",
    primaryFailureMode:"remote DoH endpoint unavailable or DNS profile not active",
    safariCompanionRequired:true
  };
}

export async function handleStudioAdBlockDoH(req,res,url){
  if(req.method!=="GET"&&req.method!=="POST"){res.writeHead(405,{allow:"GET, POST"});res.end();return;}
  try{
    let query;
    if(req.method==="GET") query=decodeQueryParam(url.searchParams.get("dns"));
    else{
      const chunks=[]; let size=0;
      for await(const chunk of req){
        size+=chunk.length;
        if(size>MAX_BODY) throw Error("DNS message too large");
        chunks.push(chunk);
      }
      query=Buffer.concat(chunks);
    }

    const {hostname,questionEnd}=parseQuestion(query);

    if(blocked(hostname)){
      if(DIAGNOSTICS) console.log(JSON.stringify({
        event:"apex-doh-query",
        hostname,
        decision:"BLOCK",
        at:new Date().toISOString()
      }));
      const body=blockedDnsResponse(query,questionEnd);
      res.writeHead(200,{"content-type":"application/dns-message","cache-control":"no-store"});
      res.end(body);
      return;
    }

    if(DIAGNOSTICS) console.log(JSON.stringify({
      event:"apex-doh-query",
      hostname,
      decision:"PASSTHROUGH",
      at:new Date().toISOString()
    }));

    const upstream=await fetch(DEFAULT_UPSTREAM,{
      method:"POST",
      headers:{
        "content-type":"application/dns-message",
        accept:"application/dns-message"
      },
      body:query,
      signal:AbortSignal.timeout(5000)
    });
    if(!upstream.ok) throw Error("upstream DNS HTTP "+upstream.status);
    const body=Buffer.from(await upstream.arrayBuffer());
    res.writeHead(200,{"content-type":"application/dns-message","cache-control":"no-store"});
    res.end(body);
  }catch(e){
    if(DIAGNOSTICS) console.log(JSON.stringify({
      event:"apex-doh-error",
      error:e instanceof Error?e.message:"DNS request failed",
      at:new Date().toISOString()
    }));
    res.writeHead(400,{"content-type":"application/json","cache-control":"no-store"});
    res.end(JSON.stringify({error:e instanceof Error?e.message:"DNS request failed"}));
  }
}
