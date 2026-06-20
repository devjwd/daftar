-- Add retry_count to sync_queue
ALTER TABLE public.sync_queue ADD COLUMN IF NOT EXISTS retry_count INTEGER DEFAULT 0;

-- Jobs with status 'dlq' require manual intervention
-- Update existing jobs to have retry_count 0 if null
UPDATE public.sync_queue SET retry_count = 0 WHERE retry_count IS NULL;
