-- Apexus 2,785-episode production foundation.
-- Durable episode registry, production gates, catalog registration and broadcast readiness.

CREATE TABLE IF NOT EXISTS apexus_episodes (
  id UUID PRIMARY KEY,
  global_episode_number INTEGER NOT NULL UNIQUE CHECK (global_episode_number BETWEEN 1 AND 2785),
  episode_code TEXT NOT NULL UNIQUE,
  series_id TEXT NOT NULL,
  season_id TEXT NOT NULL,
  episode_number INTEGER NOT NULL CHECK (episode_number >= 1),
  title TEXT NOT NULL,
  logline TEXT NOT NULL DEFAULT '',
  audience_lane TEXT NOT NULL CHECK (audience_lane IN (
    'Apexus Family','Apexus Toonhouse','Apexus Action','Apex Anime',
    'Dark Garden','Apexus After Dark','KornSwim'
  )),
  maturity_rating TEXT NOT NULL DEFAULT 'TV-PG',
  visual_style TEXT NOT NULL DEFAULT 'apexus-dark-fantasy-cel',
  runtime_target_seconds INTEGER NOT NULL DEFAULT 1320 CHECK (runtime_target_seconds > 0),
  state TEXT NOT NULL DEFAULT 'IDEA' CHECK (state IN (
    'IDEA','STORY','SCRIPT','STORYBOARD','VOICE','AUDIO',
    'VISUAL_DEVELOPMENT','ANIMATION','EDIT','QC','MASTER',
    'SCHEDULED','BROADCAST','CATALOG'
  )),
  script_status TEXT NOT NULL DEFAULT 'pending',
  storyboard_status TEXT NOT NULL DEFAULT 'pending',
  voice_status TEXT NOT NULL DEFAULT 'pending',
  audio_status TEXT NOT NULL DEFAULT 'pending',
  animation_status TEXT NOT NULL DEFAULT 'pending',
  edit_status TEXT NOT NULL DEFAULT 'pending',
  qc_status TEXT NOT NULL DEFAULT 'pending',
  master_status TEXT NOT NULL DEFAULT 'pending',
  programming_status TEXT NOT NULL DEFAULT 'pending',
  creative_brief JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apexus_episode_assets (
  id UUID PRIMARY KEY,
  episode_id UUID NOT NULL REFERENCES apexus_episodes(id) ON DELETE CASCADE,
  asset_type TEXT NOT NULL,
  asset_uri TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','rejected','superseded')),
  provenance JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (episode_id, asset_type, version)
);

CREATE TABLE IF NOT EXISTS apexus_catalog (
  id UUID PRIMARY KEY,
  episode_id UUID NOT NULL UNIQUE REFERENCES apexus_episodes(id) ON DELETE RESTRICT,
  master_asset_id UUID REFERENCES apexus_episode_assets(id) ON DELETE RESTRICT,
  duration_seconds INTEGER NOT NULL CHECK (duration_seconds > 0),
  qc_passed_at TIMESTAMPTZ,
  registered_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apexus_schedule (
  id UUID PRIMARY KEY,
  episode_id UUID NOT NULL REFERENCES apexus_episodes(id) ON DELETE RESTRICT,
  starts_at TIMESTAMPTZ NOT NULL,
  ends_at TIMESTAMPTZ NOT NULL,
  block_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','broadcast','cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS apexus_episodes_code_idx ON apexus_episodes(episode_code);
CREATE INDEX IF NOT EXISTS apexus_episodes_state_idx ON apexus_episodes(state, updated_at);
CREATE INDEX IF NOT EXISTS apexus_episodes_lane_idx ON apexus_episodes(audience_lane, state);
CREATE INDEX IF NOT EXISTS apexus_schedule_time_idx ON apexus_schedule(starts_at, ends_at);
CREATE INDEX IF NOT EXISTS apexus_assets_episode_type_idx ON apexus_episode_assets(episode_id, asset_type, version DESC);

CREATE OR REPLACE FUNCTION apexus_touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apexus_episodes_touch ON apexus_episodes;
CREATE TRIGGER apexus_episodes_touch BEFORE UPDATE ON apexus_episodes
FOR EACH ROW EXECUTE FUNCTION apexus_touch_updated_at();
