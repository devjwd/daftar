-- 1. Function to enqueue due users (prevents loading massive arrays into Node.js memory)
CREATE OR REPLACE FUNCTION enqueue_due_users(pro_interval text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  -- Insert/update Pro and Lite users
  INSERT INTO sync_queue (user_address, status, priority, created_at, updated_at)
  SELECT p.wallet_address, 'pending', 1, NOW(), NOW()
  FROM profiles p
  LEFT JOIN sync_queue sq ON p.wallet_address = sq.user_address
  WHERE (p.subscription_tier = 'pro' OR p.subscription_tier = 'lite')
    AND p.wallet_address IS NOT NULL
    AND (sq.id IS NULL OR sq.updated_at < (NOW() - pro_interval::interval) OR sq.status = 'failed')
    AND (sq.status IS NULL OR sq.status != 'processing')
  ON CONFLICT (user_address) DO UPDATE
  SET status = 'pending', priority = 1, updated_at = NOW();
END;
$$;

-- 2. Function to claim pending sync jobs using SKIP LOCKED (solves race conditions and DB lock bottlenecks)
CREATE OR REPLACE FUNCTION claim_sync_jobs(limit_count int)
RETURNS TABLE (
  id uuid,
  user_address text,
  priority int
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  UPDATE sync_queue
  SET status = 'processing', updated_at = NOW()
  WHERE sync_queue.id IN (
    SELECT q.id
    FROM sync_queue q
    WHERE q.status = 'pending'
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT limit_count
    FOR UPDATE SKIP LOCKED
  )
  RETURNING sync_queue.id, sync_queue.user_address, sync_queue.priority;
END;
$$;
