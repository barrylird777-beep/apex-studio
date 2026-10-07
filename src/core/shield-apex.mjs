import crypto from 'node:crypto';

export const SHIELD_APEX=Object.freeze({
  id:'ShieldApex',
  role:'network_security',
  principles:['least_privilege','fail_closed','auditability','boundary_enforcement','no_secret_logging']
});

export function createShieldApex({allowedOrigins=[],apiKeys=[],clock=()=>Date.now()}={}) {
  const origins=new Set(allowedOrigins.map(String));
  const keys=new Set(apiKeys.map(String));
  function authorizeApiKey(value){return typeof value==='string'&&value.length>0&&keys.has(value);}
  function authorizeOrigin(value){return !origins.size||(typeof value==='string'&&origins.has(value));}
  function issueRequestId(){return crypto.randomUUID();}
  function audit(event){return {id:issueRequestId(),at:new Date(clock()).toISOString(),event:String(event)};}
  return {authorizeApiKey,authorizeOrigin,issueRequestId,audit,status:()=>({origins:origins.size,configuredKeys:keys.size,principles:[...SHIELD_APEX.principles]})};
}
