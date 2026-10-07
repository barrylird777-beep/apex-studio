import { ApexCapabilityFabric } from '../core/apex-capability-fabric.mjs';

export const capabilityFabric = new ApexCapabilityFabric();

export async function handleApexCapabilityApi({ method, path, body, send }) {
  if (method === 'GET' && path === '/api/apex/capabilities') return send(200, capabilityFabric.status());
  if (method === 'POST' && path === '/api/apex/capabilities/heartbeat') {
    if (!body || typeof body.nodeId !== 'string' || !body.nodeId) return send(400,{error:'nodeId is required'});
    return send(200, capabilityFabric.heartbeat(body.nodeId, body.resources || {}));
  }
  if (method === 'POST' && path === '/api/apex/capabilities/submit') {
    if (!body || typeof body.operation !== 'string' || !body.operation) return send(400,{error:'operation is required'});
    const result=await capabilityFabric.submit(body.operation,body.payload || {},{
      capability:body.capability || body.operation,
      cache:body.cache !== false,
      ttlMs:body.ttlMs
    });
    return send(202,result);
  }
  return false;
}
