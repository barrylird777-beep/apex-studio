import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const scrypt=promisify(crypto.scrypt);
const LOOPBACK=new Set(["127.0.0.1","::1","::ffff:127.0.0.1"]);
const EXEMPT=new Set(["/owner-login","/owner-logout","/api/health","/sw.js","/manifest.webmanifest"]);
const sessions=new Map();
const challenges=new Map();
const fails=new Map();

const sha256=(b)=>crypto.createHash("sha256").update(b).digest();
const h=(s)=>sha256(String(s));
const same=(a,b)=>crypto.timingSafeEqual(h(a),h(b));
const b64u=(b)=>Buffer.from(b).toString("base64url");
const unb64u=(s)=>Buffer.from(String(s),"base64url");
const idleMs=()=>{
  const v=process.env.APEX_IDLE_MINUTES;
  if(v===undefined||v==="") return 30*60e3;
  const n=Number(v);
  return Number.isFinite(n)&&n>=0?n*60e3:30*60e3;
};
const ip=(req)=>String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"").split(",")[0].trim();
const isLocal=(req)=>LOOPBACK.has(req.socket.remoteAddress)&&!req.headers["x-forwarded-for"]&&process.env.APEX_REQUIRE_LOGIN_LOCAL!=="true";
function cookie(req,name){
  const m=(req.headers.cookie||"").split(";").map((c)=>c.trim()).find((c)=>c.startsWith(name+"="));
  return m?m.slice(name.length+1):"";
}
function origin(req){
  if(process.env.APEX_ORIGIN) return process.env.APEX_ORIGIN.replace(/\/$/,"");
  const proto=String(req.headers["x-forwarded-proto"]||(req.secure?"https":"http")).split(",")[0].trim();
  const host=String(req.headers["x-forwarded-host"]||req.headers.host||"").split(",")[0].trim();
  return `${proto}://${host}`;
}
const rpIdOf=(req)=>new URL(origin(req)).hostname;

const authFile=()=>path.resolve(process.env.APEX_AUTH_FILE||"./.apex_auth/owner.json");
let cache;
function loadAuth(){
  if(cache!==undefined) return cache;
  try{cache=JSON.parse(fs.readFileSync(authFile(),"utf8"));}catch{cache=null;}
  return cache;
}
function saveAuth(obj){
  const f=authFile();
  fs.mkdirSync(path.dirname(f),{recursive:true,mode:0o700});
  const tmp=`${f}.${process.pid}.tmp`;
  fs.writeFileSync(tmp,JSON.stringify(obj),{mode:0o600});
  fs.renameSync(tmp,f);
  cache=obj;
}

const hashPw=(pw,salt)=>scrypt(pw,salt,64,{N:32768,r:8,p:1,maxmem:128*1024*1024});
const pwOk=(pw)=>typeof pw==="string"&&pw.length>=10&&pw.length<=200;
async function checkPw(auth,pw){
  if(typeof pw!=="string"||pw.length>200) return false;
  const salt=unb64u(auth.password.salt);
  const got=await hashPw(pw,salt);
  const want=unb64u(auth.password.hash);
  return got.length===want.length&&crypto.timingSafeEqual(got,want);
}

function startSession(req,res){
  const sid=crypto.randomBytes(32).toString("hex");
  sessions.set(sid,{last:Date.now()});
  const secure=origin(req).startsWith("https")?"; Secure":"";
  res.setHeader("Set-Cookie",`apex_session=${sid}; Path=/; HttpOnly; SameSite=Strict${secure}; Max-Age=31536000`);
}
function touch(sid){
  const s=sessions.get(sid);
  if(!s) return false;
  const idle=idleMs();
  if(idle>0&&Date.now()-s.last>idle){sessions.delete(sid);return false;}
  s.last=Date.now();
  return true;
}
const isOwner=(req)=>isLocal(req)||touch(cookie(req,"apex_session"));
setInterval(()=>{
  const now=Date.now(),idle=idleMs();
  if(idle>0) for(const [k,v] of sessions) if(now-v.last>idle) sessions.delete(k);
  for(const [k,v] of challenges) if(v.exp<now) challenges.delete(k);
},60e3).unref();

const blocked=(who)=>{const f=fails.get(who);return !!f&&f.until>Date.now()&&f.n>=5;};
const fail=(who)=>{const f=fails.get(who);const n=f&&f.until>Date.now()?f.n+1:1;fails.set(who,{n,until:Date.now()+10*60e3});};

function cbor(buf,o=0){
  if(o>=buf.length) throw new Error("cbor eof");
  const ib=buf[o++],mt=ib>>5,ai=ib&31;
  let val;
  if(ai<24) val=ai;
  else if(ai===24){val=buf[o];o+=1;}
  else if(ai===25){val=buf.readUInt16BE(o);o+=2;}
  else if(ai===26){val=buf.readUInt32BE(o);o+=4;}
  else throw new Error("cbor unsupported");
  if(mt===0) return [val,o];
  if(mt===1) return [-1-val,o];
  if(mt===2||mt===3){
    if(o+val>buf.length) throw new Error("cbor length");
    return [mt===2?buf.subarray(o,o+val):buf.toString("utf8",o,o+val),o+val];
  }
  if(mt===4||mt===5){
    if(val>64) throw new Error("cbor too big");
    const out=mt===4?[]:new Map();
    for(let i=0;i<val;i++){
      let k,v;
      [k,o]=cbor(buf,o);
      if(mt===5){[v,o]=cbor(buf,o);out.set(k,v);}else out.push(k);
    }
    return [out,o];
  }
  throw new Error("cbor type");
}
function parseAuthData(ad){
  if(ad.length<37) throw new Error("authData short");
  const out={rpIdHash:ad.subarray(0,32),flags:ad[32],counter:ad.readUInt32BE(33)};
  if(out.flags&0x40){
    const len=ad.readUInt16BE(53);
    if(55+len>ad.length) throw new Error("credential length");
    out.credId=ad.subarray(55,55+len);
    out.cose=cbor(ad,55+len)[0];
  }
  return out;
}
function checkClient(cdjB64,type,challenge,req){
  const cdj=unb64u(cdjB64);
  const c=JSON.parse(cdj.toString("utf8"));
  if(c.type!==type||c.challenge!==challenge||c.origin!==origin(req)||c.crossOrigin) throw new Error("client data mismatch");
  return cdj;
}
function newChallenge(kind){
  const cid=crypto.randomBytes(16).toString("hex");
  const challenge=b64u(crypto.randomBytes(32));
  challenges.set(cid,{challenge,kind,exp:Date.now()+5*60e3});
  return {cid,challenge};
}
function takeChallenge(cid,kind){
  const c=challenges.get(cid);
  challenges.delete(cid);
  if(!c||c.kind!==kind||c.exp<Date.now()) throw new Error("challenge invalid");
  return c.challenge;
}

const CLIENT=`
const $=s=>document.querySelector(s);
const b64u=b=>btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\\+/g,"-").replace(/\\//g,"_").replace(/=+$/,"");
const unb=s=>{s=s.replace(/-/g,"+").replace(/_/g,"/");while(s.length%4)s+="=";return Uint8Array.from(atob(s),c=>c.charCodeAt(0)).buffer};
const post=(u,d)=>fetch(u,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(d||{}),credentials:"same-origin"}).then(async r=>({ok:r.ok,j:await r.json().catch(()=>({}))}));
const say=m=>{$("#msg").textContent=m};
`;
const STYLE=`<style>body{font-family:system-ui;background:#0d1117;color:#eee;display:grid;place-items:center;min-height:100vh;margin:0}main{display:grid;gap:12px;width:min(340px,90vw)}input,button{padding:14px;font-size:18px;border-radius:8px;border:1px solid #444;background:#161b22;color:#eee}button{background:#238636;border:0;color:#fff}button.alt{background:#30363d}#msg{color:#f85149;min-height:1.2em}a{color:#58a6ff}</style>`;
function page(res,body,script){
  const nonce=crypto.randomBytes(16).toString("base64");
  res.setHeader("Content-Security-Policy",`default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; connect-src 'self'; form-action 'none'; base-uri 'none'`);
  res.setHeader("Cache-Control","no-store");
  res.type("html").send(`<!doctype html><meta name=viewport content="width=device-width,initial-scale=1"><title>Apex</title>${STYLE}<body><main>${body}</main><script nonce="${nonce}">${CLIENT}${script}</script>`);
}
const LOGIN_BODY=`<h2 style="margin:0">Apex Studio</h2>
<div id=setup hidden><input id=code type=password placeholder="Setup code (from Railway)"><input id=np type=password placeholder="New password (10+ characters)" autocomplete=new-password><input id=np2 type=password placeholder="Repeat password" autocomplete=new-password><button id=bs>Create password</button></div>
<div id=login hidden style="display:none;gap:12px"><input id=pw type=password placeholder="Password" autocomplete=current-password><button id=bl>Log in</button><button id=bf class=alt hidden>Use Face ID</button></div><div id=msg></div>`;
const LOGIN_JS=`
(async()=>{
 const st=(await fetch("/owner/state").then(r=>r.json()));
 if(!st.setup){$("#setup").hidden=false;if(!st.enabled)say("Set APEX_COMMANDER_TOKEN on the server first.");}
 else{$("#login").style.display="grid";if(st.passkeys)$("#bf").hidden=false;}
})();
$("#bs").onclick=async()=>{if($("#np").value!==$("#np2").value)return say("Passwords do not match.");
 const r=await post("/owner/setup",{code:$("#code").value,password:$("#np").value});r.ok?location="/owner-security":say(r.j.error||"Failed");};
$("#bl").onclick=async()=>{const r=await post("/owner/login",{password:$("#pw").value});r.ok?location="/":say(r.j.error||"Failed");};
$("#pw").onkeydown=e=>{if(e.key==="Enter")$("#bl").click()};
$("#bf").onclick=async()=>{try{
 const o=await post("/owner/passkey/login-options");if(!o.ok)return say(o.j.error||"Failed");
 const pk=o.j.publicKey;pk.challenge=unb(pk.challenge);pk.allowCredentials=pk.allowCredentials.map(c=>({...c,id:unb(c.id)}));
 const cred=await navigator.credentials.get({publicKey:pk});const x=cred.response;
 const r=await post("/owner/passkey/login",{cid:o.j.cid,id:cred.id,authenticatorData:b64u(x.authenticatorData),clientDataJSON:b64u(x.clientDataJSON),signature:b64u(x.signature)});
 r.ok?location="/":say(r.j.error||"Face ID failed");}catch(e){say("Face ID cancelled or unavailable.");}};
`;
const SEC_BODY=`<h2 style="margin:0">Security</h2><div id=info></div>
<button id=add>Enable Face ID / Touch ID on this device</button><button id=rm class=alt>Remove all Face ID logins</button>
<a href="/">Back to app</a> · <a href="/owner-logout">Log out</a><div id=msg></div>`;
const SEC_JS=`
const refresh=async()=>{const s=await fetch("/owner/state").then(r=>r.json());$("#info").textContent="Face ID logins registered: "+s.passkeyCount};refresh();
$("#add").onclick=async()=>{try{
 const o=await post("/owner/passkey/register-options");if(!o.ok)return say(o.j.error||"Failed");
 const pk=o.j.publicKey;pk.challenge=unb(pk.challenge);pk.user.id=unb(pk.user.id);pk.excludeCredentials=(pk.excludeCredentials||[]).map(c=>({...c,id:unb(c.id)}));
 const cred=await navigator.credentials.create({publicKey:pk});const x=cred.response;
 const r=await post("/owner/passkey/register",{cid:o.j.cid,clientDataJSON:b64u(x.clientDataJSON),attestationObject:b64u(x.attestationObject)});
 say(r.ok?"Face ID enabled.":(r.j.error||"Failed"));refresh();}catch(e){say("Cancelled or not supported here.");}};
$("#rm").onclick=async()=>{const r=await post("/owner/passkey/remove-all");say(r.ok?"Removed.":"Failed");refresh();};
`;

export function ownerGate(req,res,next){
  if(EXEMPT.has(req.path)||req.path.startsWith("/owner/")) return next();
  if(isOwner(req)){req.apexOwner=true;return next();}
  if(req.path.startsWith("/api")) return res.status(401).json({error:"Owner only"});
  return res.redirect("/owner-login");
}
export function mountOwnerAuth(app){
  const wrap=(fn)=>(req,res)=>Promise.resolve(fn(req,res)).catch(()=>{if(!res.headersSent)res.status(400).json({error:"Request failed"});});
  const post=(p,fn)=>app.post(p,wrap(async(req,res)=>{
    const o=req.headers.origin;
    if(o&&o!==origin(req)) return res.status(403).json({error:"Bad origin"});
    req.body=req.body||{};
    return fn(req,res);
  }));
  const needOwner=(req,res)=>(isOwner(req)?true:(res.status(401).json({error:"Log in first"}),false));

  app.get("/owner/state",(req,res)=>{
    const a=loadAuth();
    res.setHeader("Cache-Control","no-store");
    res.json({setup:!!a,enabled:!!process.env.APEX_COMMANDER_TOKEN,passkeys:!!a&&a.passkeys.length>0,passkeyCount:a?a.passkeys.length:0});
  });
  app.get("/owner-login",(req,res)=>page(res,LOGIN_BODY,LOGIN_JS));
  app.get("/owner-security",(req,res)=>(isOwner(req)?page(res,SEC_BODY,SEC_JS):res.redirect("/owner-login")));
  app.get("/owner-logout",(req,res)=>{
    sessions.delete(cookie(req,"apex_session"));
    res.setHeader("Set-Cookie","apex_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Strict");
    res.redirect("/owner-login");
  });

  post("/owner/setup",async(req,res)=>{
    const token=process.env.APEX_COMMANDER_TOKEN,who=ip(req);
    if(loadAuth()) return res.status(409).json({error:"Already set up"});
    if(!token) return res.status(503).json({error:"Server has no APEX_COMMANDER_TOKEN"});
    if(blocked(who)) return res.status(429).json({error:"Too many tries. Wait 10 minutes."});
    if(typeof req.body.code!=="string"||!same(token,req.body.code)){fail(who);return res.status(401).json({error:"Wrong setup code"});}
    if(!pwOk(req.body.password)) return res.status(400).json({error:"Password must be 10 to 200 characters"});
    const salt=crypto.randomBytes(16),hash=await hashPw(req.body.password,salt);
    saveAuth({userId:b64u(crypto.randomBytes(32)),password:{salt:b64u(salt),hash:b64u(hash)},passkeys:[]});
    fails.delete(who);startSession(req,res);res.json({ok:true});
  });
  post("/owner/login",async(req,res)=>{
    const a=loadAuth(),who=ip(req);
    if(!a) return res.status(409).json({error:"Not set up"});
    if(blocked(who)) return res.status(429).json({error:"Too many tries. Wait 10 minutes."});
    if(!(await checkPw(a,req.body.password))){fail(who);return res.status(401).json({error:"Wrong password"});}
    fails.delete(who);startSession(req,res);res.json({ok:true});
  });
  post("/owner/passkey/login-options",async(req,res)=>{
    const a=loadAuth(),who=ip(req);
    if(!a||!a.passkeys.length) return res.status(404).json({error:"No Face ID registered"});
    if(blocked(who)) return res.status(429).json({error:"Too many tries. Wait 10 minutes."});
    const {cid,challenge}=newChallenge("get");
    res.json({cid,publicKey:{challenge,rpId:rpIdOf(req),userVerification:"required",timeout:60000,allowCredentials:a.passkeys.map((p)=>({type:"public-key",id:p.id}))}});
  });
  post("/owner/passkey/login",async(req,res)=>{
    const a=loadAuth(),who=ip(req);
    const bad=()=>{fail(who);return res.status(401).json({error:"Face ID failed"});};
    if(!a||blocked(who)) return res.status(429).json({error:"Try again later"});
    try{
      const challenge=takeChallenge(req.body.cid,"get");
      const pass=a.passkeys.find((p)=>p.id===req.body.id);
      if(!pass||pass.rpId!==rpIdOf(req)) return bad();
      const cdj=checkClient(req.body.clientDataJSON,"webauthn.get",challenge,req);
      const ad=unb64u(req.body.authenticatorData),p=parseAuthData(ad);
      if(!p.rpIdHash.equals(sha256(pass.rpId))||!(p.flags&0x01)||!(p.flags&0x04)) return bad();
      const key=crypto.createPublicKey({key:pass.jwk,format:"jwk"});
      const okSig=crypto.verify("sha256",Buffer.concat([ad,sha256(cdj)]),key,unb64u(req.body.signature));
      if(!okSig) return bad();
      if((p.counter!==0||pass.counter!==0)&&p.counter<=pass.counter) return bad();
      pass.counter=p.counter;saveAuth(a);fails.delete(who);startSession(req,res);return res.json({ok:true});
    }catch{return bad();}
  });
  post("/owner/passkey/register-options",async(req,res)=>{
    if(!needOwner(req,res)) return;
    const a=loadAuth();if(!a)return res.status(409).json({error:"Not set up"});
    const {cid,challenge}=newChallenge("create");
    res.json({cid,publicKey:{challenge,rp:{name:"Apex Studio",id:rpIdOf(req)},user:{id:a.userId,name:"owner",displayName:"Apex Owner"},pubKeyCredParams:[{type:"public-key",alg:-7}],authenticatorSelection:{authenticatorAttachment:"platform",residentKey:"preferred",userVerification:"required"},attestation:"none",timeout:60000,excludeCredentials:a.passkeys.map((p)=>({type:"public-key",id:p.id}))}});
  });
  post("/owner/passkey/register",async(req,res)=>{
    if(!needOwner(req,res)) return;
    const a=loadAuth(),challenge=takeChallenge(req.body.cid,"create");
    checkClient(req.body.clientDataJSON,"webauthn.create",challenge,req);
    const [att]=cbor(unb64u(req.body.attestationObject));
    const p=parseAuthData(att.get("authData"));
    if(!p.rpIdHash.equals(sha256(rpIdOf(req)))||!(p.flags&0x01)||!(p.flags&0x04)||!p.credId||!p.cose) return res.status(400).json({error:"Rejected"});
    if(p.cose.get(1)!==2||p.cose.get(3)!==-7||p.cose.get(-1)!==1) return res.status(400).json({error:"Unsupported key type"});
    const jwk={kty:"EC",crv:"P-256",x:b64u(p.cose.get(-2)),y:b64u(p.cose.get(-3))};
    crypto.createPublicKey({key:jwk,format:"jwk"});
    a.passkeys.push({id:b64u(p.credId),jwk,counter:p.counter,rpId:rpIdOf(req),created:new Date().toISOString()});
    saveAuth(a);res.json({ok:true});
  });
  post("/owner/passkey/remove-all",async(req,res)=>{
    if(!needOwner(req,res)) return;
    const a=loadAuth();a.passkeys=[];saveAuth(a);res.json({ok:true});
  });
}
export const skipForOwner=(mw)=>(req,res,next)=>(req.apexOwner?next():mw(req,res,next));