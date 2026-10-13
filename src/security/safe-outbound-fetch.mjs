import dns from "node:dns/promises";
import net from "node:net";
import http from "node:http";
import https from "node:https";

const MAX_REDIRECTS = 3;
const DEFAULT_MAX_BYTES = 25 * 1024 * 1024;

function ipv4ToInt(value) {
  return value.split(".").reduce((n, part) => ((n * 256) + Number(part)) >>> 0, 0);
}
function inV4(address, network, bits) {
  const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
  return (ipv4ToInt(address) & mask) === (ipv4ToInt(network) & mask);
}
export function isPublicAddress(address) {
  const family = net.isIP(address);
  if (family === 4) {
    const blocked = [
      ["0.0.0.0",8],["10.0.0.0",8],["100.64.0.0",10],["127.0.0.0",8],
      ["169.254.0.0",16],["172.16.0.0",12],["192.0.0.0",24],["192.0.2.0",24],
      ["192.168.0.0",16],["198.18.0.0",15],["198.51.100.0",24],
      ["203.0.113.0",24],["224.0.0.0",4],["240.0.0.0",4]
    ];
    return !blocked.some(([network,bits])=>inV4(address,network,bits));
  }
  if (family === 6) {
    const value=address.toLowerCase().split("%")[0];
    if (value==="::"||value==="::1"||value.startsWith("::ffff:")||value.startsWith("fe8")||value.startsWith("fe9")||value.startsWith("fea")||value.startsWith("feb")||value.startsWith("fc")||value.startsWith("fd")||value.startsWith("ff")) return false;
    // Public IPv6 global-unicast space is 2000::/3; exclude documentation and special-use ranges.
    if (!/^[23]/.test(value) || value.startsWith("2001:db8:") || value.startsWith("2001:10:") || value.startsWith("2001:20:")) return false;
    return true;
  }
  return false;
}

function normalizeHost(hostname) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^\[|\]$/g, "");
}
export function validateOutboundUrl(input, { allowedHosts = [] } = {}) {
  let url;
  try { url = input instanceof URL ? new URL(input.href) : new URL(String(input)); }
  catch { throw new TypeError("Outbound URL is invalid"); }
  if (url.protocol !== "https:") throw new Error("Outbound requests must use HTTPS");
  if (url.username || url.password) throw new Error("Outbound URL credentials are forbidden");
  if (url.port && url.port !== "443") throw new Error("Outbound URL port is forbidden");
  const host=normalizeHost(url.hostname);
  if (!host || host==="localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".test") || host.endsWith(".invalid")) throw new Error("Outbound destination is not public");
  if (allowedHosts.length && !allowedHosts.some(entry=>host===normalizeHost(entry)||host.endsWith("."+normalizeHost(entry)))) throw new Error("Outbound host is not allowlisted");
  if (net.isIP(host) && !isPublicAddress(host)) throw new Error("Outbound destination resolves to a non-public address");
  url.hash="";
  return url;
}

function readResponse(response, maxBytes) {
  return new Promise((resolve,reject)=>{
    const chunks=[];let size=0;
    response.on("data",chunk=>{size+=chunk.length;if(size>maxBytes){response.destroy(new Error("Outbound response exceeds size limit"));return;}chunks.push(chunk);});
    response.on("end",()=>resolve(Buffer.concat(chunks)));
    response.on("error",reject);
  });
}
function makeResponse(status, headers, body) {
  const bytes=Buffer.from(body);
  return {
    status, ok:status>=200&&status<300,
    headers:{get(name){return headers[String(name).toLowerCase()]??null;}},
    async arrayBuffer(){return bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength);},
    async text(){return bytes.toString("utf8");},
    async json(){return JSON.parse(bytes.toString("utf8"));},
    body:{async cancel(){}}
  };
}

/**
 * HTTPS fetch with DNS pinning, private/reserved-address rejection, redirect
 * revalidation, timeout and response-size limits. Does not inherit ambient proxy
 * settings: deploy network policy should still restrict worker egress.
 */
export async function safeOutboundFetch(input, options = {}, {
  lookupAll = dns.lookup,
  requestImpl,
  maxRedirects = MAX_REDIRECTS,
  maxBytes = DEFAULT_MAX_BYTES,
  timeoutMs = 15000,
  allowedHosts = String(process.env.APEX_OUTBOUND_ALLOWED_HOSTS||"").split(",").map(s=>s.trim()).filter(Boolean)
} = {}) {
  const method=String(options.method||"GET").toUpperCase();
  if (!["GET","HEAD","POST","PUT","PATCH","DELETE"].includes(method)) throw new Error("Outbound HTTP method is not allowed");
  const headers={};
  const sourceHeaders=options.headers instanceof Headers ? Object.fromEntries(options.headers.entries()) : (options.headers||{});
  for (const [key,value] of Object.entries(sourceHeaders)) {
    if (/^(host|connection|proxy-authorization|transfer-encoding)$/i.test(key)) throw new Error("Forbidden outbound request header");
    headers[key]=String(value);
  }
  let url=validateOutboundUrl(input,{allowedHosts});
  for(let redirects=0;;redirects++){
    const host=normalizeHost(url.hostname);
    let records;
    if(net.isIP(host)) records=[{address:host,family:net.isIP(host)}];
    else records=await lookupAll(host,{all:true,verbatim:true});
    if(!records.length||records.some(record=>!isPublicAddress(record.address))) throw new Error("Outbound DNS result includes a non-public address");
    const selected=records[0];
    const transport=url.protocol==="https:"?https:http;
    if(url.protocol!=="https:") throw new Error("Outbound requests must use HTTPS");
    const request=await new Promise((resolve,reject)=>{
      const request=(requestImpl||transport.request)(url,{
        method,headers,agent:false,
        lookup:(_hostname,lookupOptions,callback)=>{
          if(lookupOptions?.all) callback(null,[{address:selected.address,family:selected.family}]);
          else callback(null,selected.address,selected.family);
        },
        servername:net.isIP(host)?undefined:host
      },resolve);
      request.setTimeout(timeoutMs,()=>request.destroy(new Error("Outbound request timed out")));
      request.on("error",reject);
      if(options.signal){
        if(options.signal.aborted) request.destroy(options.signal.reason||new Error("Outbound request aborted"));
        else options.signal.addEventListener("abort",()=>request.destroy(options.signal.reason||new Error("Outbound request aborted")),{once:true});
      }
      const body=options.body;
      if(body!==undefined&&body!==null){
        if(typeof body==="string"||Buffer.isBuffer(body)||body instanceof Uint8Array)request.write(body);
        else request.write(JSON.stringify(body));
      }
      request.end();
    });
    const status=request.statusCode||0;
    const responseHeaders={};for(const [key,value] of Object.entries(request.headers||{}))responseHeaders[key.toLowerCase()]=Array.isArray(value)?value.join(", "):String(value??"");
    if([301,302,303,307,308].includes(status)&&request.headers?.location){
      if(redirects>=maxRedirects)throw new Error("Outbound redirect limit exceeded");
      try{request.resume?.();}catch{}
      url=validateOutboundUrl(new URL(request.headers.location,url),{allowedHosts});
      if(status===303||(status===301||status===302)&&method==="POST")return safeOutboundFetch(url,{...options,method:"GET",body:undefined},{lookupAll,requestImpl,maxRedirects:0,maxBytes,timeoutMs,allowedHosts});
      continue;
    }
    const body=await readResponse(request,maxBytes);
    return makeResponse(status,responseHeaders,body);
  }
}
