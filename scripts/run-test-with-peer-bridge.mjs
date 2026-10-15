import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { startTestPeerBridge } from '../test/helpers/test-peer-storage-bridge.mjs';

const file = process.argv[2];
if (!file || !file.endsWith('.mjs')) throw new Error('usage: node scripts/run-test-with-peer-bridge.mjs test/file.mjs');
const socketPath = path.join(tmpdir(), 'apex-peer-test-' + process.pid + '-' + randomUUID() + '.sock');
const peer = await startTestPeerBridge(socketPath);
let exitCode = 1;
try {
  const env = {
    ...process.env,
    NODE_ENV: process.env.NODE_ENV || 'test',
    APEX_APP_NAMESPACE: 'KernelVision',
    APEX_PEER_STORAGE_API_TOKEN_KERNELVISION: peer.tokens.KernelVision,
    APEX_PEER_STORAGE_API_SOCKET: socketPath
  };
  const child = spawn(process.execPath, ['--test', file], { stdio: 'inherit', env });
  exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', code => resolve(code ?? 1));
  });
} finally {
  await peer.close();
}
process.exitCode = exitCode;
