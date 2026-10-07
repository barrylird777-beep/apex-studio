import { APEX_UNIVERSAL_CAPABILITIES as UNIVERSAL, APEX_EXECUTION_POLICY } from "./apex-universe.mjs";
export const APEX_UNIVERSAL_CAPABILITIES=UNIVERSAL;
export const APEX_LOCAL_POLICY=Object.freeze({
 preferred:"local",cloudRequired:false,telemetry:false,networkInferenceRequired:APEX_EXECUTION_POLICY.networkInferenceRequired,
 providerQuotaBypass:APEX_EXECUTION_POLICY.providerQuotaBypass,accountAbuse:APEX_EXECUTION_POLICY.accountAbuse,permanentIosDaemon:APEX_EXECUTION_POLICY.unrestrictedIosDaemon
});
const aliases=Object.freeze({ai:"local_ai",scripture:"scripture_research",visual:"visual_generation",audio:"audio_generation",video:"video_generation"});
export function normalizeApexCapability(value){const id=String(value||"").trim().toLowerCase();return UNIVERSAL.includes(id)?id:(aliases[id]||"local_ai");}
export function buildUniversalExecutionEnvelope(input={}){
 return {capability:normalizeApexCapability(input.capability),request:String(input.request||input.prompt||"").slice(0,20000),execution:{localPreferred:true,cloudFallbackAllowed:input.cloudFallbackAllowed!==false,requireOffline:input.requireOffline===true},provenance:{source:String(input.source||"apex").slice(0,500),originalExpressionRequired:true},createdAt:new Date().toISOString()};
}