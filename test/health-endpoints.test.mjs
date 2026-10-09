import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';

const port = 18081;
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test', DATABASE_URL: '' },
  stdio: ['ignore', 'pipe', 'pipe']
});
let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
function getJson(path) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 1000 }, res => {
      let body = '';
      res.on('data', chunk => { body += chunk.toString(); });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, json: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, json: null, body }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`${path} request timeout`)));
    req.end();
  });
}

test('liveness remains healthy while database readiness is blocked', async t => {
  t.after(async () => {
    child.kill('SIGTERM');
    await Promise.race([
      new Promise(resolve => child.once('exit', resolve)),
      sleep(3000)
    ]);
    if (child.exitCode === null) child.kill('SIGKILL');
  });

  let live;
  for (let i = 0; i < 40; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}\n${output}`);
    try { live = await getJson('/livez'); if (live.status === 200) break; } catch {}
    await sleep(250);
  }

  assert.equal(live?.status, 200, output);
  assert.equal(live.json?.status, 'live');
  assert.equal(live.json?.ok, true);

  const ready = await getJson('/readyz');
  assert.equal(ready.status, 503);
  assert.equal(ready.json?.status, 'not_ready');
  assert.equal(ready.json?.checks?.database?.configured, false);
  assert.equal(ready.json?.checks?.durableWorker?.status, 'blocked');
  assert.equal(ready.json?.checks?.process?.status, 'live');
});
