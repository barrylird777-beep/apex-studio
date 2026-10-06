import { randomUUID } from 'node:crypto';

const clients = new Set();

function send(res, event, data) {
  res.write('event: ' + event + '\n');
  res.write('data: ' + JSON.stringify(data) + '\n\n');
}

export function publishOmniEvent(event, data = {}) {
  for (const client of clients) {
    try {
      send(client, event, data);
    } catch {
      clients.delete(client);
    }
  }
}

export function omniEventsHandler(req, res) {
  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  res.flushHeaders?.();

  const clientId = randomUUID();
  clients.add(res);
  send(res, 'omni.connected', { clientId, connectedAt: new Date().toISOString() });

  const heartbeat = setInterval(() => {
    try {
      res.write(': apex-omni-heartbeat\\n\\n');
    } catch {
      cleanup();
    }
  }, 15000);
  heartbeat.unref?.();

  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(res);
  };

  req.on('close', cleanup);
  res.on('error', cleanup);
}
