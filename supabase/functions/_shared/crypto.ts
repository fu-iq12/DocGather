/**
 * Cryptographic Primitive Wrapper
 * Provides AES-256-GCM symmetric encryption for documents and interfaces with Vault RPCs for key management.
 *
 * @see architecture/documents-checklist.md - "Encryption implementation"
 */

/**
 * Result of file encryption containing ciphertext and initialization vector.
 */
export interface EncryptedFile {
  /** Encrypted file content */
  ciphertext: Uint8Array;
  /** 12-byte initialization vector (required for decryption) */
  iv: Uint8Array;
}

/**
 * Generates a 256-bit Document Encryption Key (DEK).
 * Each document should have its own DEK for security isolation.
 *
 * @returns 32-byte random key as Uint8Array
 */
export function generateDEK(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

/**
 * Encrypts file data using AES-256-GCM with the provided DEK.
 * Generates a random 12-byte IV for each encryption.
 *
 * @param data - Raw file content as Uint8Array
 * @param dek - 256-bit Document Encryption Key
 * @returns Encrypted data with IV
 */
export async function encryptFile(
  data: Uint8Array,
  dek: Uint8Array,
): Promise<EncryptedFile> {
  // Generate random 12-byte IV (NIST recommended for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12));

  // Import DEK as CryptoKey
  const key = await crypto.subtle.importKey(
    "raw",
    dek as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt"],
  );

  // Encrypt with AES-256-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    data as unknown as BufferSource,
  );

  return {
    ciphertext: new Uint8Array(ciphertext),
    iv,
  };
}

/**
 * Decrypts file data using AES-256-GCM with the provided DEK and IV.
 *
 * @param ciphertext - Encrypted file content
 * @param dek - 256-bit Document Encryption Key
 * @param iv - 12-byte initialization vector used during encryption
 * @returns Decrypted file content as Uint8Array
 * @throws Error if decryption fails (wrong key, tampered data, etc.)
 */
export async function decryptFile(
  ciphertext: Uint8Array,
  dek: Uint8Array,
  iv: Uint8Array,
): Promise<Uint8Array> {
  // Import DEK as CryptoKey
  const key = await crypto.subtle.importKey(
    "raw",
    dek as unknown as BufferSource,
    { name: "AES-GCM" },
    false,
    ["decrypt"],
  );

  // Decrypt with AES-256-GCM
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );

  return new Uint8Array(plaintext);
}

/**
 * Computes SHA-256 hash of data.
 * IMPORTANT: Hash must be computed BEFORE encryption for deduplication to work.
 *
 * @param data - Data to hash
 * @returns 32-byte SHA-256 hash as Uint8Array
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    data as unknown as BufferSource,
  );
  return new Uint8Array(hash);
}

/**
 * Converts Uint8Array to base64 string for storage/transmission.
 *
 * @param bytes - Bytes to encode
 * @returns Base64 encoded string
 */
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts base64 string back to Uint8Array.
 *
 * @param base64 - Base64 encoded string
 * @returns Decoded bytes as Uint8Array
 */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts Uint8Array to hex string (useful for logging hashes).
 *
 * @param bytes - Bytes to encode
 * @returns Hex encoded string
 */
export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Converts hex string to Uint8Array.
 * Handles optional "0x" or "\\x" prefix.
 *
 * @param hex - Hex encoded string
 * @returns Decoded bytes as Uint8Array
 */
export function hexToBytes(hex: string): Uint8Array {
  const cleanHex = hex.replace(/^0x|^\\x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string (odd length)");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = parseInt(cleanHex.substr(i, 2), 16);
  }
  return bytes;
}
