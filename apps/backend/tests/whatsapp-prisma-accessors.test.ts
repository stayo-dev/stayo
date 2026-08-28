import { readFileSync, readdirSync, statSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

/**
 * Every `prisma.<model>` accessor in the WhatsApp tree must name a real model.
 *
 * This exists because of a production outage on 2026-08-27: identity resolution
 * called `prisma.profiles.findFirst`, but the Prisma model is `profile` —
 * `@@map("profiles")` names the *table*, not the client accessor. Since
 * `lib/db` exports `prisma` as `any`, `tsc` saw nothing, the build was green,
 * and **every inbound WhatsApp message** threw
 * `Cannot read properties of undefined (reading 'findFirst')`.
 *
 * Nothing else can catch this class of bug: the compiler is blinded by `any`,
 * and the DB-backed suite does not run without `DATABASE_URL_TEST`. So it is
 * checked the only way that works everywhere — by reading `schema.prisma` and
 * the source, with no client and no database.
 */

const BACKEND_ROOT = path.resolve(__dirname, "..");
const SCHEMA = path.join(BACKEND_ROOT, "prisma", "schema.prisma");

/** Directories whose Prisma usage this guard covers. */
const WATCHED = [
  "lib/services/notifications",
  "src/services/tenants/activation-workflow-service.ts",
];

/**
 * Prisma's delegate name is the model name with its first character lowercased
 * — `PhoneVerificationOtp` → `phoneVerificationOtp`, `profile` → `profile`,
 * `tenant_billing_plans` → `tenant_billing_plans`.
 */
function delegateNames(): Set<string> {
  const schema = readFileSync(SCHEMA, "utf8");
  const names = new Set<string>();
  // `Array.from` rather than iterating the iterator directly — this project
  // targets below es2015 for downlevel iteration.
  for (const match of Array.from(schema.matchAll(/^model\s+([A-Za-z0-9_]+)\s*\{/gm))) {
    const model = match[1];
    names.add(model.charAt(0).toLowerCase() + model.slice(1));
  }
  return names;
}

function walk(target: string): string[] {
  const stats = statSync(target);
  if (stats.isFile()) return target.endsWith(".ts") ? [target] : [];
  return readdirSync(target).flatMap((entry) => walk(path.join(target, entry)));
}

/**
 * `prisma.<name>.<method>(` — including through the `(prisma as any)` cast the
 * codebase uses in places, which is exactly where a typo hides best.
 */
function accessorsIn(file: string): string[] {
  const source = readFileSync(file, "utf8");
  const found: string[] = [];
  const pattern = /(?:\bprisma|\(prisma as any\))\s*\.\s*([A-Za-z0-9_]+)\s*\.\s*(?:findFirst|findMany|findUnique|findFirstOrThrow|findUniqueOrThrow|create|createMany|update|updateMany|upsert|delete|deleteMany|count|aggregate|groupBy)\b/g;
  for (const match of Array.from(source.matchAll(pattern))) found.push(match[1]);
  return found;
}

describe("WhatsApp Prisma model accessors", () => {
  const models = delegateNames();
  const files = WATCHED.flatMap((entry) => walk(path.join(BACKEND_ROOT, entry)))
    .filter((file) => !file.endsWith(".test.ts"));

  it("finds the tree it is meant to be guarding", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(models.size).toBeGreaterThan(50);
  });

  it("resolves every accessor to a model declared in schema.prisma", () => {
    const offenders: string[] = [];

    for (const file of files) {
      for (const accessor of accessorsIn(file)) {
        // `$transaction` callbacks bind their own client; those are `tx.*`,
        // not `prisma.*`, so anything reaching here should be a real model.
        if (!models.has(accessor)) {
          offenders.push(`${path.relative(BACKEND_ROOT, file)} → prisma.${accessor}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("knows that `profiles` is a table name and `profile` is the model", () => {
    // The exact confusion that caused the outage, pinned so it cannot recur.
    expect(models.has("profile")).toBe(true);
    expect(models.has("profiles")).toBe(false);
  });
});
