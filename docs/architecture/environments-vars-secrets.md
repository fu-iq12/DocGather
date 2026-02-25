# Environment Variables & Secrets

This document outlines the strategy for managing environment variables and secrets in DocGather, ensuring security across local development, CI/CD, and production (Fly.io/Supabase).

## Philosophy

1.  **Prefixing**: All Supabase-related environment variables and secrets are prefixed with `SB_`.
2.  **Edge Functions**: Supabase Edge Functions automatically inject environment variables prefixed with `SB_` (if they are set in the Supabase Dashboard/Secrets). This avoids manual injection in tests and scripts.
3.  **Service Role Security**: We rely on Supabase's Service Role mechanism (Row Level Security bypass or specific Grants) for secure backend-to-backend communication (e.g., Workers -> Database). We do **not** use shared secrets like `FLY_WORKER_SECRET` anymore.
4.  **Local Consolidation**: Local development secrets are consolidated in `.env.local`.

## Variable Reference

### Core Supabase Variables

| Variable Name        | Description                                  | Visibility     | Injected By             |
| :------------------- | :------------------------------------------- | :------------- | :---------------------- |
| `SUPABASE_URL`       | Supabase Project URL (API Gateway)           | Public/Private | `.env.local` / Platform |
| `SB_PUBLISHABLE_KEY` | Public/Anon Key (For client-side components) | Public         | `.env.local` / Platform |
| `SB_SECRET_KEY`      | Service Role Key (For backend/admin tasks)   | **SECRET**     | `.env.local` / Platform |

### Master Keys (Encryption)

| Variable Name      | Description                                    | Visibility | Storage        |
| :----------------- | :--------------------------------------------- | :--------- | :------------- |
| `SB_MASTER_KEY_V1` | Master key for envelope encryption (Version 1) | **SECRET** | Supabase Vault |

> **Note**: Master keys are stored in Supabase Vault and are **not** typically available as standard environment variables in the application at runtime. They are accessed via SQL functions (`get_vault_secret` or direct Vault access) which are protected by `SECURITY DEFINER` constraints.

### Removed Variables

- `FLY_WORKER_SECRET`: usage replaced by `SB_SECRET_KEY` (Service Role) authentication.
- `DOCGATHER_MASTER_KEY_V1`: renamed to `SB_MASTER_KEY_V1`.

## Local Development

- **File**: `.env.local`
- **Usage**:
  - **Workers**: `sys` read `.env` with `dotenv` or `docker-compose` environment mapping.
  - **Edge Functions**: `supabase start` does NOT automatically load `.env.local` for functions unless specified or seeded.
  - **Database Seeding**: `supabase/seed.ts` reads `.env.local`, filters for `SB_` keys, and creates Vault secrets for local development only.

### `supabase/seed.ts` Behavior

The seed script scans `.env.local` for keys starting with `SB_` and inserts them into the local Supabase Vault. This mimics the production environment where secrets might be stored in the Vault for SQL access.

## CI/CD & Secret Injection Strategy

### Build Time vs Runtime

- **Runtime Secrets** (API Keys, DB Passwords): MUST be injected at runtime.
- **Build Time Variables** (Public URLs, Public Keys): Can be baked in, but preferably injected at runtime for flexibility.

### Fly.io vs GitHub Actions

We considered two approaches for building the worker images:

#### Option A: GitHub Actions (Recommended)

Build the Docker image in GitHub Actions and push to a registry (GHCR or Fly Registry).

- **Pros**: Free build minutes, easy integration with GitHub Secrets, standard CI flow.
- **Cons**: Need to manage registry usage.
- **Secret Injection**:
  - **Build**: Use `secrets.GITHUB_TOKEN` for registry auth.
  - **Runtime**: Use `fly secrets set` to push production secrets (`SB_SECRET_KEY`, etc.) to the running Fly Machine. **Do NOT bake secrets into the image.**

#### Option B: Fly.io Remote Builder

Use `fly deploy` which builds on a remote Fly machine.

- **Pros**: Integrated.
- **Cons**: Can be slower (context upload), build secrets manual handling.

### Recommendation

**Use GitHub Actions for building (CI) and `fly secrets` for runtime configuration (CD/Ops).**
Secrets like `SB_SECRET_KEY` should be set in Fly.io using:

```bash
fly secrets set SUPABASE_URL=... SB_SECRET_KEY=...
```

These will be available as environment variables in the Node.js process (`process.env.SUPABASE_URL`).

## Migration Guide (Refactor 2026-02)

If you are updating from an older version:

1.  Rename `SUPABASE_URL` -> `SUPABASE_URL` in `.env.local`.
2.  Rename `SUPABASE_SERVICE_ROLE_KEY` -> `SB_SECRET_KEY` in `.env.local`.
3.  Rename `DOCGATHER_MASTER_KEY_V1` -> `SB_MASTER_KEY_V1` in `.env.local`.
4.  Remove `FLY_WORKER_SECRET`.
5.  Run `npx tsx supabase/seed.ts` to re-seed local Vault.
