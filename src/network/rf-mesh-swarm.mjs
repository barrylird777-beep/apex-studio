import crypto from "node:crypto";
import { pool } from "../db/index.ts";

const VECTOR_DIMENSION = 1536;
const BSSID_RE = /^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$/i;
const NODE_ID_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_.:-]{1,128}$/;
const MAX_CLOCK_SKEW_MS = 30_000;

function validateBssid(value) {
  const bssid = String(value || "").toLowerCase();
  if (!BSSID_RE.test(bssid)) throw new Error("Invalid RF BSSID");
  return bssid;
}

function validateEmbedding(value) {
  if (!Array.isArray(value) || value.length !== VECTOR_DIMENSION) {
    throw new Error(`RF embedding must contain exactly ${VECTOR_DIMENSION} dimensions`);
  }
  for (const n of value) {
    if (typeof n !== "number" || !Number.isFinite(n)) {
      throw new Error("RF embedding contains a non-finite value");
    }
  }
  return value;
}

function vectorLiteral(embedding) {
  return `[${embedding.join(",")}]`;
}

function canonicalize(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
}

function signedEnvelope(packet, normalizedBssid) {
  return canonicalize({
    nodeId: packet.nodeId,
    bssid: normalizedBssid,
    payload: packet.payload,
    embedding: packet.embedding,
    timestamp: packet.timestamp,
    idempotencyKey: packet.idempotencyKey,
    sequenceNumber: packet.sequenceNumber ?? null
  });
}

function publicKeyFromHex(hex) {
  const raw = Buffer.from(String(hex || ""), "hex");
  if (raw.length !== 44) throw new Error("RF node public key must be a 44-byte DER Ed25519 public key");
  return crypto.createPublicKey({ key: raw, format: "der", type: "spki" });
}

export async function ingestSignedRfTelemetry(packet = {}) {
  const nodeId = String(packet.nodeId || "").trim();
  if (!NODE_ID_RE.test(nodeId)) throw new Error("Invalid RF node id");

  const bssid = validateBssid(packet.bssid);
  const embedding = validateEmbedding(packet.embedding);
  const idempotencyKey = String(packet.idempotencyKey || "").trim();
  if (!IDEMPOTENCY_RE.test(idempotencyKey)) throw new Error("Invalid RF telemetry idempotency key");

  const observedAtMs = Date.parse(packet.timestamp);
  if (!Number.isFinite(observedAtMs) || Math.abs(Date.now() - observedAtMs) > MAX_CLOCK_SKEW_MS) {
    throw new Error("RF telemetry timestamp is outside the accepted clock-skew window");
  }

  const signatureHex = String(packet.signature || "");
  if (!/^[0-9a-f]{128}$/i.test(signatureHex)) throw new Error("RF telemetry signature must be 64-byte Ed25519 hex");

  const envelope = signedEnvelope({ ...packet, nodeId, idempotencyKey }, bssid);
  const payloadHash = crypto.createHash("sha256").update(envelope).digest("hex");

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const node = await client.query(
      "SELECT public_key, algorithm, enabled FROM rf_mesh_nodes WHERE node_id=$1 FOR SHARE",
      [nodeId]
    );
    if (!node.rows[0]) throw new Error("Unknown RF mesh node");
    if (!node.rows[0].enabled || node.rows[0].algorithm !== "ed25519") throw new Error("RF mesh node is disabled or unsupported");

    const verified = crypto.verify(
      null,
      Buffer.from(envelope),
      publicKeyFromHex(node.rows[0].public_key.toString("hex")),
      Buffer.from(signatureHex, "hex")
    );
    if (!verified) throw new Error("RF telemetry signature verification failed");

    const result = await client.query(
      `INSERT INTO rf_mesh_telemetry
        (node_id,bssid,payload,payload_hash,signature,embedding,idempotency_key,observed_at,sequence_number)
       VALUES ($1,$2,$3::jsonb,$4,$5,$6::vector,$7,$8,$9)
       ON CONFLICT (node_id,idempotency_key) DO NOTHING
       RETURNING event_id,event_uuid`,
      [
        nodeId,
        bssid,
        JSON.stringify(packet.payload ?? {}),
        payloadHash,
        Buffer.from(signatureHex, "hex"),
        vectorLiteral(embedding),
        idempotencyKey,
        new Date(observedAtMs),
        Number.isSafeInteger(packet.sequenceNumber) ? packet.sequenceNumber : null
      ]
    );

    if (!result.rows[0]) {
      await client.query("ROLLBACK");
      return { status: "duplicate", idempotencyKey };
    }

    await client.query(
      "UPDATE rf_mesh_nodes SET last_seen_at=NOW() WHERE node_id=$1",
      [nodeId]
    );
    await client.query("COMMIT");

    return { status: "success", eventId: result.rows[0].event_id, eventUuid: result.rows[0].event_uuid };
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
  const embedding = validateEmbedding(queryEmbedding);

  if (!Number.isInteger(minQuorumNodes) || minQuorumNodes < 1 || minQuorumNodes > 100) {
    throw new RangeError("minQuorumNodes must be an integer from 1 to 100");
  }
  if (!Number.isFinite(similarityThreshold) || similarityThreshold < -1 || similarityThreshold > 1) {
    throw new RangeError("similarityThreshold must be between -1 and 1");
  }

  const { rows } = await pool.query(
    `WITH ranked AS (
       SELECT node_id,
              event_uuid,
              observed_at,
              1 - (embedding <=> $1::vector) AS similarity,
              ROW_NUMBER() OVER (PARTITION BY node_id ORDER BY observed_at DESC) AS rn
         FROM rf_mesh_telemetry
        WHERE bssid=$2
          AND embedding IS NOT NULL
          AND observed_at >= NOW() - INTERVAL '60 seconds'
     )
     SELECT node_id,event_uuid,observed_at,similarity
       FROM ranked
      WHERE rn=1 AND similarity >= $3
      ORDER BY similarity DESC`,
    [vectorLiteral(embedding), validBssid, similarityThreshold]
  );

  const meanSimilarity = rows.length
    ? rows.reduce((sum, row) => sum + Number(row.similarity), 0) / rows.length
    : 0;

  return {
    bssid: validBssid,
    quorumMet: rows.length >= minQuorumNodes,
    verifiedNodeCount: rows.length,
    requiredQuorum: minQuorumNodes,
    meanSimilarity,
    contributors: rows.map((row) => ({
      nodeId: row.node_id,
      eventUuid: row.event_uuid,
      similarity: Number(row.similarity),
      observedAt: row.observed_at
    }))
  };
}
