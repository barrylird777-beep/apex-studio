export class EgressPolicy {
 constructor(input={}){this.allowRemote=Boolean(input.allowRemote??false);this.allowedHosts=new Set(input.allowedHosts??[]);this.audit=[];}
 check(url,reason="unspecified"){
  const target=new URL(url);
  const allowed=this.allowRemote && (this.allowedHosts.size===0 || this.allowedHosts.has(target.hostname));
  const event={url:target.origin,hostname:target.hostname,allowed,reason,at:new Date().toISOString()};
  this.audit.push(event);
  if(!allowed) throw new Error("Network egress blocked by Apex policy: "+target.hostname);
  return event;
 }
 listAudit(){return [...this.audit];}
}