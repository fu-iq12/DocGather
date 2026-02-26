/**
 * Supabase Client Factories
 * Provisions either service-role or JWT-scoped clients for privileged or RLS-bound interactions from Edge VMs.
 */

import {
  createClient,
  SupabaseClient,
} from "https://esm.sh/@supabase/supabase-js@2.47.10";

/**
 * Creates a Supabase client with service_role privileges.
 * Use for privileged operations that bypass RLS.
 *
 * @returns Supabase client with service_role key
 */
export function createServiceClient(): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

/**
 * Creates a Supabase client scoped to a user's JWT.
 * Use for operations that should respect RLS.
 *
 * @param authHeader - Authorization header value (with "Bearer " prefix)
 * @returns Supabase client initialized with user's JWT
 */
export function createUserClient(authHeader: string): SupabaseClient {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_PUBLISHABLE_KEY")!,
    {
      global: {
        headers: { Authorization: authHeader },
      },
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

/**
 * Extracts user ID from JWT in a request.
 *
 * @param authHeader - Authorization header value
 * @returns User ID and JWT if valid, null otherwise
 */
export async function getUserFromAuth(
  authHeader: string | null,
): Promise<{ userId: string; jwt: string } | null> {
  if (!authHeader) return null;

  const client = createUserClient(authHeader);
  const {
    data: { user },
    error,
  } = await client.auth.getUser();

  if (error || !user) return null;
  return { userId: user.id, jwt: authHeader };
}
