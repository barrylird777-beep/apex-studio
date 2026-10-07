import fs from 'node:fs/promises';
import path from 'node:path';
import { paths } from '../src/core/sovereign-local-storage.mjs';
import { APEX_APPLICATIONS } from '../src/sovereign/apex-applications.mjs';
import { DurabilityState } from '../src/rdma/sovereign-rdma-transport.mjs';
import { VectorAccelerator } from '../src/vector/vector-accelerator.mjs';

for (const dir of [paths.ROOT, paths.WAL_DIR, paths.PROJECT_DIR]) {
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const mode = (await fs.stat(dir)).mode & 0o777;
  if (mode !== 0o700) throw new Error(`SE-X directory mode violation: ${dir} = ${mode.toString(8)}`);
}
if (APEX_APPLICATIONS.length !== 5) throw new Error('five-application registry incomplete');
if (DurabilityState.COMMITTED !== 'COMMITTED') throw new Error('RDMA durability state contract missing');
if (typeof VectorAccelerator.prototype.search !== 'function') throw new Error('vector accelerator contract missing');
console.log(JSON.stringify({ ok: true, root: paths.ROOT, applications: APEX_APPLICATIONS, rdmaStates: Object.values(DurabilityState) }));
