import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rm } from 'node:fs/promises';

const port = 18180 + (process.pid % 1000);
const root = path.join(tmpdir(), `apex-sigterm-race-${process.pid}`);
const child = spawn(process.execPath, ['server.mjs'], {
  env: {
    ...process.env,
    PORT: String(port),
    HOST: '127.0.0.1',
    NODE_ENV: 'test',
    APEX_SE_X_ROOT: root,
    APEX_PROJECTS_DIR: path.join(root, 'projects'),
    APEX_WAL_DIR: path.join(root, 'wal'),
    APEX_WAL_FILE: path.join(root, 'wal', 'ring.wal.jsonl')
  },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function get(pathname) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path: pathname, method: 'GET', timeout: 2000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${pathname} request timed out`)));
    req.end();
  });
}

async function waitForServer() {
  for (let i = 0; i < 40; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${output}`);
    try {
      const result = await get('/health');
      if (result.status === 200) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`server did not start\n${output}`);
}

try {
  await waitForServer();

  // This staging harness intentionally does not configure remote CAS credentials.
  // Therefore readiness must remain 503; it must never falsely claim sovereignty.
  const before = await get('/ready');
  assert.equal(before.status, 503, `unverified local-only runtime must not be ready: ${before.body}`);

  // Start a request and send SIGTERM in the same turn to exercise the accept/drain race.
  const racedRequest = get('/ready').then(
    result => ({ kind: 'response', ...result }),
    error => ({ kind: 'closed', error: String(error?.message || error) })
  );
  child.kill('SIGTERM');

  const raced = await Promise.race([racedRequest, sleep(2500).then(() => ({ kind: 'timeout' }))]);
  assert.notEqual(raced.kind, 'timeout', `raced /ready request hung; logs:\n${output}`);
  if (raced.kind === 'response') {
    assert.equal(raced.status, 503, `/ready must not return 200 while runtime is unverified: ${raced.body}`);
  } else {
    console.log('[race] request was rejected during listener close:', raced.error);
  }

  const exited = await Promise.race([
    child.exitCode !== null
      ? Promise.resolve({ code: child.exitCode, signal: null })
      : new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal }))),
    sleep(26000).then(() => null)
  ]);
  assert.ok(exited, `child exceeded supervisor drain window\n${output}`);
  assert.match(output, /graceful shutdown started/, 'SIGTERM handler did not log graceful shutdown');
  assert.match(output, /HTTP drain complete/, `HTTP server did not confirm drain completion\n${output}`);
  console.log(JSON.stringify({
    test: 'SIGTERM/readiness race',
    readinessBeforeShutdown: before.status,
    racedRequest: raced.kind === 'response' ? raced.status : raced.kind,
    childExit: exited,
    drainComplete: true
  }));
} finally {
  if (child.exitCode === null) child.kill('SIGKILL');
  await rm(root, { recursive: true, force: true });
}
