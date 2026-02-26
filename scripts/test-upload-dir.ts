/**
 * Directory Ingestion Utility
 * Bulk-authenticates and streams a local directory into the Edge Function `upload-document` endpoint.
 * Useful for seeding large test sets into the pipeline.
 */
import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import ignore, { Ignore } from "ignore";

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
    console.log("Usage: npx tsx scripts/test-upload-dir.ts <email> <dir_path>");
    process.exit(1);
  }

  const email = args[0];
  const targetDir = args[1];
  const password = "Test1234!";

  console.log(`Target: ${SUPABASE_URL}`);
  console.log(`User: ${email}`);
  console.log(`Directory: ${targetDir}`);

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

  // 3. Scan directory
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    console.error(`Directory not found or is not a directory: ${targetDir}`);
    process.exit(1);
  }

  console.log("\n--- Scanning directory ---");
  const filesToUpload: string[] = [];

  function scanDir(currentDir: string, ig: Ignore) {
    let currentIg = ig;

    // Check for .uploadignore in current directory
    const ignorePath = path.join(currentDir, ".uploadignore");
    if (fs.existsSync(ignorePath)) {
      const ignoreContent = fs.readFileSync(ignorePath, "utf-8");
      // Create a new ignore instance for this subtree, inheriting patterns from parent
      currentIg = ignore().add(ig).add(ignoreContent);
      console.log(`Found .uploadignore in ${currentDir}`);
    }

    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      // The ignore package expects paths relative to the root being filtered.
      // We calculate path relative to targetDir so that globs like "node_modules" work globally or locally based on the .uploadignore locations.
      // Wait, more accurately, we should filter relative to where the .uploadignore was defined.
      // But standard gitignore usually applies relative to the file.
      // Since `add(ig)` merges rules, we'll just check `relPath` against targetDir root.
      const relPath = path.relative(targetDir, fullPath);

      // Ignore expects POSIX path separators
      const posixRelPath = relPath.split(path.sep).join("/");

      // If ignored by any pattern, skip it and its contents entirely
      if (
        currentIg.ignores(posixRelPath) ||
        currentIg.ignores(posixRelPath + (entry.isDirectory() ? "/" : ""))
      ) {
        continue;
      }

      if (entry.isDirectory()) {
        scanDir(fullPath, currentIg);
      } else {
        filesToUpload.push(fullPath);
      }
    }
  }

  // Start scan with an empty ignore instance
  scanDir(targetDir, ignore());

  console.log(`Found ${filesToUpload.length} files to upload.`);

  // 4. Upload
  console.log("\n--- Uploading Documents ---");

  for (let i = 0; i < filesToUpload.length; i++) {
    const filePath = filesToUpload[i];
    console.log(`\n[${i + 1}/${filesToUpload.length}] Uploading: ${filePath}`);

    try {
      const fileContent = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);

      const formData = new FormData();
      // In Node's global FormData, we can append a Blob.
      const blob = new Blob([fileContent], {
        type: "application/octet-stream",
      });
      formData.append("file", blob, fileName);
      formData.append("source", "test-script-dir");
      formData.append("filepath", filePath);

      const { data, error } = await supabase.functions.invoke(
        "upload-document",
        {
          body: formData,
        },
      );

      if (error) {
        const response = error.context as Response;
        if (response) {
          const body = await response.json();
          console.error(
            `Upload failed for ${fileName}:`,
            JSON.stringify(body, null, 2),
          );
        } else {
          console.error(
            `Upload failed for ${fileName}:`,
            JSON.stringify(error, null, 2),
          );
        }
      } else {
        console.log(
          `Upload successful -> Document ID: ${data?.documentId || (data && data.document?.id) || "unknown"}`,
        );
      }
    } catch (err) {
      console.error(`Upload request threw an error for ${filePath}:`, err);
    }
  }

  console.log("\n--- Done ---");
}

main();
