/* APEX ANCHOR ephemeral WebRTC signaling relay.
 * It relays small offer/answer/ICE messages only; payload bytes never pass here.
 * No application data is written to Durable Object storage.
 */
const APP_IDS = new Set(["planet-apex", "xshield", "kernel-vision", "koin-kob", "kash-korner", "kernelodies"]);
const MAX_FRAME = 64 * 1024;
const MAX_TICKET_SECONDS = 15 * 60;
const decode64 = value => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4)), c => c.charCodeAt(0));
const validId = value => typeof value === "string" && /^[A-Za-z0-9_-]{8,80}$/.test(value);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });

export async function verifyApexSignalTicket(ticket, publicKeyBase64, now = Math.floor(Date.now() / 1000)) {
  if (typeof ticket !== "string" || ticket.length > 2048) throw new Error("Invalid signaling ticket");
  const [version, payload, signature, extra] = ticket.split(".");
  if (version !== "v1" || !payload || !signature || extra !== undefined) throw new Error("Malformed signaling ticket");
  const keyBytes = decode64(publicKeyBase64);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "Ed25519" }, false, ["verify"]);
  const signed = new TextEncoder().encode(version + "." + payload);
  if (!await crypto.subtle.verify({ name: "Ed25519" }, key, decode64(signature), signed)) throw new Error("Signaling ticket signature invalid");
  const fields = new TextDecoder("utf-8", { fatal: true }).decode(decode64(payload)).split("\n");
  if (fields.length !== 6 || fields[0] !== "apex-signal-v1") throw new Error("Invalid signaling claims");
  const [, appId, roomId, peerId, issuedRaw, expiresRaw] = fields;
  const issuedAt = Number(issuedRaw), expiresAt = Number(expiresRaw);
  if (!APP_IDS.has(appId) || !validId(roomId) || !validId(peerId)) throw new Error("Invalid signaling scope");
  if (!Number.isSafeInteger(issuedAt) || !Number.isSafeInteger(expiresAt) || issuedAt > now + 60 || expiresAt <= now || expiresAt <= issuedAt || expiresAt - issuedAt > MAX_TICKET_SECONDS) throw new Error("Signaling ticket expired");
  return { appId, roomId, peerId, issuedAt, expiresAt };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/health" && request.method === "GET") return json({ service: "apex-anchor-signal", status: "ready", payloadRelay: false, persistentAppStorage: false });
    if (url.pathname !== "/signal" || request.method !== "GET") return json({ error: "not found" }, 404);
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return json({ error: "WebSocket upgrade required" }, 426);
    try {
      const claims = await verifyApexSignalTicket(url.searchParams.get("ticket"), env.APEX_SIGNAL_PUBLIC_KEY);
      if (url.searchParams.get("app") !== claims.appId || url.searchParams.get("room") !== claims.roomId) return json({ error: "ticket scope mismatch" }, 403);
      const id = env.APEX_SIGNAL_ROOMS.idFromName(claims.appId + ":" + claims.roomId);
      const headers = new Headers(request.headers);
      headers.set("x-apex-app", claims.appId);
      headers.set("x-apex-room", claims.roomId);
      headers.set("x-apex-peer", claims.peerId);
      headers.set("x-apex-exp", String(claims.expiresAt));
      return env.APEX_SIGNAL_ROOMS.get(id).fetch(new Request(request, { headers }));
    } catch (error) {
      return json({ error: String(error?.message || "signaling authorization failed") }, 403);
    }
  }
};

export class ApexSignalRoom {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("WebSocket required", { status: 426 });
    const appId = request.headers.get("x-apex-app");
    const roomId = request.headers.get("x-apex-room");
    const peerId = request.headers.get("x-apex-peer");
    const expiresAt = Number(request.headers.get("x-apex-exp"));
    if (!APP_IDS.has(appId) || !validId(roomId) || !validId(peerId) || !Number.isSafeInteger(expiresAt) || expiresAt <= Math.floor(Date.now() / 1000)) return new Response("Invalid relay scope", { status: 403 });
    const sockets = this.ctx.getWebSockets();
    if (sockets.length >= 8) return new Response("Room is full", { status: 429 });
    if (sockets.some(socket => socket.deserializeAttachment()?.peerId === peerId)) return new Response("Peer ID already connected", { status: 409 });
    const pair = new WebSocketPair();
    const client = pair[0], server = pair[1];
    server.accept();
    server.serializeAttachment({ appId, roomId, peerId, expiresAt });
    server.addEventListener("message", event => this.route(server, event.data));
    server.addEventListener("close", () => this.broadcast({ type: "peer-left", peerId }, server));
    const peers = sockets.map(socket => socket.deserializeAttachment()?.peerId).filter(Boolean);
    server.send(JSON.stringify({ type: "joined", appId, roomId, peerId, peers }));
    this.broadcast({ type: "peer-joined", peerId }, server);
    return new Response(null, { status: 101, webSocket: client });
  }
  broadcast(message, except) {
    const frame = JSON.stringify(message);
    for (const socket of this.ctx.getWebSockets()) if (socket !== except && socket.readyState === WebSocket.OPEN) socket.send(frame);
  }
  route(socket, raw) {
    try {
      const claims = socket.deserializeAttachment();
      if (!claims || claims.expiresAt <= Math.floor(Date.now() / 1000)) { socket.close(1008, "ticket expired"); return; }
      if (typeof raw !== "string" || raw.length > MAX_FRAME) { socket.close(1009, "signaling frame too large"); return; }
      const message = JSON.parse(raw);
      if (!message || !["offer", "answer", "candidate", "bye"].includes(message.type) || !validId(message.to)) throw new Error("Invalid signaling message");
      const outbound = { type: message.type, from: claims.peerId, to: message.to };
      if (message.type === "offer" || message.type === "answer") {
        if (typeof message.sdp !== "string" || message.sdp.length > 48 * 1024) throw new Error("Invalid SDP payload");
        outbound.sdp = message.sdp;
      } else if (message.type === "candidate") {
        if (typeof message.candidate !== "string" || message.candidate.length > 4096) throw new Error("Invalid ICE candidate");
        outbound.candidate = message.candidate;
        outbound.sdpMid = typeof message.sdpMid === "string" ? message.sdpMid.slice(0, 128) : null;
        outbound.sdpMLineIndex = Number.isInteger(message.sdpMLineIndex) ? message.sdpMLineIndex : null;
      }
      const target = this.ctx.getWebSockets().find(peer => peer !== socket && peer.readyState === WebSocket.OPEN && peer.deserializeAttachment()?.peerId === message.to);
      if (!target) { socket.send(JSON.stringify({ type: "peer-unavailable", to: message.to })); return; }
      target.send(JSON.stringify(outbound));
      if (message.type === "bye") socket.send(JSON.stringify({ type: "bye-accepted", to: message.to }));
    } catch {
      socket.send(JSON.stringify({ type: "error", error: "invalid signaling frame" }));
    }
  }
};
