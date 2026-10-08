CREATE TABLE IF NOT EXISTS production_timelines (
  id BIGSERIAL PRIMARY KEY,
  node_id TEXT NOT NULL UNIQUE,
  scene_label TEXT NOT NULL,
  timecode TEXT NOT NULL,
  aesthetic_profile TEXT,
  prompt TEXT,
  audio_tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS production_timelines_scene_idx
  ON production_timelines(scene_label);
CREATE INDEX IF NOT EXISTS production_timelines_timecode_idx
  ON production_timelines(timecode);
CREATE INDEX IF NOT EXISTS production_timelines_node_idx
  ON production_timelines(node_id);

CREATE TABLE IF NOT EXISTS timeline_mutations (
  id BIGSERIAL PRIMARY KEY,
  parent_node_id TEXT NOT NULL
    REFERENCES production_timelines(node_id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  altered_visual JSONB NOT NULL DEFAULT '[]'::jsonb,
  altered_vocal JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS timeline_mutations_parent_idx
  ON timeline_mutations(parent_node_id);
CREATE INDEX IF NOT EXISTS timeline_mutations_branch_idx
  ON timeline_mutations(branch_id);

CREATE TABLE IF NOT EXISTS search_runs (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  mode TEXT,
  started_at TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  status TEXT,
  fragments JSONB NOT NULL DEFAULT '[]'::jsonb,
  sources JSONB NOT NULL DEFAULT '[]'::jsonb,
  results JSONB NOT NULL DEFAULT '[]'::jsonb
);

CREATE TABLE IF NOT EXISTS search_results (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL
    REFERENCES search_runs(id)
    ON DELETE CASCADE,
  url TEXT NOT NULL,
  status INTEGER,
  content_type TEXT,
  text TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS search_results_run_idx
  ON search_results(run_id);

CREATE TABLE IF NOT EXISTS narrative_tracks (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  branch_id TEXT,
  timeline_id TEXT,
  blocks JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voice_assets (
  id TEXT PRIMARY KEY,
  track_id TEXT,
  filepath TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS narrative_tracks_project_idx
  ON narrative_tracks(project_id);
CREATE INDEX IF NOT EXISTS narrative_tracks_timeline_idx
  ON narrative_tracks(timeline_id);
CREATE INDEX IF NOT EXISTS voice_assets_track_idx
  ON voice_assets(track_id);
