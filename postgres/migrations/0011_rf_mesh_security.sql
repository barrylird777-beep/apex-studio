CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE IF NOT EXISTS rf_mesh_nodes (
  node_id TEXT PRIMARY KEY,
  public_key BYTEA NOT NULL,
  algorithm TEXT NOT NULL DEFAULT 'ed25519' CHECK (algorithm = 'ed25519'),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS rf_mesh_telemetry (
  event_id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  node_id TEXT NOT NULL REFERENCES rf_mesh_nodes(node_id),
  event_uuid UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  bssid TEXT NOT NULL CHECK (bssid ~* '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'),
  payload JSONB NOT NULL,
  payload_hash TEXT NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  signature BYTEA NOT NULL,
  embedding vector(1536),
  idempotency_key TEXT NOT NULL,
  observed_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sequence_number BIGINT,
  UNIQUE (node_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS rf_mesh_telemetry_bssid_time_idx
  ON rf_mesh_telemetry (bssid, observed_at DESC);
CREATE INDEX IF NOT EXISTS rf_mesh_telemetry_node_time_idx
  ON rf_mesh_telemetry (node_id, observed_at DESC);
CREATE INDEX IF NOT EXISTS rf_mesh_telemetry_embedding_hnsw_idx
  ON rf_mesh_telemetry USING hnsw (embedding vector_cosine_ops)
  WHERE embedding IS NOT NULL;

CREATE TABLE IF NOT EXISTS rf_security_assessments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_uuid UUID REFERENCES rf_mesh_telemetry(event_uuid) ON DELETE CASCADE,
  bssid TEXT NOT NULL CHECK (bssid ~* '^[0-9a-f]{2}(:[0-9a-f]{2}){5}$'),
  classification TEXT NOT NULL CHECK (classification IN ('benign','suspicious','likely_threat','unknown')),
  confidence NUMERIC(5,4) NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  evidence JSONB NOT NULL DEFAULT '[]'::jsonb,
  reasoning_summary TEXT,
  model TEXT,
  model_version TEXT,
  status TEXT NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS rf_security_assessments_bssid_time_idx
  ON rf_security_assessments (bssid, created_at DESC);
