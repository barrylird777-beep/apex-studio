ALTER TABLE "projects" ADD COLUMN IF NOT EXISTS "visual_dna" jsonb DEFAULT '{}'::jsonb;
