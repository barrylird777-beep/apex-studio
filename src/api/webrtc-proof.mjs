import express from "express";
import { createHash } from "node:crypto";

const EXPECTED_BYTES = 1024 * 1024;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 3;
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[a-f0-9]{64}$/i;

/**
 * Explicit, authenticated one-megabyte proof handoff.
 * It refuses local mode: a successful response means the payload and receipt
 * were read back from the configured remote CAS and a remote WAL record exists.
 */
export function createWebRtcProofRouter({ store, requireAuth, now = () => Date.now() } = {}) {
  if (!store || typeof requireAuth !== "function") throw new TypeError("store and requireAuth are required");
  const router = express.Router();
  const attempts = new Map();

  router.post("/persist", requireAuth, express.raw({ type: "application/octet-stream", limit: EXPECTED_BYTES }), async (req, res) => {
    res.set("Cache-Control", "no-store");
    const remoteWal = store.remoteMode === true && store.wal?.constructor?.name === "RemoteApexRingWAL";
    if (!remoteWal || typeof store.cas?.readRef !== "function") {
      return res.status(503).json({ success: false, error: "Remote storage is not active; local fallback is refused." });
    }

    const ip = String(req.ip || req.socket?.remoteAddress || "unknown");
    const time = now();
    const recent = (attempts.get(ip) || []).filter(ts => time - ts < WINDOW_MS);
    if (recent.length >= MAX_ATTEMPTS_PER_WINDOW) {
      attempts.set(ip, recent);
      return res.status(429).json({ success: false, error: "Proof upload limit reached. Try again in ten minutes." });
    }

    const transferId = String(req.get("x-apex-transfer-id") || "");
    const expectedSha256 = String(req.get("x-apex-expected-sha256") || "").toLowerCase();
    if (!UUID.test(transferId) || !SHA256.test(expectedSha256)) {
      return res.status(400).json({ success: false, error: "A valid transfer ID and expected SHA-256 are required." });
    }
    if (!Buffer.isBuffer(req.body) || req.body.byteLength !== EXPECTED_BYTES) {
      return res.status(400).json({ success: false, error: "The proof payload must be exactly 1 MiB." });
    }

    const payload = req.body;
    const actualSha256 = digest(payload);
    if (actualSha256 !== expectedSha256) {
      return res.status(422).json({ success: false, error: "Payload checksum does not match the receiver's expected SHA-256." });
    }

    recent.push(time);
    attempts.set(ip, recent);
    // Keep the limiter bounded if many clients touch this proof-only endpoint.
    if (attempts.size > 1000) {
      for (const [key, values] of attempts) {
        if (!values.some(ts => time - ts < WINDOW_MS)) attempts.delete(key);
      }
    }

    try {
      const existing = await store.get("webrtc_proofs", transferId);
      if (existing && (existing.payloadSha256 !== actualSha256 || existing.byteLength !== EXPECTED_BYTES)) {
        return res.status(409).json({ success: false, error: "Transfer ID already belongs to a different payload." });
      }
      if (!existing) {
        await store.put("webrtc_proofs", transferId, {
          transferId,
          byteLength: EXPECTED_BYTES,
          payloadSha256: actualSha256,
          payloadBase64: payload.toString("base64"),
          storagePurpose: "explicit-webrtc-proof"
        });
      }

      const stored = await store.get("webrtc_proofs", transferId);
      if (!stored || stored.byteLength !== EXPECTED_BYTES || stored.payloadSha256 !== actualSha256) {
        throw new Error("Remote CAS readback metadata did not match the uploaded payload.");
      }
      const storedPayload = Buffer.from(String(stored.payloadBase64 || ""), "base64");
      if (storedPayload.byteLength !== EXPECTED_BYTES || digest(storedPayload) !== actualSha256) {
        throw new Error("Remote CAS readback payload checksum failed.");
      }

      const stateRef = await store.cas.readRef("state", store.refKey("webrtc_proofs", transferId));
      if (!stateRef?.hash) throw new Error("Remote CAS proof reference is missing after readback.");
      let snapshot = await store.wal.snapshot();
      let receipt = snapshot.ring.find(row => row?.type === "webrtc.payload.persisted" && row?.payload?.transferId === transferId);
      if (!receipt) {
        receipt = await store.wal.append("webrtc.payload.persisted", {
          transferId,
          byteLength: EXPECTED_BYTES,
          sha256: actualSha256,
          casRecordHash: stateRef.hash,
          purpose: "manual-browser-peer-proof"
        });
        snapshot = await store.wal.snapshot();
      }
      const verifiedReceipt = snapshot.ring.find(row => row?.seq === receipt.seq && row?.hash === receipt.hash);
      if (!verifiedReceipt || verifiedReceipt.payload?.transferId !== transferId || verifiedReceipt.payload?.sha256 !== actualSha256) {
        throw new Error("Remote WAL receipt could not be verified after append.");
      }

      return res.status(existing ? 200 : 201).json({
        success: true,
        persisted: true,
        transferId,
        payloadBytes: EXPECTED_BYTES,
        payloadSha256: actualSha256,
        receiverChecksumVerified: true,
        remoteCasReadbackVerified: true,
        remoteWalReadbackVerified: true,
        remoteCasRecordHash: stateRef.hash,
        walSequence: verifiedReceipt.seq,
        walHash: verifiedReceipt.hash,
        note: "This is a manually initiated test payload; no application traffic was rerouted."
      });
    } catch (error) {
      return res.status(503).json({
        success: false,
        persisted: false,
        error: error instanceof Error ? error.message : "Remote proof persistence failed."
      });
    }
  });

  return router;
}
