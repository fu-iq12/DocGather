-- =============================================================================
-- Phase 6: Simple Priority Tiers for Job Queue 
-- @see architecture/documents-checklist.md
-- =============================================================================
-- Returns BullMQ priority value based on job source.
-- Lower numbers = higher priority in BullMQ.
--
-- Priority tiers:
--   user_upload: 1 (highest) - User is waiting
--   cloud_sync:  5 (medium)  - Background sync
--   retry:      10 (lowest)  - Failed job retry
-- =============================================================================

CREATE OR REPLACE FUNCTION get_job_priority(p_source TEXT)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  CASE p_source
    WHEN 'user_upload' THEN RETURN 1;
    WHEN 'cloud_sync'  THEN RETURN 5;
    WHEN 'retry'       THEN RETURN 10;
    ELSE RETURN 5; -- Default to medium priority
  END CASE;
END;
$$;

-- Allow all authenticated users to call (used by Edge Functions)
GRANT EXECUTE ON FUNCTION get_job_priority(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION get_job_priority(TEXT) TO service_role;

COMMENT ON FUNCTION get_job_priority IS 
  'Returns BullMQ priority (1=highest) based on job source: user_upload, cloud_sync, retry';

