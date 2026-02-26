/**
 * Vault Seed Generator
 * Synthesizes a SQL migration payload from `.env.local` to securely persist cryptographic keys and service credentials into Supabase Vault.
 */
import fs from "node:fs";
import path from "node:path";

// Define paths
const secretsPath = path.join(process.cwd(), ".env.local");
const seedPath = path.join(process.cwd(), "supabase", "seed.sql");

console.log(`Generating seed.sql from ${secretsPath}...`);

// Check if secrets file exists
if (!fs.existsSync(secretsPath)) {
  console.warn(
    `Warning: Secrets file not found at ${secretsPath}. Skipping seed generation.`,
  );
  // Create empty seed file if it doesn't exist to prevent errors
  if (!fs.existsSync(seedPath)) {
    fs.writeFileSync(seedPath, "-- No secrets found to seed\n");
  }
  process.exit(0);
}

// Read secrets
const content = fs.readFileSync(secretsPath, "utf-8");
const lines = content.split("\n");

let sql = `-- Vault Seed Payload\n`;
sql += `-- Auto-generated from .env.local at ${new Date().toISOString()}\n`;
sql += `-- @see architecture/documents-checklist.md - "Vault Master Key handling"\n\n`;
sql += `-- Store cryptographic and service secrets into Supabase Vault\n`;

let count = 0;

for (const line of lines) {
  const trimmed = line.trim();
  // Skip empty lines and comments
  if (!trimmed || trimmed.startsWith("#")) continue;

  const indexOfEquals = trimmed.indexOf("=");
  if (indexOfEquals === -1) continue;

  const key = trimmed.substring(0, indexOfEquals).trim();
  const value = trimmed.substring(indexOfEquals + 1).trim();

  // Only seed variables starting with SB_ (and specifically exclude standard URL/Key if we want, but user said "select only vars prefixes with SB_")
  // We assume the user has renamed everything to SB_ as per plan.
  if (key && value && key.startsWith("SB_")) {
    // Escape single quotes in value for SQL safety
    const safeValue = value.replace(/'/g, "''");
    // Use vault.create_secret to securely store the secret
    // Signature: create_secret(secret text, name text, description text)
    sql += `select vault.create_secret('${safeValue}', '${key}', 'Seeded from .env.local');\n`;
    count++;
  }
}

// Write to seed.sql
fs.writeFileSync(seedPath, sql);
console.log(`Successfully generated ${seedPath} with ${count} secrets.`);
