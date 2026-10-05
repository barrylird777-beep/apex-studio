-- Durable rendered media asset registration.
CREATE TABLE IF NOT EXISTS apex_media_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  episode_id UUID NOT NULL REFERENCES apex_episode_pipelines(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'rendering'
    CHECK (status IN ('rendering','completed','failed')),
  mime_type TEXT,
  size_bytes BIGINT,
  sha256 TEXT,
  duration_seconds NUMERIC,
  width INTEGER,
  height INTEGER,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS apex_media_assets_episode_final_idx
  ON apex_media_assets(episode_id, asset_type)
  WHERE asset_type = 'final_render';

CREATE INDEX IF NOT EXISTS apex_media_assets_episode_idx
  ON apex_media_assets(episode_id, created_at DESC);
