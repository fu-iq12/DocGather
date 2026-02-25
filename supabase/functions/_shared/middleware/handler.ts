/**
 * Global request handler wrapper for Supabase Edge Functions.
 * Includes Authentication Middleware and Global Error Handling.
 */

import { AuthMiddleware } from "./auth.ts";
import { errorResponse } from "./response.ts";

/**
 * Creates a Deno.serve handler with:
 *   1. JWT auth middleware
 *   2. Global try/catch returning structured JSON on any unhandled error
 */
export function createHandler(
  handler: (req: Request) => Promise<Response>,
): void {
  console.info("Function handler initialized");

  Deno.serve((req) =>
    AuthMiddleware(req, async (req) => {
      try {
        return await handler(req);
      } catch (err) {
        // Extract error message and details
        let message = "Unknown error";
        let code = "INTERNAL_ERROR";

        if (err instanceof Error) {
          message = err.message;
        } else if (typeof err === "object" && err !== null) {
          // Handle structured errors (e.g. Supabase/Postgrest errors)
          const safeErr = err as Record<string, unknown>;
          const msg =
            safeErr.message || safeErr.error_description || safeErr.error;
          if (typeof msg === "string") {
            message = msg;
          } else {
            try {
              message = JSON.stringify(err);
            } catch {
              message = String(err);
            }
          }

          if (typeof safeErr.details === "string") {
            message += ` - ${safeErr.details}`;
          }
          if (typeof safeErr.hint === "string") {
            message += ` (Hint: ${safeErr.hint})`;
          }
          if (typeof safeErr.code === "string") {
            code = safeErr.code;
          }
        } else {
          message = String(err);
        }

        // Environment gating: Only show raw error details in non-production environments
        const environment = Deno.env.get("ENVIRONMENT") || "development";
        const isDev = environment !== "production";

        const publicMessage = isDev ? message : "Internal server error";
        const publicCode = isDev ? code : "INTERNAL_ERROR";

        let publicDetails: unknown = undefined;
        if (isDev) {
          if (err instanceof Error) {
            // Error objects are not JSON-serializable by default (properties are not enumerable)
            // We spread ...err first to capture any custom properties, then overwrite with standard props
            // @ts-ignore: spread works on error instances in updated JS environments or if it has custom props
            publicDetails = {
              ...err,
              name: err.name,
              message: err.message,
              stack: err.stack,
            };
          } else {
            publicDetails = err;
          }
        }

        return errorResponse(publicMessage, publicCode, 500, publicDetails);
      }
    }),
  );
}
