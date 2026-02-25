-- =============================================================================
-- Phase 4.5: Supabase-side RPC Functions- @documents-checklist.md
-- =============================================================================
-- User-callable RPC functions for document operations.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- check_duplicate_file: Check if file already exists for owner
-- -----------------------------------------------------------------------------
-- Returns document_id if duplicate found, NULL otherwise
CREATE OR REPLACE FUNCTION check_duplicate_file(
  p_content_hash BYTEA,
  p_file_role TEXT DEFAULT 'original'
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_document_id UUID;
  v_user_id UUID;
BEGIN
  -- Get current user from auth context
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Find existing file with same hash for this owner
  SELECT d.id INTO v_document_id
  FROM document_files df
  JOIN documents d ON df.document_id = d.id
  WHERE df.content_hash = p_content_hash
    AND df.file_role = p_file_role
    AND df.deleted_at IS NULL
    AND d.owner_id = v_user_id
    AND d.deleted_at IS NULL
  LIMIT 1;
  
  RETURN v_document_id;
END;
$$;

-- Allow authenticated users to check duplicates
REVOKE ALL ON FUNCTION check_duplicate_file FROM PUBLIC;
GRANT EXECUTE ON FUNCTION check_duplicate_file TO authenticated;
GRANT EXECUTE ON FUNCTION check_duplicate_file TO service_role;

-- -----------------------------------------------------------------------------
-- soft_delete_document: Soft delete a document with ownership check
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION soft_delete_document(
  p_document_id UUID
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id UUID;
  v_owner_id UUID;
BEGIN
  -- Get current user from auth context
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  
  -- Check document exists and get owner
  SELECT owner_id INTO v_owner_id
  FROM documents
  WHERE id = p_document_id
    AND deleted_at IS NULL;
  
  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Document not found';
  END IF;
  
  -- Verify ownership
  IF v_owner_id != v_user_id THEN
    RAISE EXCEPTION 'Access denied';
  END IF;
  
  -- Soft delete document
  UPDATE documents
  SET 
    deleted_at = now(),
    status = 'deleted',
    updated_at = now()
  WHERE id = p_document_id;
  
  -- Soft delete all associated files
  UPDATE document_files
  SET deleted_at = now()
  WHERE document_id = p_document_id
    AND deleted_at IS NULL;
  
  -- Log the deletion
  INSERT INTO document_access_log (
    document_id,
    accessed_by,
    action,
    purpose
  ) VALUES (
    p_document_id,
    v_user_id,
    'delete',
    'user_request'
  );
  
  RETURN TRUE;
END;
$$;

-- Allow authenticated users to delete their own documents
REVOKE ALL ON FUNCTION soft_delete_document FROM PUBLIC;
GRANT EXECUTE ON FUNCTION soft_delete_document TO authenticated;
GRANT EXECUTE ON FUNCTION soft_delete_document TO service_role;
