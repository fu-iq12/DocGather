/**
 * Shared response utilities for Supabase Edge Functions.
 */

export interface ErrorResponse {
  error: string;
  code: string;
  details?: unknown;
}

/**
 * Creates a standardized JSON response.
 */
export function jsonResponse(data: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Creates a standardized error response.
 */
export function errorResponse(
  error: string,
  code: string,
  status: number = 400,
  details?: unknown,
): Response {
  return jsonResponse({ error, code, details }, status);
}
