-- Create table for rate limiting
CREATE TABLE IF NOT EXISTS telegram_rate_limits (
    chat_id text PRIMARY KEY,
    last_request_at timestamptz NOT NULL DEFAULT now()
);

-- RPC function to check and update rate limit atomically
-- Returns true if the request is allowed (meaning it wasn't rate limited), false otherwise
CREATE OR REPLACE FUNCTION check_telegram_rate_limit(p_chat_id text)
RETURNS boolean
LANGUAGE plpgsql
AS $$
DECLARE
    v_allowed boolean;
BEGIN
    INSERT INTO telegram_rate_limits (chat_id, last_request_at)
    VALUES (p_chat_id, now())
    ON CONFLICT (chat_id) DO UPDATE 
    SET last_request_at = now()
    WHERE telegram_rate_limits.last_request_at < now() - interval '2 seconds'
    RETURNING true INTO v_allowed;

    -- If no row was returned by the UPDATE, it means the WHERE clause failed (rate limited)
    IF v_allowed IS NULL THEN
        RETURN false;
    END IF;

    RETURN true;
END;
$$;
