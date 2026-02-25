-- =============================================================================
-- Phase 2: Encryption Functions- @documents-checklist.md
-- =============================================================================
-- Purpose: Enable pgcrypto extension and create functions for envelope encryption.
--          Master keys are stored in Vault; DEKs and metadata use pgcrypto.
-- Affected tables: document_files (encrypted_data_key), document_private (encrypted_*)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enable required extensions
-- -----------------------------------------------------------------------------
-- pgcrypto: provides cryptographic functions for AES encryption
create extension if not exists pgcrypto with schema extensions;

-- Note: supabase_vault is already enabled by default in Supabase projects
-- It provides vault.create_secret() and vault.decrypted_secrets view

-- -----------------------------------------------------------------------------
-- Function: encrypt_dek
-- -----------------------------------------------------------------------------
-- Purpose: Encrypts a Document Encryption Key (DEK) using the master key from Vault.
-- Security: SECURITY DEFINER to access vault.decrypted_secrets (restricted table).
-- Usage: Called from Edge Functions during document upload.
-- -----------------------------------------------------------------------------
create or replace function public.encrypt_dek(
  p_dek bytea,
  p_master_key_version int default 1
)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master_key text;
  v_key_name text;
begin
  -- Build key name based on version
  v_key_name := 'SB_MASTER_KEY_V' || p_master_key_version;
  
  -- Fetch master key from Vault
  select decrypted_secret into v_master_key
  from vault.decrypted_secrets
  where name = v_key_name;
  
  if v_master_key is null then
    raise exception 'Master key version % not found in Vault', p_master_key_version;
  end if;
  
  -- Encrypt DEK using PGP symmetric encryption (AES-256 by default)
  return extensions.pgp_sym_encrypt_bytea(p_dek, v_master_key);
end;
$$;

comment on function public.encrypt_dek is 
  'Encrypts a DEK with the master key from Vault. Used during document upload.';

-- -----------------------------------------------------------------------------
-- Function: decrypt_dek
-- -----------------------------------------------------------------------------
-- Purpose: Decrypts an encrypted DEK using the master key from Vault.
-- Security: SECURITY DEFINER to access vault.decrypted_secrets.
-- Usage: Called from Edge Functions to retrieve plaintext DEK for file decryption.
-- -----------------------------------------------------------------------------
create or replace function public.decrypt_dek(
  p_encrypted_dek bytea,
  p_master_key_version int
)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master_key text;
  v_key_name text;
begin
  v_key_name := 'SB_MASTER_KEY_V' || p_master_key_version;
  
  select decrypted_secret into v_master_key
  from vault.decrypted_secrets
  where name = v_key_name;
  
  if v_master_key is null then
    raise exception 'Master key version % not found in Vault', p_master_key_version;
  end if;
  
  return extensions.pgp_sym_decrypt_bytea(p_encrypted_dek, v_master_key);
end;
$$;

comment on function public.decrypt_dek is 
  'Decrypts an encrypted DEK using the master key from Vault.';

-- -----------------------------------------------------------------------------
-- Function: encrypt_jsonb
-- -----------------------------------------------------------------------------
-- Purpose: Encrypts JSONB data for storage in document_private.
-- Security: SECURITY DEFINER to access Vault.
-- Usage: Encrypting encrypted_metadata, encrypted_extracted_data, etc.
-- -----------------------------------------------------------------------------
create or replace function public.encrypt_jsonb(
  p_data jsonb,
  p_master_key_version int default 1
)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master_key text;
  v_key_name text;
begin
  v_key_name := 'SB_MASTER_KEY_V' || p_master_key_version;
  
  select decrypted_secret into v_master_key
  from vault.decrypted_secrets
  where name = v_key_name;
  
  if v_master_key is null then
    raise exception 'Master key version % not found in Vault', p_master_key_version;
  end if;
  
  -- Convert JSONB to text, then to bytea, then encrypt
  return extensions.pgp_sym_encrypt_bytea(
    convert_to(p_data::text, 'UTF8'),
    v_master_key
  );
end;
$$;

comment on function public.encrypt_jsonb is 
  'Encrypts JSONB data for secure storage. Used for document_private fields.';

-- -----------------------------------------------------------------------------
-- Function: decrypt_jsonb
-- -----------------------------------------------------------------------------
-- Purpose: Decrypts encrypted JSONB data back to JSONB.
-- Security: SECURITY DEFINER to access Vault.
-- Usage: Retrieving encrypted_metadata, encrypted_extracted_data from document_private.
-- -----------------------------------------------------------------------------
create or replace function public.decrypt_jsonb(
  p_encrypted bytea,
  p_master_key_version int
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_master_key text;
  v_key_name text;
  v_decrypted bytea;
begin
  v_key_name := 'SB_MASTER_KEY_V' || p_master_key_version;
  
  select decrypted_secret into v_master_key
  from vault.decrypted_secrets
  where name = v_key_name;
  
  if v_master_key is null then
    raise exception 'Master key version % not found in Vault', p_master_key_version;
  end if;
  
  v_decrypted := extensions.pgp_sym_decrypt_bytea(p_encrypted, v_master_key);
  return convert_from(v_decrypted, 'UTF8')::jsonb;
end;
$$;

comment on function public.decrypt_jsonb is 
  'Decrypts encrypted JSONB data back to JSONB. Used to read document_private fields.';

-- -----------------------------------------------------------------------------
-- Function: get_current_master_key_version
-- -----------------------------------------------------------------------------
-- Purpose: Returns the highest master key version available in Vault.
-- Usage: Determining which key version to use for new encryptions.
-- -----------------------------------------------------------------------------
create or replace function public.get_current_master_key_version()
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_max_version int;
begin
  select max(
    substring(name from 'SB_MASTER_KEY_V(\d+)')::int
  ) into v_max_version
  from vault.decrypted_secrets
  where name like 'SB_MASTER_KEY_V%';
  
  if v_max_version is null then
    raise exception 'No master keys found in Vault';
  end if;
  
  return v_max_version;
end;
$$;

comment on function public.get_current_master_key_version is 
  'Returns the current (highest) master key version from Vault.';

-- -----------------------------------------------------------------------------
-- Restrict Vault access
-- -----------------------------------------------------------------------------
-- Only service_role and postgres should access vault.decrypted_secrets
-- The encryption functions use SECURITY DEFINER to bypass this restriction
-- -----------------------------------------------------------------------------
revoke all on vault.decrypted_secrets from anon, authenticated;
revoke all on vault.secrets from anon, authenticated;
