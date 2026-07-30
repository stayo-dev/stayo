import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../../../.env") });

const directUrl = process.env.DIRECT_URL;
if (!directUrl) {
  console.error("❌ Error: DIRECT_URL environment variable is missing from .env");
  process.exit(1);
}

const backupDir = path.join(__dirname, "../../../db-dumps");
const backupFile = path.join(backupDir, "production-prelaunch-backup.sql");

async function main() {
  console.log("=== Phase 1: Creating Pre-Reset Production Database Backup ===");

  if (!fs.existsSync(backupDir)) {
    console.log(`Creating backup directory: ${backupDir}`);
    fs.mkdirSync(backupDir, { recursive: true });
  }

  // Parse connection details to show host/db (mask password)
  try {
    const parsedUrl = new URL(directUrl.replace("postgresql://", "http://"));
    console.log(`Target database: ${parsedUrl.hostname}/${parsedUrl.pathname.replace("/", "")}`);
  } catch (e) {
    console.log("Target database connection URL parsed.");
  }

  console.log(`Executing pg_dump 17 via Podman to: ${backupFile}...`);
  try {
    // Run pg_dump via podman container to ensure pg_dump v17 matches server v17
    const podmanCmd = `podman run --net=host -i --rm -v "${backupDir}:/db-dumps" docker.io/library/postgres:17-alpine pg_dump "${directUrl}" -F p -f /db-dumps/production-prelaunch-backup.sql`;
    
    execSync(podmanCmd, { stdio: "inherit" });
    
    // Verify backup file exists and has content
    if (!fs.existsSync(backupFile)) {
      throw new Error(`Backup file was not created at ${backupFile}`);
    }

    const stats = fs.statSync(backupFile);
    if (stats.size === 0) {
      throw new Error(`Backup file is empty (0 bytes)`);
    }

    console.log("✅ Database backup completed successfully!");
    console.log(`Backup File: ${backupFile}`);
    console.log(`File Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  } catch (error: any) {
    console.error("❌ Database backup FAILED:", error?.message || error);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Unexpected script error:", err);
  process.exit(1);
});
