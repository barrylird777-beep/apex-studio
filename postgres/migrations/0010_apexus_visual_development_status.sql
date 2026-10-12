-- Apexus visual-development gate status.
ALTER TABLE apexus_episodes
  ADD COLUMN IF NOT EXISTS visual_development_status TEXT NOT NULL DEFAULT 'pending';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'apexus_episodes_visual_development_status_check'
  ) THEN
    ALTER TABLE apexus_episodes
      ADD CONSTRAINT apexus_episodes_visual_development_status_check
      CHECK (visual_development_status IN ('pending','approved','rejected'));
  END IF;
END $$;
