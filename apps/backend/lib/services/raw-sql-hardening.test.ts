/**
 * Raw SQL hardening regression.
 * Run: node ./node_modules/.bin/tsx lib/services/raw-sql-hardening.test.ts
 */

import fs from "fs";
import path from "path";

const root = process.cwd();
const scanRoots = ["lib", "app"];
const allowedUnsafe = new Set([
  "lib/services/raw-sql-hardening.test.ts",
  "lib/services/migration-audit-service.ts",
  "lib/services/financial-invariant-service.ts",
  "lib/services/owner-isolation-invariant-service.ts",
  "lib/services/hostel-invariant-validator.ts",
]);

let passed = 0;
let failed = 0;
const failures: string[] = [];

function walk(dir: string): string[] {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
  }
  return files;
}

function assert(condition: boolean, name: string, detail = "") {
  if (condition) {
    console.log(`  OK ${name}`);
    passed++;
    return;
  }
  const message = `  FAIL ${name}${detail ? ` - ${detail}` : ""}`;
  console.error(message);
  failures.push(message);
  failed++;
}

async function main() {
  console.log("\nRaw SQL hardening checks");
  const files = scanRoots.flatMap((relative) => walk(path.join(root, relative)));

  const unsafeOffenders = files
    .map((file) => path.relative(root, file))
    .filter((relative) => !allowedUnsafe.has(relative))
    .filter((relative) => /\$queryRawUnsafe|\$executeRawUnsafe/.test(fs.readFileSync(path.join(root, relative), "utf8")));

  assert(
    unsafeOffenders.length === 0,
    "Operational app/services do not use unsafe raw SQL",
    unsafeOffenders.join(", "),
  );

  console.log(`\nRaw SQL hardening: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
