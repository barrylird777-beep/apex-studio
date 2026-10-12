-- TOONX canonical rename migration.
-- Historical APEXUS migrations remain immutable; live objects and queued work move to TOONX.

ALTER TABLE IF EXISTS apexus_episodes RENAME TO toonx_episodes;
ALTER TABLE IF EXISTS apexus_episode_assets RENAME TO toonx_episode_assets;
ALTER TABLE IF EXISTS apexus_catalog RENAME TO toonx_catalog;
ALTER TABLE IF EXISTS apexus_schedule RENAME TO toonx_schedule;

ALTER INDEX IF EXISTS apexus_episodes_code_idx RENAME TO toonx_episodes_code_idx;
ALTER INDEX IF EXISTS apexus_episodes_state_idx RENAME TO toonx_episodes_state_idx;
ALTER INDEX IF EXISTS apexus_episodes_lane_idx RENAME TO toonx_episodes_lane_idx;
ALTER INDEX IF EXISTS apexus_schedule_time_idx RENAME TO toonx_schedule_time_idx;
ALTER INDEX IF EXISTS apexus_assets_episode_type_idx RENAME TO toonx_assets_episode_type_idx;

DO $$
BEGIN
  IF to_regprocedure('public.apexus_touch_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.apexus_touch_updated_at() RENAME TO toonx_touch_updated_at;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.toonx_episodes') IS NOT NULL THEN
    BEGIN
      ALTER TRIGGER apexus_episodes_touch ON public.toonx_episodes RENAME TO toonx_episodes_touch;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
  END IF;
END
$$;

ALTER TABLE IF EXISTS toonx_episodes
  ADD COLUMN IF NOT EXISTS visual_development_status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF to_regclass('public.durable_jobs') IS NOT NULL THEN
    UPDATE durable_jobs
    SET type = replace(type, 'apexus.', 'toonx.'),
        dedupe_key = replace(dedupe_key, 'apexus:', 'toonx:'),
        updated_at = NOW()
    WHERE type LIKE 'apexus.%' OR dedupe_key LIKE 'apexus:%';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.apexus_job_events') IS NOT NULL THEN
    UPDATE apexus_job_events
    SET event_type = replace(event_type, 'apexus', 'toonx')
    WHERE event_type ILIKE '%apexus%';
  END IF;
END
$$;

ALTER TABLE IF EXISTS toonx_episodes
  DROP CONSTRAINT IF EXISTS toonx_episodes_audience_lane_check;

ALTER TABLE IF EXISTS toonx_episodes
  DROP CONSTRAINT IF EXISTS apexus_episodes_state_check;
ALTER TABLE IF EXISTS toonx_episodes
  DROP CONSTRAINT IF EXISTS toonx_episodes_state_check;
ALTER TABLE IF EXISTS toonx_episodes
  ADD CONSTRAINT toonx_episodes_state_check CHECK (
    state IN ('IDEA','STORY','SCRIPT','STORYBOARD','VOICE','AUDIO','VISUAL_DEVELOPMENT','ANIMATION','EDIT','QC','MASTER','INSPECTION','CATALOG','SCHEDULED','BROADCAST')
  );

ALTER TABLE IF EXISTS toonx_episodes
  ADD CONSTRAINT toonx_episodes_audience_lane_check CHECK (
    audience_lane IN (
      'TOONX Family','TOONX Toonhouse','TOONX Action','Apex Anime',
      'Dark Garden','TOONX After Dark','KornSwim'
    )
  );

ALTER TABLE IF EXISTS toonx_episodes
  ALTER COLUMN visual_style SET DEFAULT 'toonx-dark-fantasy-cel';

UPDATE toonx_episodes
SET audience_lane = replace(audience_lane, 'Apexus', 'TOONX'),
    visual_style = replace(visual_style, 'apexus', 'toonx'),
    series_id = replace(series_id, 'APEXUS', 'TOONX')
WHERE audience_lane LIKE '%Apexus%'
   OR visual_style LIKE '%apexus%'
   OR series_id LIKE '%APEXUS%';
