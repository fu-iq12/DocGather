-- =============================================================================
-- RPC: Get secret from Vault
-- =============================================================================
-- For testing and service_role access to Vault secrets.
-- Restricted to service_role only.
-- =============================================================================

CREATE OR REPLACE FUNCTION get_vault_secret(p_secret_name TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_secret TEXT;
BEGIN
  SELECT decrypted_secret INTO v_secret
  FROM vault.decrypted_secrets
  WHERE name = p_secret_name;
  
  IF v_secret IS NULL THEN
    RAISE EXCEPTION 'Secret % not found in Vault', p_secret_name;
  END IF;
  
  RETURN v_secret;
END;
$$;

-- Restrict to service_role only
REVOKE ALL ON FUNCTION get_vault_secret(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION get_vault_secret(TEXT) TO service_role;

