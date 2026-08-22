import fs from "fs";
import path from "path";

const root = process.cwd();

const checks: Array<{
  name: string;
  roots: string[];
  pattern: RegExp;
  allow?: RegExp[];
}> = [
  {
    name: "frontend must not use active hostel localStorage helpers",
    roots: ["../frontend/src"],
    pattern: /\bgetActiveHostelId\b|\bsetActiveHostelId\b|\bclearActiveHostelIds\b|activeHostel:\$\{/,
    allow: [/context\/HostelContext\.jsx$/],
  },
  {
    name: "operational backend must not invalidate dashboard by owner",
    roots: ["lib/services", "app/api"],
    pattern: /invalidateDashboardCache\(/,
    allow: [/lib\/cache\/dashboard-cache\.ts$/],
  },
  {
    name: "operational backend must not use optional hostelId service contracts",
    roots: ["lib/services", "app/api/dashboard", "app/api/analytics", "app/api/rooms", "app/api/tenants", "app/api/payments", "app/api/expenses", "app/api/food", "app/api/announcements", "app/api/hostel-events", "app/api/service-requests", "app/api/utility-status"],
    pattern: /hostelId\?:\s*string|hostelId\?:\s*string\s*\|/,
    allow: [
      /architectural-invariants-check\.ts$/,
      /lib\/services\/rent-generation-service\.test\.ts$/,
      /lib\/services\/notifications\/owner-whatsapp-assistant\.ts$/,
      /lib\/services\/notifications\/whatsapp-selection-state\.ts$/,
      /lib\/services\/notifications\/whatsapp-template-delivery\.ts$/,
      /lib\/services\/expense-service\.ts$/,
    ],
  },
  {
    name: "operational code must not select first hostel as fallback",
    roots: ["lib/services", "app/api/dashboard", "app/api/analytics", "app/api/rooms", "app/api/tenants", "app/api/payments", "app/api/expenses", "app/api/food", "app/api/announcements", "app/api/hostel-events", "app/api/service-requests", "app/api/utility-status"],
    pattern: /findFirst\([\s\S]{0,220}owner_id[\s\S]{0,220}hostel|hostels\s*\[\s*0\s*\]/,
    allow: [
      /architectural-invariants-check\.ts$/,
      /lib\/services\/activation-service\.ts$/,
      /lib\/services\/deterministic-context\.test\.ts$/,
      /lib\/services\/hostel-billing-preferences-service\.ts$/,
      /lib\/services\/invitation-service\.ts$/,
      /lib\/services\/reminder-service\.ts$/,
      /lib\/services\/tenant-service\.ts$/,
      /lib\/services\/notifications\/owner-whatsapp-assistant\.ts$/,
      /app\/api\/payments\/test-intent\/route\.ts$/,
      // False positive: findFirst here scopes strictly by owner_id (real
      // authorization, not a "first hostel" fallback) — the regex's wide
      // window just happens to reach the next statement's unrelated
      // `prisma.hostel_announcements`/`prisma.hostel_events` model name.
      /app\/api\/announcements\/\[id\]\/route\.ts$/,
      /app\/api\/hostel-events\/\[id\]\/route\.ts$/,
      // False positive: tenant_service_requests has no owner_id column, so
      // ownership is checked post-fetch via the included hostels relation
      // (`existing.hostels.owner_id !== scope.owner_id`) rather than in the
      // `where` clause — a real, correct authorization check, not a
      // first-hostel fallback.
      /app\/api\/service-requests\/\[id\]\/status\/route\.ts$/,
    ],
  },
  {
    name: "no $queryRawUnsafe in operational services or API routes",
    // `src/services` added 2026-08-23. CLAUDE.md points new domain services
    // here, so the newest financial code in the repo — settlement, payouts,
    // the gateway ledger — was sitting entirely outside this rule. That is the
    // opposite of where a raw-SQL guard is most needed.
    //
    // NOTE: the other rules in this file still scan only `lib/services` and
    // `app/api`. Extending them is worth doing but needs each pre-existing hit
    // audited first, so it is left as known, visible debt rather than done
    // blind here.
    roots: ["lib/services", "app/api", "src/services"],
    pattern: /\$queryRawUnsafe/,
    allow: [
      /architectural-invariants-check\.ts$/,
      // Audited 2026-08-23 and genuinely require the unsafe form:
      //  - settlement-engine: interpolates a generated ORDER BY priority CASE
      //    clause (an identifier-level fragment, not parameterisable). All
      //    values are still bound as $1/$2.
      //  - agreement-r4-readiness: interpolates nothing; every value is bound.
      /src\/services\/payments\/settlement-engine\.ts$/,
      /src\/services\/tenants\/agreement-r4-readiness-service\.ts$/,
      // Approved exceptions — audit/invariant tooling only (per RAW_SQL_HARDENING_REPORT.md)
      /lib\/services\/financial-invariants?\.ts$/,
      /lib\/services\/financial-invariant-service\.ts$/,
      /lib\/services\/hostel-invariant-validator\.ts$/,
      /lib\/services\/migration-audit-service\.ts$/,
      /lib\/services\/owner-isolation-invariant-service\.ts$/,
      /lib\/services\/raw-sql-hardening\.test\.ts$/,
      /scripts\//,
    ],
  },
  {
    name: "settled Payment ledger rows must not be mutated by operational code",
    roots: ["lib/services", "app/api"],
    pattern: /prisma\.payments\.(update|updateMany|upsert|delete|deleteMany)\b|tx\.payments\.(update|updateMany|upsert|delete|deleteMany)\b/,
    allow: [
      /architectural-invariants-check\.ts$/,
    ],
  },
  {
    name: "payment attempt status changes must use transition helper",
    roots: ["lib/services", "app/api/payments", "app/api/addons", "app/api/billing", "app/api/webhooks"],
    pattern: /paymentAttempt\.(update|updateMany)\([\s\S]{0,450}status\s*:/,
    allow: [
      /payment-service\.ts$/,
      /payment-status-event-service\.ts$/,
    ],
  },
  {
    name: "portfolio-service must not query raw transactional tables (payments, rent_obligations, tenants)",
    roots: ["lib/services/portfolio-service.ts"],
    pattern: /prisma\.(payment|rentObligation|tenant)\.(findMany|findFirst|groupBy|aggregate|count)\b(?![\s\S]{0,10}hostel)/,
    allow: [],
  },
  {
    name: "frontend operational hooks must include hostelId in queryKey",
    roots: ["../frontend/src/hooks"],
    pattern: /useQuery\(\{[\s\S]{0,600}queryKey\s*:\s*\[(?![^\]]*hostelId)/,
    allow: [
      /useActivation\.js$/,
      /useSubscription\.js$/,
      /useNotifications\.js$/,
      /usePortfolio\.js$/,
      /useHostels\.js$/,
      /useBilling\.js$/,
    ],
  },
];

function walk(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const stat = fs.statSync(dir);
  if (stat.isFile()) return /\.(ts|tsx|js|jsx)$/.test(dir) ? [dir] : [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".next", "dist", "coverage"].includes(entry.name)) return [];
      return walk(full);
    }
    return /\.(ts|tsx|js|jsx)$/.test(entry.name) ? [full] : [];
  });
}

let failed = 0;

for (const check of checks) {
  const offenders: string[] = [];
  for (const relativeRoot of check.roots) {
    for (const file of walk(path.resolve(root, relativeRoot))) {
      const relative = path.relative(root, file).replaceAll(path.sep, "/");
      if (check.allow?.some((rule) => rule.test(relative))) continue;
      const contents = fs.readFileSync(file, "utf8");
      if (check.pattern.test(contents)) offenders.push(relative);
    }
  }

  if (offenders.length) {
    failed++;
    console.error(`FAIL ${check.name}`);
    offenders.forEach((file) => console.error(`  - ${file}`));
  } else {
    console.log(`OK ${check.name}`);
  }
}

if (failed) process.exit(1);
