CREATE TABLE IF NOT EXISTS music_projects (
  id UUID PRIMARY KEY,
  project_id TEXT NOT NULL,
  content_domain TEXT NOT NULL CHECK (content_domain IN ('bible','korn','original')),
  title TEXT NOT NULL,
  garden_graph_version TEXT,
  garden_package_hash TEXT,
  garden_references JSONB NOT NULL DEFAULT '[]'::jsonb,
  musical_intent JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','producing','review','complete','failed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS music_projects_project_idx ON music_projects(project_id);
CREATE INDEX IF NOT EXISTS music_projects_domain_idx ON music_projects(content_domain);
CREATE INDEX IF NOT EXISTS music_projects_status_idx ON music_projects(status);

CREATE TABLE IF NOT EXISTS music_assets (
  id UUID PRIMARY KEY,
  music_project_id UUID NOT NULL REFERENCES music_projects(id) ON DELETE CASCADE,
  asset_id TEXT NOT NULL,
  role TEXT NOT NULL,
  title TEXT NOT NULL,
  format TEXT NOT NULL,
  checksum TEXT NOT NULL,
  duration_seconds DOUBLE PRECISION,
  media_url TEXT,
  local_path TEXT,
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (music_project_id, asset_id),
  UNIQUE (music_project_id, checksum)
);

CREATE INDEX IF NOT EXISTS music_assets_role_idx ON music_assets(role);
CREATE INDEX IF NOT EXISTS music_assets_checksum_idx ON music_assets(checksum);
