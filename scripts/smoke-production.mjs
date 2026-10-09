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
const getHealth = () => new Promise((resolve, reject) => {
  const req = request({ host: '127.0.0.1', port, path: '/health', method: 'GET', timeout: 1000 }, res => {
    let body = '';
    res.on('data', chunk => { body += chunk; });
    res.on('end', () => resolve({ status: res.statusCode, body }));
  });
  req.on('error', reject);
  req.on('timeout', () => req.destroy(new Error('health request timeout')));
  req.end();
});

try {
  let healthy = false;
  for (let i = 0; i < 30; i += 1) {
    if (child.exitCode !== null) throw new Error(`server exited with ${child.exitCode}\n${output}`);
    try {
      const result = await getHealth();
      if (result.status === 200) {
        let snapshot;
        try {
          snapshot = JSON.parse(result.body);
        } catch {
          throw new Error(`health endpoint returned invalid JSON: ${result.body.slice(0, 500)}`);
        }

        // HTTP 200 alone is not enough: /health intentionally reports degraded
        // runtime state with HTTP 200 to avoid coupling liveness to DB outages.
        const durableUnavailable = snapshot?.durable?.configured === true
          && snapshot?.durable?.available !== true;
        if (snapshot?.status === 'degraded' || durableUnavailable) {
          throw new Error(`health endpoint is degraded: ${JSON.stringify({
            status: snapshot?.status,
            durable: snapshot?.durable
          })}`);
        }

        healthy = true;
        break;
      }
    } catch {}
    await sleep(250);
  }
  if (!healthy) throw new Error(`production server did not become healthy\n${output}`);
  console.log('production server smoke: PASS');
} finally {
  child.kill('SIGTERM');
  await Promise.race([
    new Promise(resolve => child.once('exit', resolve)),
    sleep(3000)
  ]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
