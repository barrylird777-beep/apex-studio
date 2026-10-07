import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";

const TRACKING_HEADERS=Object.freeze([
  "cookie","authorization","origin","referer","user-agent","x-forwarded-for","x-forwarded-host",
  "x-forwarded-proto","x-real-ip","x-client-ip","x-request-id","x-correlation-id","traceparent",
  "tracestate","baggage","sentry-trace","sentry-baggage","x-amzn-trace-id","x-cloud-trace-context",
  "x-datadog-trace-id","x-datadog-parent-id","x-datadog-sampling-priority","x-instana-t","x-instana-l",
  "x-b3-traceid","x-b3-spanid","x-b3-sampled","x-b3-flags"
]);

export const PRIVACY_POLICY=Object.freeze({
  telemetry:false,
  requestLogging:false,
  outboundTrackingHeaders:false,
  secretLogging:false,
  failClosed:true
});

export function providerHeaders(headers={}){
  const out={};
  for(const [key,value] of Object.entries(headers||{})){
    if(TRACKING_HEADERS.includes(String(key).toLowerCase()) && String(key).toLowerCase()!=="authorization")continue;
    out[key]=value;
  }
  out["user-agent"]="Apex-Universal/1.0";
  return out;
}

export function privacyStatus(){
  return {
    ...PRIVACY_POLICY,
    nodeEnv:process.env.NODE_ENV||"development",
    configuredEncryption:Boolean(process.env.APEX_DATA_KEY)
  };
}

function key(){
  const raw=process.env.APEX_DATA_KEY;
  if(!raw)throw new Error("APEX_DATA_KEY is required for encrypted persistence");
  const digest=createHash("sha256").update(raw).digest();
  return digest;
}

export function encryptPrivate(value){
  const iv=randomBytes(12);
  const cipher=createCipheriv("aes-256-gcm",key(),iv);
  const plaintext=Buffer.from(JSON.stringify(value),"utf8");
  const ciphertext=Buffer.concat([cipher.update(plaintext),cipher.final()]);
  return {
    v:1,
    alg:"AES-256-GCM",
    iv:iv.toString("base64url"),
    tag:cipher.getAuthTag().toString("base64url"),
    data:ciphertext.toString("base64url")
  };
}

export function decryptPrivate(record){
  if(!record||record.v!==1||record.alg!=="AES-256-GCM")throw new Error("Invalid encrypted record");
  const decipher=createDecipheriv("aes-256-gcm",key(),Buffer.from(record.iv,"base64url"));
  decipher.setAuthTag(Buffer.from(record.tag,"base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(record.data,"base64url")),decipher.final()]).toString("utf8"));
}

export const privacyHeaders=providerHeaders;
export const sanitizeProviderHeaders=providerHeaders;
