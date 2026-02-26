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
  if (args.length < 2) {
    console.log("Usage: npx tsx scripts/test-upload.ts <email> <file_path>");
    process.exit(1);
  }

  const email = args[0];
  const filePath = args[1];
  const password = "Test1234!";

  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`User: ${email}`);
  console.log(`File: ${filePath}`);

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
    .from("documents")
    .delete()
    .eq("owner_id", authData.session?.user.id);

  // 3. Prepare File
  if (!fs.existsSync(filePath)) {
    console.error(`File not found: ${filePath}`);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);
  const fileStats = fs.statSync(filePath);

  // Need to mimic a File object for FormData if using standard FormData,
  // but in Node environment with native fetch, FormData handling can be tricky.
  // We'll use the 'form-data' compatible approach or the native FormData if available (Node 18+).

  const formData = new FormData();
  // In Node's global FormData, we can append a Blob.
  const blob = new Blob([fileContent], { type: "application/octet-stream" });
  formData.append("file", blob, fileName);
  formData.append("source", "test-script");
  formData.append("filepath", filePath);

  // 4. Upload
  console.log("\n--- Uploading Document ---");

  try {
    const { data, error } = await supabase.functions.invoke("upload-document", {
      body: formData,
    });

    if (error) {
      const response = error.context as Response;
      if (response) {
        const body = await response.json();
        console.error("Function error object:", JSON.stringify(body, null, 2));
      } else {
        console.error("Function error object:", JSON.stringify(error, null, 2));
      }
      process.exit(1);
    }

    console.log("Upload successful!");
    console.log("Response:", JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Upload request failed:", err);
    process.exit(1);
  }
}

main();
