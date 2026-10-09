import { spawn } from 'node:child_process';
import { request } from 'node:http';

const port = 18080;
const child = spawn(process.execPath, ['server.mjs'], {
  env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', NODE_ENV: 'test' },
  stdio: ['ignore', 'pipe', 'pipe']
});

let output = '';
child.stdout.on('data', chunk => { output += chunk.toString(); });
child.stderr.on('data', chunk => { output += chunk.toString(); });

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const getJson = path => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path, method: 'GET', timeout: 1000 }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => {
      let json;
      try {
        json = JSON.parse(body);
      } catch {
        return resolve({ status: res.statusCode, body, json: null });
      }
      return resolve({ status: res.statusCode, body, json });
    });
  });
  req.on('error', reject);
  req.on('timeout', () => req.destroy(new Error(`${path} request timeout`)));
  req.end();
});

try {
  let health = null;
  for (let i = 0; i < 30; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}\n${output}`);
    try {
      health = await getJson('/health');
      if (health.status === 200 && health.json?.status === 'ok') break;
    } catch {}
    await sleep(250);
  }

  if (health?.status !== 200 || health.json?.status !== 'ok') {
    throw new Error(`health endpoint did not report status=ok; last response: ${health?.body || 'no response'}\n${output}`);
  }

  const readiness = await getJson('/api/apex/readiness');
  const expectedApps = ['PlanetApeX', 'KoBlocks', 'KernelVision', 'KoinKob', 'KashKorner', 'Kernelodies'];
  const actualApps = readiness.json?.canonicalApps?.map(app => app.name);
  if (
    readiness.status !== 200 ||
    readiness.json?.success !== true ||
    readiness.json?.canonicalAppCount !== expectedApps.length ||
    JSON.stringify(actualApps) !== JSON.stringify(expectedApps)
  ) {
    throw new Error(`canonical app readiness check failed; response: ${readiness.body}`);
  }

  console.log('production server smoke: PASS (health status=ok; six canonical apps verified)');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
