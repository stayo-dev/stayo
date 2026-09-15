/**
 * Every route under `app/api/admin/**` must be platform-admin gated — or be a
 * decommissioned 410 stub. This is the "impossible to accidentally expose
 * again" guard from C2 (2026-09-14 audit): a new admin route that forgets its
 * guard, or gates on OWNER instead of ADMIN, fails here before it can ship.
 *
 * Source-level (pure): it reads every route file and inspects how it gates,
 * rather than executing handlers — so it covers routes this suite has no
 * fixtures for, and can never fall out of step with the filesystem.
 */

import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ADMIN_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "app/api/admin");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

const routeFiles = walk(ADMIN_DIR);

/** A stub that answers every method with HTTP 410 needs no auth — it exposes nothing. */
function isDecommissioned(src: string): boolean {
  return /status:\s*410/.test(src) && !/getSession|getCurrentUser/.test(src);
}

/** Gates that actually require a platform admin. */
function hasAdminGate(src: string): boolean {
  return (
    /requireAdmin\s*\(/.test(src) ||
    /requireSettlementAdmin\s*\(/.test(src) ||
    /role\s*!==\s*["']ADMIN["']/.test(src) ||
    /role\s*===\s*["']ADMIN["']/.test(src) ||
    /\[\s*["']ADMIN["']\s*\]\.includes/.test(src)
  );
}

/** An OWNER-only gate with no ADMIN gate is exactly the C2 bug. */
function gatesOnOwnerOnly(src: string): boolean {
  const ownerGate = /role\s*(===|!==)\s*["']OWNER["']/.test(src);
  return ownerGate && !hasAdminGate(src);
}

describe("every /api/admin route", () => {
  it("has at least one route file (sanity)", () => {
    expect(routeFiles.length).toBeGreaterThan(0);
  });

  for (const file of routeFiles) {
    const rel = path.relative(ADMIN_DIR, file);
    const src = fs.readFileSync(file, "utf8");

    it(`admin/${rel} is admin-gated or decommissioned`, () => {
      expect(isDecommissioned(src) || hasAdminGate(src)).toBe(true);
    });

    it(`admin/${rel} does not gate on OWNER alone`, () => {
      expect(gatesOnOwnerOnly(src)).toBe(false);
    });
  }
});
