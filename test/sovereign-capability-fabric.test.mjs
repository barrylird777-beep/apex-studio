import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

process.env.APEX_SEX_ROOT = await mkdtemp(join(tmpdir(), 'apex-se-test-'));

test('sovereign capability fabric and self-healing modules load', async () => {
  const { ApexCapabilityFabric } = await import('../src/core/apex-capability-fabric.mjs');
  const { ApexSelfHealing } = await import('../src/core/apex-self-healing.mjs');
  const { createSovereignIdentity, verifySelfSignedJwt } = await import('../src/security/sovereign-identity.mjs');

  const fabric = new ApexCapabilityFabric({ nodeId:'test-node' });
  assert.equal(fabric.status().nodeId, 'test-node');
  assert.ok(fabric.status().capabilities.includes('render'));

  let recovered = 0;
  const healer = new ApexSelfHealing({
    name:'test',
    maxRetries:1,
    run: async ({}) => { if (recovered === 0) throw new Error('transient'); return 'ok'; },
    recover: async () => { recovered++; }
  });
  assert.equal(await healer.execute({}), 'ok');

  const identity = await createSovereignIdentity();
  const token = await identity.issue({ peerId:'test-peer' });
  const claims = verifySelfSignedJwt(token, identity.identityId);
  assert.equal(claims.peerId, 'test-peer');
});
