-- =============================================================================
-- 6.2 Retry Mechanism - @documents-checklist.md
-- =============================================================================
-- Creates:
-- 1. app_config table for storing worker version
-- 2. retry_errored_documents() RPC for cron-triggered retry
-- =============================================================================

-- Enable pg_net extension for HTTP calls
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- App config table for simple key-value storage
CREATE TABLE IF NOT EXISTS app_config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert initial worker version (will be updated by deploy hook)
INSERT INTO app_config (key, value) VALUES ('worker_version', 'initial')
ON CONFLICT (key) DO NOTHING;

-- Grant access
GRANT SELECT ON app_config TO authenticated;
GRANT ALL ON app_config TO service_role;

COMMENT ON TABLE app_config IS 'Simple key-value store for app configuration';

-- =============================================================================
-- retry_errored_documents() RPC
-- =============================================================================
-- Called by cron job to re-queue errored documents when:
-- 1. Worker version changed since error occurred
-- 2. Or 24 hours have passed since last attempt
-- Max 3 retries per worker version
-- =============================================================================

CREATE OR REPLACE FUNCTION retry_errored_documents()
RETURNS TABLE(doc_id UUID, requeued BOOLEAN, reason TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_version TEXT;
  doc RECORD;
  supabase_url TEXT;
  secret_key TEXT;
BEGIN
  -- Get current worker version
  SELECT value INTO current_version FROM app_config WHERE key = 'worker_version';
  
  -- Get Supabase URL and service key from vault
  SELECT decrypted_secret INTO supabase_url
    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL';
  SELECT decrypted_secret INTO secret_key
    FROM vault.decrypted_secrets WHERE name = 'SB_SECRET_KEY';
  
  -- If secrets not found, abort
  IF supabase_url IS NULL OR secret_key IS NULL THEN
    doc_id := NULL;
    requeued := FALSE;
    reason := 'Missing secrets in vault';
    RETURN NEXT;
    RETURN;
  END IF;

  FOR doc IN
    SELECT d.id, d.process_history
    FROM documents d
    WHERE d.process_status = 'errored'
      AND d.deleted_at IS NULL
      -- Either new deployment or 24h since last entry
      AND (
        COALESCE(d.process_history->-1->>'worker_version', '') IS DISTINCT FROM current_version
        OR COALESCE((d.process_history->-1->>'at')::timestamptz, NOW() - INTERVAL '25 hours') < NOW() - INTERVAL '24 hours'
      )
      -- Max 3 retries per version
      AND COALESCE((d.process_history->-1->>'retry_count')::int, 0) < 3
    LIMIT 50  -- Batch size
  LOOP
    -- Call queue-job Edge Function
    PERFORM net.http_post(
      url := supabase_url || '/functions/v1/queue-job',
      headers := jsonb_build_object(
        'apikey', secret_key,
        'Content-Type', 'application/json'
      ),
      body := jsonb_build_object(
        'document_id', doc.id,
        'source', 'retry'
      )
    );
    
    doc_id := doc.id;
    requeued := TRUE;
    reason := CASE 
      WHEN COALESCE(doc.process_history->-1->>'worker_version', '') IS DISTINCT FROM current_version 
        THEN 'new_version'
      ELSE 'daily_fallback'
    END;
    RETURN NEXT;
  END LOOP;
END;
$$;

-- Grant execute to service_role only (cron runs as service_role)
GRANT EXECUTE ON FUNCTION retry_errored_documents() TO service_role;

COMMENT ON FUNCTION retry_errored_documents IS 
  'Cron-triggered retry of errored documents when worker version changes or 24h passes';

-- =============================================================================
-- pg_cron schedule (requires pg_cron enabled in dashboard)
-- Run every hour at minute 0
-- =============================================================================
-- To enable in production, run:
-- SELECT cron.schedule('retry-errored-docs', '0 * * * *', 'SELECT * FROM retry_errored_documents()');

