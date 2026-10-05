CREATE TABLE IF NOT EXISTS apex_episode_pipelines (
  id UUID PRIMARY KEY,
  book TEXT NOT NULL,
  chapter INTEGER NOT NULL CHECK (chapter > 0),
  verses TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS apex_episode_context (
  episode_id UUID NOT NULL REFERENCES apex_episode_pipelines(id) ON DELETE CASCADE,
  context_type TEXT NOT NULL,
  raw_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (episode_id, context_type)
);
CREATE INDEX IF NOT EXISTS apex_episode_pipelines_status_idx ON apex_episode_pipelines(status, created_at);
CREATE INDEX IF NOT EXISTS apex_episode_context_type_idx ON apex_episode_context(context_type);
