/**
 * Deterministic operational context regression.
 * Run: node ./node_modules/.bin/tsx lib/services/deterministic-context.test.ts
 */

import fs from "fs";
import path from "path";

const root = process.cwd();
const forbiddenRoots = [
  "lib/services",
  "app/api/tenants",
  "app/api/payments",
  "app/api/notifications/send-reminder",
  "app/api/notifications/test-reminder",
  "app/api/owner",
  "app/api/hostels",
];

const allowedFiles = new Set([
  "lib/services/deterministic-context.test.ts",
]);
const firstHostelAllowedFiles = new Set([
  "lib/services/deterministic-context.test.ts",
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
  console.log("\nDeterministic operational context checks");
  const files = forbiddenRoots.flatMap((relative) => {
    const full = path.join(root, relative);
    return fs.existsSync(full) ? walk(full) : [];
  });

  const offenders = files
    .map((file) => path.relative(root, file))
    .filter((relative) => !allowedFiles.has(relative))
    .filter((relative) => fs.readFileSync(path.join(root, relative), "utf8").includes("getPreferences("));

  assert(
    offenders.length === 0,
    "Operational services/routes do not use owner-first getPreferences fallback",
    offenders.join(", "),
  );

  const firstHostelOffenders = files
    .map((file) => path.relative(root, file))
    .filter((relative) => !firstHostelAllowedFiles.has(relative))
    .filter((relative) => /hostels\s*\[\s*0\s*\]/.test(fs.readFileSync(path.join(root, relative), "utf8")));

  assert(
    firstHostelOffenders.length === 0,
    "Operational services/routes do not index hostels[0] for context",
    firstHostelOffenders.join(", "),
  );

  console.log(`\nDeterministic context: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.error(failures.join("\n"));
    process.exit(1);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });

export {};
