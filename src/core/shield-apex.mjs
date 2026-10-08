import crypto from 'node:crypto';

export const SHIELD_APEX=Object.freeze({
  id:'ShieldApex',
  role:'network_security',
  principles:['least_privilege','fail_closed','auditability','boundary_enforcement','no_secret_logging']
});

function digest(value){
  return crypto.createHash('sha256').update(String(value),'utf8').digest();
}

function safeEqual(left,right){
  return left.length===right.length && crypto.timingSafeEqual(left,right);
}

export function createShieldApex({allowedOrigins=[],apiKeys=[],clock=()=>Date.now()}={}) {
  const origins=new Set(
    allowedOrigins
      .filter(value=>typeof value==='string'&&value.length>0)
      .map(value=>value.trim())
  );
  const keyDigests=apiKeys
    .filter(value=>typeof value==='string'&&value.length>0)
    .map(digest);

  function authorizeApiKey(value){
    if(typeof value!=='string'||value.length===0||keyDigests.length===0) return false;
    const candidate=digest(value);
    return keyDigests.some(expected=>safeEqual(candidate,expected));
  }

  function authorizeOrigin(value){
    return typeof value==='string'&&origins.size>0&&origins.has(value.trim());
  }

  function issueRequestId(){return crypto.randomUUID();}

  function audit(event){
    return {
      id:issueRequestId(),
      at:new Date(clock()).toISOString(),
      event:String(event).slice(0,512)
    };
  }

  function authorizeCapability(grants,capability){
    if(!(grants instanceof Set)&&!Array.isArray(grants)) return false;
    const requested=String(capability??'').trim();
    return requested.length>0&&grants.includes
      ? grants.includes(requested)
      : grants instanceof Set && grants.has(requested);
  }

  return {
    authorizeApiKey,
    authorizeOrigin,
    authorizeCapability,
    issueRequestId,
    audit,
    status:()=>({
      origins:origins.size,
      configuredKeys:keyDigests.length,
      principles:[...SHIELD_APEX.principles]
    })
  };
}
