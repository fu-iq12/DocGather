-- =============================================================================
-- Phase 4.4: Worker Write-back RPC Functions
-- @see architecture/documents-checklist.md
-- =============================================================================
-- Functions for Fly.io workers to update documents after processing.
-- Relies on Service Role security (RLS/Grants) for protection.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- worker_update_document: Update document after processing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_update_document(
  p_document_id UUID,
  p_document_type TEXT DEFAULT NULL,
  p_document_subtype TEXT DEFAULT NULL,
  p_status TEXT DEFAULT NULL,
  p_process_status TEXT DEFAULT NULL,
  p_extraction_confidence FLOAT DEFAULT NULL,
  p_document_date DATE DEFAULT NULL,
  p_valid_from DATE DEFAULT NULL,
  p_valid_until DATE DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Verify document exists
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'Document % not found', p_document_id;
  END IF;
  
  -- Update document with provided values (NULL values are ignored)
  UPDATE documents
  SET 
    document_type = COALESCE(p_document_type, document_type),
    document_subtype = COALESCE(p_document_subtype, document_subtype),
    status = COALESCE(p_status, status),
    process_status = COALESCE(p_process_status, process_status),
    extraction_confidence = COALESCE(p_extraction_confidence, extraction_confidence),
    document_date = COALESCE(p_document_date, document_date),
    valid_from = COALESCE(p_valid_from, valid_from),
    valid_until = COALESCE(p_valid_until, valid_until),
    updated_at = now()
  WHERE id = p_document_id;
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION worker_update_document(UUID, TEXT, TEXT, TEXT, TEXT, FLOAT, DATE, DATE, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_update_document(UUID, TEXT, TEXT, TEXT, TEXT, FLOAT, DATE, DATE, DATE) TO service_role;

-- -----------------------------------------------------------------------------
-- worker_update_document_private: Update private document data
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_update_document_private(
  p_document_id UUID,
  p_encrypted_extracted_data BYTEA DEFAULT NULL,
  p_encrypted_metadata BYTEA DEFAULT NULL,
  p_master_key_version INT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Upsert document_private record
  INSERT INTO document_private (document_id, encrypted_extracted_data, encrypted_metadata, master_key_version)
  VALUES (p_document_id, p_encrypted_extracted_data, p_encrypted_metadata, COALESCE(p_master_key_version, 1))
  ON CONFLICT (document_id) DO UPDATE SET
    encrypted_extracted_data = COALESCE(EXCLUDED.encrypted_extracted_data, document_private.encrypted_extracted_data),
    encrypted_metadata = COALESCE(EXCLUDED.encrypted_metadata, document_private.encrypted_metadata),
    master_key_version = COALESCE(p_master_key_version, document_private.master_key_version),
    updated_at = now();
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION worker_update_document_private(UUID, BYTEA, BYTEA, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_update_document_private(UUID, BYTEA, BYTEA, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- worker_update_document_file: Create/update document file record
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_update_document_file(
  p_document_id UUID,
  p_file_role TEXT,
  p_storage_path TEXT,
  p_mime_type TEXT,
  p_file_size BIGINT,
  p_content_hash BYTEA,
  p_encrypted_data_key BYTEA,
  p_master_key_version INT DEFAULT 1,
  p_width INT DEFAULT NULL,
  p_height INT DEFAULT NULL,
  p_page_count INT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_file_id UUID;
BEGIN
  -- Verify document exists
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_document_id) THEN
    RAISE EXCEPTION 'Document % not found', p_document_id;
  END IF;
  
  -- Check for existing file with same role (soft delete it)
  UPDATE document_files
  SET deleted_at = now()
  WHERE document_id = p_document_id
    AND file_role = p_file_role
    AND deleted_at IS NULL;
  
  -- Insert new file record
  INSERT INTO document_files (
    document_id, file_role, storage_path, mime_type, file_size,
    content_hash, encrypted_data_key, master_key_version,
    width, height, page_count
  )
  VALUES (
    p_document_id, p_file_role, p_storage_path, p_mime_type, p_file_size,
    p_content_hash, p_encrypted_data_key, p_master_key_version,
    p_width, p_height, p_page_count
  )
  RETURNING id INTO v_file_id;
  
  RETURN v_file_id;
END;
$$;

REVOKE ALL ON FUNCTION worker_update_document_file(UUID, TEXT, TEXT, TEXT, BIGINT, BYTEA, BYTEA, INT, INT, INT, INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_update_document_file(UUID, TEXT, TEXT, TEXT, BIGINT, BYTEA, BYTEA, INT, INT, INT, INT) TO service_role;

-- -----------------------------------------------------------------------------
-- worker_log_process_step: Log a granular step in the document pipeline
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_log_process_step(
  p_document_id UUID,
  p_new_process_status TEXT,
  p_step_details JSONB DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_history_entry JSONB;
  v_current_history JSONB;
BEGIN
  -- Build the history entry
  v_history_entry := jsonb_build_object(
    'status', p_new_process_status,
    'details', p_step_details,
    'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );

  -- Get current history
  SELECT COALESCE(process_history, '[]'::jsonb) INTO v_current_history
  FROM documents
  WHERE id = p_document_id;
  
  IF v_current_history IS NULL THEN
    RAISE EXCEPTION 'Document % not found', p_document_id;
  END IF;

  -- Update document atomically
  UPDATE documents
  SET 
    status = 'processing',
    process_status = p_new_process_status,
    process_history = v_current_history || v_history_entry,
    updated_at = now()
  WHERE id = p_document_id;
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION worker_log_process_step(UUID, TEXT, JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_log_process_step(UUID, TEXT, JSONB) TO service_role;

-- -----------------------------------------------------------------------------
-- worker_mark_processing_complete: Atomically complete processing
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_mark_processing_complete(
  p_document_id UUID,
  p_final_status TEXT, -- 'processed', 'rejected', or 'errored'
  p_details JSONB DEFAULT NULL,
  p_error_message TEXT DEFAULT NULL
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_process_status TEXT;
  v_history_entry JSONB;
  v_current_history JSONB;
BEGIN
  -- Determine new status based on final_status
  IF p_final_status = 'processed' THEN
    v_new_process_status := 'completed';
    v_history_entry := jsonb_build_object(
      'status', 'completed',
      'details', p_details,
      'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  ELSIF p_final_status = 'rejected' THEN
    v_new_process_status := 'rejected';
    v_history_entry := jsonb_build_object(
      'status', 'rejected',
      'details', p_details,
      'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  ELSE
    v_new_process_status := 'failed';
    v_history_entry := jsonb_build_object(
      'status', 'failed',
      'error', COALESCE(p_error_message, 'Unknown error'),
      'details', p_details,
      'at', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    );
  END IF;
  
  -- Get current history
  SELECT COALESCE(process_history, '[]'::jsonb) INTO v_current_history
  FROM documents
  WHERE id = p_document_id;
  
  IF v_current_history IS NULL THEN
    RAISE EXCEPTION 'Document % not found', p_document_id;
  END IF;
  
  -- Update document atomically
  UPDATE documents
  SET 
    status = p_final_status,
    process_status = v_new_process_status,
    process_history = v_current_history || v_history_entry,
    updated_at = now()
  WHERE id = p_document_id;
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION worker_mark_processing_complete(UUID, TEXT, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_mark_processing_complete(UUID, TEXT, JSONB, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- worker_create_child_document: Create child document for PDF splitting
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_create_child_document(
  p_parent_document_id UUID,
  p_owner_id UUID,
  p_page_range JSONB,
  p_type_hint TEXT DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_child_id UUID;
BEGIN
  -- Verify parent document exists
  IF NOT EXISTS (SELECT 1 FROM documents WHERE id = p_parent_document_id) THEN
    RAISE EXCEPTION 'Parent document % not found', p_parent_document_id;
  END IF;

  -- Create child document linked to parent
  INSERT INTO documents (
    owner_id,
    parent_document_id,
    page_range,
    document_type,
    status,
    process_status
  )
  VALUES (
    p_owner_id,
    p_parent_document_id,
    p_page_range,
    NULL, -- Do not use type hint as document_type anymore, let it be determined by processing
    'queued',
    'pending'
  )
  RETURNING id INTO v_child_id;

  RETURN v_child_id;
END;
$$;

REVOKE ALL ON FUNCTION worker_create_child_document(UUID, UUID, JSONB, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_create_child_document(UUID, UUID, JSONB, TEXT) TO service_role;

-- -----------------------------------------------------------------------------
-- worker_increment_llm_billing: Increment stats in the llm_billing JSONB col
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION worker_increment_llm_billing(
  p_document_id UUID,
  p_prompt_tokens BIGINT DEFAULT 0,
  p_completion_tokens BIGINT DEFAULT 0,
  p_pages INT DEFAULT 0,
  p_cost NUMERIC(10, 6) DEFAULT 0
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_current_billing JSONB;
  v_new_billing JSONB;
BEGIN
  -- Verify document exists
  SELECT COALESCE(llm_billing, '{"prompt_tokens": 0, "completion_tokens": 0, "pages": 0, "cost": 0}'::jsonb) 
  INTO v_current_billing
  FROM documents 
  WHERE id = p_document_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Document % not found', p_document_id;
  END IF;

  -- Calculate new values
  v_new_billing := jsonb_build_object(
    'prompt_tokens', COALESCE((v_current_billing->>'prompt_tokens')::BIGINT, 0) + COALESCE(p_prompt_tokens, 0),
    'completion_tokens', COALESCE((v_current_billing->>'completion_tokens')::BIGINT, 0) + COALESCE(p_completion_tokens, 0),
    'pages', COALESCE((v_current_billing->>'pages')::INT, 0) + COALESCE(p_pages, 0),
    'cost', COALESCE((v_current_billing->>'cost')::NUMERIC(10, 6), 0.0) + COALESCE(p_cost, 0.0)
  );

  -- Update document atomically
  UPDATE documents
  SET 
    llm_billing = v_new_billing
    -- We do not update 'updated_at' here as it might trigger unnecessary events
    -- for a simple internal metric bump, or we can if we want tracking.
  WHERE id = p_document_id;
  
  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION worker_increment_llm_billing(UUID, BIGINT, BIGINT, INT, NUMERIC(10, 6)) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION worker_increment_llm_billing(UUID, BIGINT, BIGINT, INT, NUMERIC(10, 6)) TO service_role;

