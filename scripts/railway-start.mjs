import { spawn } from 'node:child_process';

const port = Number(process.env.PORT || 8080);
const host = process.env.HOST || '127.0.0.1';

process.on('uncaughtException', (error) => {
  console.error('[railway-start][uncaughtException]', error);
});

process.on('unhandledRejection', (reason) => {
  console.error('[railway-start][unhandledRejection]', reason);
});

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

async function runMigration() {
  console.log('[railway-start] running PostgreSQL migrations after HTTP bind');
  const migration = spawn(process.execPath, ['scripts/migrate-postgres.mjs'], {
    stdio: 'inherit',
    env: process.env
  });

  const code = await new Promise(resolve => migration.on('exit', resolve));
  if (code !== 0) {
    console.error(`[railway-start] PostgreSQL migration failed with exit code ${code}; HTTP server remains available for diagnosis`);
    return false;
  }

  console.log('[railway-start] PostgreSQL migrations complete');
  return true;
}

try {
  await waitForHealth();
  await runMigration();
} catch (error) {
  console.error('[railway-start] startup orchestration failed', error);
  if (!serverExited) server.kill('SIGTERM');
  process.exit(1);
}
