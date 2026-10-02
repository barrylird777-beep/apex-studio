import crypto from "node:crypto";

export const PRIVACY_DEFAULTS=Object.freeze({
  telemetry:false,
  remoteProviders:false,
  remoteSync:false,
  crashReporting:false,
  localOnly:true
});

export function createPrivacyPolicy(input={}){
  const envRemote=process.env.APEX_ALLOW_REMOTE_PROVIDERS==="true";
  return {version:1,...PRIVACY_DEFAULTS,remoteProviders:envRemote,localOnly:!envRemote,...input,updatedAt:new Date().toISOString()};
}

export function fingerprint(value){
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

export function redact(value,keys=["token","password","secret","apiKey","authorization"]){
  if(Array.isArray(value)) return value.map(v=>redact(v,keys));
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,keys.includes(k)?"[REDACTED]":redact(v,keys)]));
  }
  return value;
}
