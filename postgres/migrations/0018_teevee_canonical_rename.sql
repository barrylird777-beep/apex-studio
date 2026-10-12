-- TeeVee canonical surface migration.
-- 0015 moved the legacy APEXUS live objects to TOONX. This migration moves
-- those live objects to the actual canonical TeeVee surface without rewriting
-- immutable migration history.

ALTER TABLE IF EXISTS toonx_episodes RENAME TO teevee_episodes;
ALTER TABLE IF EXISTS toonx_episode_assets RENAME TO teevee_episode_assets;
ALTER TABLE IF EXISTS toonx_catalog RENAME TO teevee_catalog;
ALTER TABLE IF EXISTS toonx_schedule RENAME TO teevee_schedule;

ALTER INDEX IF EXISTS toonx_episodes_code_idx RENAME TO teevee_episodes_code_idx;
ALTER INDEX IF EXISTS toonx_episodes_state_idx RENAME TO teevee_episodes_state_idx;
ALTER INDEX IF EXISTS toonx_episodes_lane_idx RENAME TO teevee_episodes_lane_idx;
ALTER INDEX IF EXISTS toonx_schedule_time_idx RENAME TO teevee_schedule_time_idx;
ALTER INDEX IF EXISTS toonx_assets_episode_type_idx RENAME TO teevee_assets_episode_type_idx;

DO $$
BEGIN
  IF to_regprocedure('public.toonx_touch_updated_at()') IS NOT NULL THEN
    ALTER FUNCTION public.toonx_touch_updated_at() RENAME TO teevee_touch_updated_at;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.teevee_episodes') IS NOT NULL THEN
    BEGIN
      ALTER TRIGGER toonx_episodes_touch ON public.teevee_episodes RENAME TO teevee_episodes_touch;
    EXCEPTION WHEN undefined_object THEN
      NULL;
    END;
  END IF;
END
$$;

ALTER TABLE IF EXISTS teevee_episodes
  DROP CONSTRAINT IF EXISTS toonx_episodes_state_check,
  DROP CONSTRAINT IF EXISTS toonx_episodes_audience_lane_check,
  DROP CONSTRAINT IF EXISTS teevee_episodes_state_check,
  DROP CONSTRAINT IF EXISTS teevee_episodes_audience_lane_check;

ALTER TABLE IF EXISTS teevee_episodes
  ADD CONSTRAINT teevee_episodes_state_check CHECK (
    state IN ('IDEA','STORY','SCRIPT','STORYBOARD','VOICE','AUDIO','VISUAL_DEVELOPMENT','ANIMATION','EDIT','QC','MASTER','INSPECTION','CATALOG','SCHEDULED','BROADCAST')
  );

ALTER TABLE IF EXISTS teevee_episodes
  ADD CONSTRAINT teevee_episodes_audience_lane_check CHECK (
    audience_lane IN (
      'TeeVee Family','TeeVee Toonhouse','TeeVee Action','Apex Anime',
      'Dark Garden','TeeVee After Dark','KornSwim'
    )
  );

ALTER TABLE IF EXISTS teevee_episodes
  ALTER COLUMN visual_style SET DEFAULT 'teevee-dark-fantasy-cel';

DO $$
BEGIN
  IF to_regclass('public.durable_jobs') IS NOT NULL THEN
    UPDATE durable_jobs
    SET type = replace(type, 'toonx.', 'teevee.'),
        dedupe_key = replace(dedupe_key, 'toonx:', 'teevee:'),
        updated_at = NOW()
    WHERE type LIKE 'toonx.%' OR dedupe_key LIKE 'toonx:%';
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.toonx_job_events') IS NOT NULL THEN
    ALTER TABLE public.toonx_job_events RENAME TO teevee_job_events;
  ELSIF to_regclass('public.apexus_job_events') IS NOT NULL THEN
    ALTER TABLE public.apexus_job_events RENAME TO teevee_job_events;
  END IF;
END
$$;

DO $$
BEGIN
  IF to_regclass('public.teevee_job_events') IS NOT NULL THEN
    UPDATE teevee_job_events
    SET event_type = replace(replace(event_type, 'toonx', 'teevee'), 'apexus', 'teevee')
    WHERE event_type ILIKE '%toonx%' OR event_type ILIKE '%apexus%';
  END IF;
END
$$;

UPDATE teevee_episodes
SET audience_lane = replace(replace(audience_lane, 'TOONX', 'TeeVee'), 'Apexus', 'TeeVee'),
    visual_style = replace(replace(visual_style, 'toonx', 'teevee'), 'apexus', 'teevee'),
    series_id = replace(replace(series_id, 'TOONX', 'TeeVee'), 'APEXUS', 'TeeVee')
WHERE audience_lane LIKE '%TOONX%'
   OR audience_lane LIKE '%Apexus%'
   OR visual_style LIKE '%toonx%'
   OR visual_style LIKE '%apexus%'
   OR series_id LIKE '%TOONX%'
   OR series_id LIKE '%APEXUS%';
