/**
 * Single File Ingestion Utility
 * Authenticates and streams a single local file into the Edge Function `upload-document` endpoint
 * to manually trigger the async indexing pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient, FunctionsHttpError } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, "../.env.local") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SB_SECRET_KEY = process.env.SB_SECRET_KEY;
const SB_PUBLISHABLE_KEY = process.env.SB_PUBLISHABLE_KEY;

if (!SUPABASE_URL || !SB_SECRET_KEY || !SB_PUBLISHABLE_KEY) {
  console.error(
    "Error: SUPABASE_URL and SB_SECRET_KEY and SB_PUBLISHABLE_KEY must be set in .env.local",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SB_PUBLISHABLE_KEY);
const serviceClient = createClient(SUPABASE_URL, SB_SECRET_KEY);

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) {
    console.log("Usage: npx tsx scripts/test-kg.ts <email>");
    process.exit(1);
  }

  const email = args[0];
  const password = "Test1234!";

  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`User: ${email}`);

  // 1. Authenticate
  console.log("\n--- Authenticating ---");
  let { data: authData, error: authError } =
    await supabase.auth.signInWithPassword({
      email,
      password,
    });

  if (authError) {
    if (authError.message.includes("Invalid login credentials")) {
      console.log("User not found or wrong password. Attempting to sign up...");
      const { data: signUpData, error: signUpError } =
        await supabase.auth.signUp({
          email,
          password,
        });

      if (signUpError) {
        console.error("Sign up failed:", signUpError.message);
        process.exit(1);
      }

      if (signUpData.session) {
        authData = signUpData as any;
        console.log("Sign up successful and logged in.");
      } else if (signUpData.user) {
        console.log(
          "Sign up successful using existing user (or confirmation sent). code:",
          signUpData,
        );
        // Retry login just in case
        const { data: retryData, error: retryError } =
          await supabase.auth.signInWithPassword({
            email,
            password,
          });
        if (retryError) {
          console.error("Login after signup failed:", retryError.message);
          process.exit(1);
        }
        authData = retryData;
      }
    } else {
      console.error("Login failed:", authError.message);
      process.exit(1);
    }
  } else {
    console.log("Login successful.");
  }

  if (!authData.session) {
    console.error("No session established.");
    process.exit(1);
  }

  // 2. Truncate tables
  console.log("\n--- Truncating tables ---");
  await serviceClient
    .from("kg_entities")
    .delete()
    .eq("owner_id", authData.session?.user.id);

  // 3. Reset documents to pending
  await serviceClient
    .from("documents")
    .update({ kg_sync_status: "pending" })
    .eq("owner_id", authData.session?.user.id);

  // 4. Upload
  const workerApiKey = process.env.FLY_WORKER_API_KEY;
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${workerApiKey}`,
  };
  const workerPayload = {
    ownerId: authData.session?.user.id,
  };

  const workerUrl = String(process.env.FLY_WORKER_URL).replace(/^\/$/, "");
  const workerResponse = await fetch(`${workerUrl}/kg-ingest`, {
    method: "POST",
    headers,
    body: JSON.stringify(workerPayload),
  });
}

main();
