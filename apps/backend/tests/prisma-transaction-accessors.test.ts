import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

/**
 * `lib/db.ts` patches ~52 camelCase delegate aliases onto its own `prisma`
 * instance (`prisma.visitorLead` -> `prisma.visitor_leads`) so older call
 * sites keep working.
 *
 * Those aliases live on that ONE object. The interactive-transaction client
 * Prisma passes to a `$transaction(async (tx) => ...)` callback is a
 * different object and carries none of them, so `tx.visitorLead` is
 * `undefined` and the call throws `Cannot read properties of undefined`.
 *
 * It is invisible three ways over: `prisma` is exported as `any`, so it
 * compiles; the alias works on the line above, so it reads correctly; and a
 * test that mocks `@/lib/db` supplies whatever key the code asks for, so the
 * suite agrees with the bug. Two of these took the Discover enquiry flow
 * down and three more sat in the payment status writer.
 *
 * Inside a transaction, always use the real snake_case delegate.
 *
 * PURE — reads source files only.
 */

const BACKEND = join(__dirname, "..");
const ROOTS = ["src", "lib", "app"];

function readAliases(): Set<string> {
  const db = readFileSync(join(BACKEND, "lib/db.ts"), "utf8");
  const names = [...db.matchAll(/^ {2}([A-Za-z_][A-Za-z0-9_]*):\s*"[a-z_]+",/gm)].map((m) => m[1]);
  return new Set(names);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (full.endsWith(".ts") || full.endsWith(".tsx")) out.push(full);
  }
  return out;
}

describe("transaction clients never use a lib/db.ts delegate alias", () => {
  const aliases = readAliases();

  it("finds the alias table, so this test cannot silently pass on nothing", () => {
    expect(aliases.size).toBeGreaterThan(20);
    expect(aliases.has("visitorLead")).toBe(true);
  });

  it("no tx.<alias> call anywhere in the backend", () => {
    const offenders: string[] = [];

    for (const root of ROOTS) {
      for (const file of walk(join(BACKEND, root))) {
        const lines = readFileSync(file, "utf8").split("\n");
        lines.forEach((line, i) => {
          // Prose describing the bug is not the bug. Without this, the
          // comment explaining the fix at each call site trips the check.
          const code = line.trim();
          if (code.startsWith("*") || code.startsWith("//") || code.startsWith("/*")) return;

          const match = line.match(/(?<![A-Za-z0-9_])tx\.([A-Za-z_][A-Za-z0-9_]*)/);
          if (match && aliases.has(match[1])) {
            offenders.push(`${relative(BACKEND, file)}:${i + 1}: tx.${match[1]}`);
          }
        });
      }
    }

    expect(offenders).toEqual([]);
  });
});
