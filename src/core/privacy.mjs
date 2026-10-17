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
  // Caller-supplied options may add descriptive fields, but cannot silently
  // turn on telemetry, crash reporting, sync, or remote providers.
  return {
    version:1,
    ...input,
    ...PRIVACY_DEFAULTS,
    remoteProviders:envRemote,
    localOnly:!envRemote,
    updatedAt:new Date().toISOString()
  };
}

export function fingerprint(value){
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

function isSensitiveKey(key,keys){
  const normalized=String(key).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
  const parts=normalized.split(/[^a-z0-9]+/).filter(Boolean);
  if(keys.some(candidate=>normalized===String(candidate).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase())) return true;
  const sensitiveWords=new Set(["token","password","passwd","secret","authorization","credential","jwt","cookie"]);
  const benignTokenSuffixes=new Set(["in","out","address","symbol","id","name","type","amount","price","decimals","count","contract","chain"]);
  if(parts[0]==="token" && parts.length>1 && benignTokenSuffixes.has(parts[1]) && !parts.some(part=>["password","passwd","secret","authorization","credential","jwt","cookie"].includes(part))) return false;
  if(parts.some(part=>sensitiveWords.has(part))) return true;
  const pairs=new Set(["api_key","private_key","client_secret","access_key","refresh_key","signing_key","encryption_key","session_key"]);
  for(let i=0;i<parts.length-1;i++) if(pairs.has(parts[i]+"_"+parts[i+1])) return true;
  return parts.some(part=>["apikey","privatekey","clientsecret","accesskey","refreshkey","signingkey","encryptionkey","sessionkey"].includes(part));
}

function redactInlineSecrets(value){
  return value
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/(["']?\b(?:api[ _-]?key|access[ _-]?token|refresh[ _-]?token|client[ _-]?secret|private[ _-]?key|signing[ _-]?key|encryption[ _-]?key|session[ _-]?key|token|password|passwd|authorization|credential|secret|jwt|cookie)\b["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&}]+)/gi, "$1[REDACTED]");
}

export function redact(value,keys=["token","password","secret","apiKey","authorization"]){
  if(typeof value==="string") return redactInlineSecrets(value);
  if(Array.isArray(value)) return value.map(v=>redact(v,keys));
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,isSensitiveKey(k,keys)?"[REDACTED]":redact(v,keys)]));
  }
  return value;
}
