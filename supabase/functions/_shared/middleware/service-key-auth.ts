/**
 * Service Key Authentication Middleware
 *
 * Validates that the `apikey` header matches SB_SECRET_KEY.
 * Used for service-role-only edge functions (e.g., worker storage endpoints).
 *
 * This is a safety-net guard in case verify_jwt=false is set by mistake,
 * ensuring only callers with the secret key can access these endpoints.
 */

import { errorResponse } from "./response.ts";

const SB_SECRET_KEY = Deno.env.get("SB_SECRET_KEY");

/**
 * Validates the apikey header against SB_SECRET_KEY.
 * Returns an error response if the key is missing or invalid.
 */
export async function ServiceKeyMiddleware(
  req: Request,
  next: (req: Request) => Promise<Response>,
): Promise<Response> {
  if (req.method === "OPTIONS") return await next(req);

  const apikey = req.headers.get("apikey");

  if (!apikey || apikey !== SB_SECRET_KEY) {
    return errorResponse("Invalid or missing apikey", "UNAUTHORIZED", 401);
  }

  return await next(req);
}
