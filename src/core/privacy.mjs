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

const DEFAULT_SECRET_KEY_PATTERN=/(?:^|[_-])(token|password|passwd|secret|api[_-]?key|authorization|credential|private[_-]?key|client[_-]?secret|access[_-]?key|refresh[_-]?key)(?:$|[_-])/i;
const DEFAULT_SECRET_COMPACT_PATTERN=/(?:^|[^a-z0-9])(access|refresh)?token|password|passwd|secret|apikey|authorization|credential|privatekey|clientsecret|accesskey|refreshkey/i;

function isSensitiveKey(key,keys){
  const normalized=String(key).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase();
  if(keys.some(candidate=>normalized===String(candidate).replace(/([a-z0-9])([A-Z])/g,"$1_$2").toLowerCase())) return true;
  return DEFAULT_SECRET_KEY_PATTERN.test(normalized)||DEFAULT_SECRET_COMPACT_PATTERN.test(normalized);
}

function redactInlineSecrets(value){
  return value
    .replace(/\\b(Bearer\\s+)[A-Za-z0-9._~+/=-]+/gi, "$1[REDACTED]")
    .replace(/\\b((?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|passwd|authorization|secret)\\s*[:=]\\s*)(?:"[^"]*"|'[^']*'|[^\\s,;&}]+)/gi, "$1[REDACTED]");
}

export function redact(value,keys=["token","password","secret","apiKey","authorization"]){
  if(typeof value==="string") return redactInlineSecrets(value);
  if(Array.isArray(value)) return value.map(v=>redact(v,keys));
  if(value&&typeof value==="object"){
    return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,isSensitiveKey(k,keys)?"[REDACTED]":redact(v,keys)]));
  }
  return value;
}
