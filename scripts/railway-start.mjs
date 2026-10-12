import { spawn } from 'node:child_process';
import { createServer } from 'node:http';

const port = Number(process.env.PORT || 8080);
const host = '127.0.0.1';

process.on('uncaughtException', (error) => {
  console.error('[railway-start][uncaughtException]', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[railway-start][unhandledRejection]', reason);
});

if (process.env.APEX_QUIESCE_LEGACY_FOUNDATION === 'true') {
  const idle = createServer((req, res) => {
    if ((req.url || '').split('?')[0] === '/health') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ ok: true, mode: 'quiesced', storage: 'local-pure-wal' }));
      return;
    }
    res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify({ ok: false, mode: 'quiesced', error: 'Legacy foundation service is intentionally quiesced.' }));
  });
  idle.listen(port, '0.0.0.0', () => {
    console.log('[railway-start] legacy foundation quiesced; no PostgreSQL runtime or migrations');
  });
  const stop = (signal) => {
    console.log('[railway-start] quiesced service stopping', signal);
    idle.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 5000).unref();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
} else {
  const server = spawn(process.execPath, ['server.mjs'], {
    stdio: 'inherit',
    env: process.env
  });

  let serverExited = false;
  server.on('exit', (code, signal) => {
    serverExited = true;
    console.error(`[railway-start] server exited code=${code ?? 'null'} signal=${signal ?? 'null'}`);
    process.exit(code ?? 1);
  });

  async function waitForHealth(timeoutMs = 60000) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      if (serverExited) throw new Error('server process exited before health became available');

      try {
        const response = await fetch(`http://${host}:${port}/health`);
        if (response.status === 200) {
          const body = await response.text();
          console.log('[railway-start] health ready', body);
          return;
        }
        lastError = new Error(`health returned HTTP ${response.status}`);
      } catch (error) {
        lastError = error;
      }

      await new Promise(resolve => setTimeout(resolve, 250));
    }

    throw lastError || new Error('health endpoint did not become ready');
  }

  try {
    await waitForHealth();
    console.log('[railway-start] Pure-WAL mode; startup orchestration runs no database migrations');
  } catch (error) {
    console.error('[railway-start] startup orchestration failed', error);
    if (!serverExited) server.kill('SIGTERM');
    process.exit(1);
  }
}
