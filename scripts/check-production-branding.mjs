import fs from "node:fs";
import path from "node:path";

const target = process.argv[2] || "dist";
const root = path.resolve(process.cwd(), target);

const forbidden = [
  /NIVĀ/i,
  /\bNIVA\b/i,
  /owner temporary/i,
  /temporary owner/i,
  /HMS SaaS/i,
  /HMS - Hostel Management System/i,
  /Advanced SaaS for Hostel Management/i,
  /SaaSInput/i,
  // ── Retired identities — must never reappear in production output ──
  // Stayo is the product; Trishul Solutions is the operating company (both
  // are now permitted, and are asserted across the site on purpose). What
  // must stay OUT of shipped output is the old single-hostel brand and the
  // retired domains/contact it shipped with, so no conflicting identity
  // leaks back in and undermines Meta / payment-provider verification.
  /Sri\s*Adithya/i,
  /sriadithyahostels/i,
  /stayo\.app/i,
  /spchidiri2006/i,
];

// `.ts`/`.tsx` are included so this can be pointed at **source**, not only at
// built output. It could not before, and that gap is not theoretical: a retired
// single-hostel identity sat hardcoded in the backend's receipt template and
// was printed on every receipt the product issued, because the only invocation
// scanned `apps/frontend/dist` and the backend has no bundled output to scan.
const textFilePattern = /\.(html?|jsx?|tsx?|mjs|cjs|css|json|webmanifest|xml|txt|svg|map)$/i;

/** Never worth scanning: dependencies, build caches, and this script itself. */
const SKIP_DIRS = new Set(["node_modules", ".next", ".turbo", ".git", "coverage"]);

const failures = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(fullPath);
      continue;
    }
    // The rule list itself necessarily contains the forbidden strings.
    if (path.resolve(fullPath) === path.resolve(process.argv[1])) continue;
    if (!textFilePattern.test(entry.name)) continue;

    const content = fs.readFileSync(fullPath, "utf8");
    for (const pattern of forbidden) {
      const match = content.match(pattern);
      if (match) {
        failures.push({
          file: path.relative(process.cwd(), fullPath),
          match: match[0],
          pattern: String(pattern),
        });
      }
    }
  }
}

if (!fs.existsSync(root)) {
  console.error(`[branding-check] Missing build output: ${root}`);
  process.exit(1);
}

walk(root);

if (failures.length > 0) {
  console.error("[branding-check] Forbidden production branding found:");
  for (const failure of failures) {
    console.error(`- ${failure.file}: "${failure.match}" (${failure.pattern})`);
  }
  process.exit(1);
}

console.log(`[branding-check] OK: no forbidden production branding in ${path.relative(process.cwd(), root) || root}`);
