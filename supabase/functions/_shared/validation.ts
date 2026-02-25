/**
 * Input validation utilities for Edge Functions.
 */

/**
 * Maximum file size in bytes (50 MiB as configured in storage bucket).
 */
export const MAX_FILE_SIZE = 50 * 1024 * 1024;

/**
 * Validates that file size is within limits.
 *
 * @param size - File size in bytes
 * @param maxBytes - Maximum allowed size (defaults to MAX_FILE_SIZE)
 * @returns true if valid, false otherwise
 */
export function isValidFileSize(
  size: number,
  maxBytes: number = MAX_FILE_SIZE,
): boolean {
  return size > 0 && size <= maxBytes;
}
