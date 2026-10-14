import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { createPeerModelBridgeServer } from '../../src/core/peer-model-bridge.mjs';

const modulePath = process.env.APEX_PEER_CAS_RUNTIME_MODULE;
const token = process.env.APEX_PEER_CAS_TOKEN;
const socketPath = process.env.APEX_PEER_CAS_SOCKET || '/tmp/apex_peer_cas.sock';
if (!modulePath || !token) throw new Error('runtime module and bridge token are required');
const absolute = path.resolve(modulePath);
const runtime = await import(pathToFileURL(absolute).href);
if (typeof runtime.getPeerModelBridgeContext !== 'function') {
  throw new Error('runtime module must export getPeerModelBridgeContext()');
}
const context = await runtime.getPeerModelBridgeContext();
const bridge = createPeerModelBridgeServer({
  store: context?.store,
  authorizeModel: context?.authorizeModel,
  token,
  socketPath
});
await bridge.listen();
process.stdout.write(JSON.stringify({
  status: 'listening',
  transport: 'unix-domain-socket',
  socketPath,
  namespace: context.store.namespace
}) + '\n');

let closing = false;
async function stop() {
  if (closing) return;
  closing = true;
  await bridge.close();
  process.exitCode = 0;
}
process.once('SIGTERM', stop);
process.once('SIGINT', stop);
