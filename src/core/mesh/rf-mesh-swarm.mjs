import crypto from "node:crypto";
import { pool } from "../../db/index.ts";

const VECTOR_DIMENSION = 1536;
const BSSID_RE = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
const MAX_CLOCK_SKEW_MS = 30_000;

function validateBssid(value) {
  const bssid = String(value || "").trim().toLowerCase();
  if (!BSSID_RE.test(bssid)) throw new TypeError("Invalid RF BSSID");
  return bssid;
}

function validateEmbedding(value) {
  if (!Array.isArray(value) || value.length !== VECTOR_DIMENSION) {
    throw new TypeError(`RF embedding must contain exactly ${VECTOR_DIMENSION} dimensions`);
  }
  if (!value.every((n) => typeof n === "number" && Number.isFinite(n))) {
    throw new TypeError("RF embedding contains a non-finite or non-numeric value");
  }
  return `[${value.join(",")}]`;
}

function validateHex(value, name, maxBytes) {
  const raw = String(value || "").trim();
  if (!/^[0-9a-f]+$/i.test(raw) || raw.length % 2 !== 0 || raw.length > maxBytes * 2) {
    throw new TypeError(`Invalid ${name} encoding`);
  }
  return raw;
}

function canonicalEnvelope({ nodeId, bssid, embedding, payload, observedAt, idempotencyKey }) {
  return JSON.stringify({
    nodeId,
    bssid,
    embedding,
    payload,
    observedAt,
    idempotencyKey
  });
}

export async function ingestSignedRfTelemetry(packet = {}) {
  const nodeId = String(packet.nodeId || "").trim();
  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(nodeId)) throw new TypeError("Invalid RF node id");

  const bssid = validateBssid(packet.bssid);
  const embedding = packet.embedding;
  const vectorLiteral = validateEmbedding(embedding);
  const signatureHex = validateHex(packet.signature, "RF signature", 128);
  const idempotencyKey = String(packet.idempotencyKey || "").trim();

  if (!/^[A-Za-z0-9._:-]{1,128}$/.test(idempotencyKey)) {
    throw new TypeError("Invalid RF idempotency key");
  }

  const observedMs = new Date(packet.observedAt).getTime();
  if (!Number.isFinite(observedMs) || Math.abs(Date.now() - observedMs) > MAX_CLOCK_SKEW_MS) {
    throw new RangeError("RF telemetry timestamp is outside the accepted clock-skew window");
  }

  const payload = packet.payload && typeof packet.payload === "object" ? packet.payload : {};
  const envelope = canonicalEnvelope({
    nodeId,
    bssid,
    embedding,
    payload,
    observedAt: new Date(observedMs).toISOString(),
    idempotencyKey
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const node = await client.query(
      "SELECT public_key, algorithm, enabled FROM rf_mesh_nodes WHERE node_id=$1 FOR SHARE",
      [nodeId]
    );
    if (!node.rows[0] || !node.rows[0].enabled || node.rows[0].algorithm !== "ed25519") {
      throw new Error("RF node is not registered and enabled");
    }

    const verified = crypto.verify(
      null,
      Buffer.from(envelope),
      { key: node.rows[0].public_key, format: "der", type: "spki" },
      Buffer.from(signatureHex, "hex")
    );
    if (!verified) throw new Error("RF telemetry signature verification failed");

    const payloadHash = crypto.createHash("sha256").update(envelope).digest("hex");
    const inserted = await client.query(
      `INSERT INTO rf_mesh_telemetry
       (node_id,bssid,payload,payload_hash,signature,embedding,idempotency_key,observed_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6::vector,$7,$8)
       ON CONFLICT (node_id,idempotency_key) DO NOTHING
       RETURNING event_id`,
      [nodeId, bssid, JSON.stringify(payload), payloadHash, Buffer.from(signatureHex, "hex"), vectorLiteral, idempotencyKey, new Date(observedMs)]
    );

    if (!inserted.rows.length) {
      await client.query("ROLLBACK");
      return { status: "duplicate" };
    }

    await client.query(
      "UPDATE rf_mesh_nodes SET last_seen_at=NOW() WHERE node_id=$1",
      [nodeId]
    );
    await client.query("COMMIT");
    return { status: "success", eventId: inserted.rows[0].event_id };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function evaluateQuorumConsensus(
  bssid,
  queryEmbedding,
  minQuorumNodes = 3,
  similarityThreshold = 0.90
) {
  const validBssid = validateBssid(bssid);
  const vectorLiteral = validateEmbedding(queryEmbedding);

  if (!Number.isInteger(minQuorumNodes) || minQuorumNodes < 1 || minQuorumNodes > 100) {
    throw new RangeError("minQuorumNodes must be between 1 and 100");
  }
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < -1 || similarityThreshold > 1) {
    throw new RangeError("similarityThreshold must be between -1 and 1");
  }

  const result = await pool.query(
    `WITH ranked AS (
       SELECT node_id,
              1 - (embedding <=> $1::vector) AS similarity,
              observed_at,
              ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY observed_at DESC) AS rn
       FROM rf_mesh_telemetry
       WHERE bssid=$2
         AND embedding IS NOT NULL
         AND observed_at >= NOW() - INTERVAL '60 seconds'
     )
     SELECT node_id, similarity, observed_at
     FROM ranked
     WHERE rn=1 AND similarity >= $3
     ORDER BY similarity DESC`,
    [vectorLiteral, validBssid, similarityThreshold]
  );

  const contributors = result.rows.map((row) => ({
    nodeId: row.node_id,
    similarity: Number(row.similarity),
    observedAt: row.observed_at
  }));

  return {
    bssid: validBssid,
    quorumMet: contributors.length >= minQuorumNodes,
    verifiedNodeCount: contributors.length,
    requiredQuorum: minQuorumNodes,
    meanSimilarity: contributors.length
      ? contributors.reduce((sum, row) => sum + row.similarity, 0) / contributors.length
      : 0,
    contributors
  };
}

export { validateBssid, validateEmbedding };
