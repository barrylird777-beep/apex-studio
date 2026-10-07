import { randomUUID } from 'node:crypto';

const clients = new Set();
const MAX_CLIENTS = Math.max(1, Number(process.env.APEX_SSE_MAX_CLIENTS || 128));
const HEARTBEAT_MS = Math.max(5000, Number(process.env.APEX_SSE_HEARTBEAT_MS || 15000));
const ALLOWED_ORIGINS = new Set(
  String(process.env.APEX_SSE_ALLOWED_ORIGINS || "")
    .split(",")
    .map(value => value.trim())
    .filter(Boolean)
);

function send(res, event, data) {
  if (res.destroyed || res.writableEnded) return false;
  try {
    res.write("event: " + event + "\n");
    res.write("data: " + JSON.stringify(data) + "\n\n");
    return true;
  } catch {
    return false;
  }
}

function originAllowed(req) {
  if (ALLOWED_ORIGINS.size === 0) return true;
  const origin = String(req.headers.origin || "").trim();
  return !origin || ALLOWED_ORIGINS.has(origin);
}

export function publishOmniEvent(event, data = {}) {
  for (const client of [...clients]) {
    if (!send(client, event, data)) clients.delete(client);
  }
}

export function omniEventsHandler(req, res) {
  if (!originAllowed(req)) {
    res.status(403).json({ error: "SSE origin not allowed" });
    return;
  }

  if (clients.size >= MAX_CLIENTS) {
    res.status(503).set("Retry-After", "15").json({ error: "SSE connection capacity reached" });
    return;
  }

  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no"
  });
  res.flushHeaders?.();

  const clientId = randomUUID();
  const cleanup = () => {
    clearInterval(heartbeat);
    clients.delete(res);
  };

  clients.add(res);
  send(res, "omni.connected", {
    clientId,
    connectedAt: new Date().toISOString()
  });

  const heartbeat = setInterval(() => {
    if (!send(res, "omni.heartbeat", { at: new Date().toISOString() })) cleanup();
  }, HEARTBEAT_MS);
  heartbeat.unref?.();

  req.on("aborted", cleanup);
  req.on("close", cleanup);
  res.on("close", cleanup);
  res.on("error", cleanup);
}
