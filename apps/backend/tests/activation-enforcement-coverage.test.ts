import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Source with comments stripped. Comments explaining *why* the gate was removed
 * are exactly what should survive in these files, so matching against them would
 * punish the documentation this change deliberately left behind.
 */
function read(relativePath: string) {
  return fs
    .readFileSync(path.join(root, relativePath), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");
}

/**
 * The onboarding payment gate is gone: a tenant gets their room when they join and
 * pays deposit/maintenance afterwards. These tests keep it gone.
 *
 * The gate was previously spread across four call sites plus two duplicate inline
 * reimplementations of the same arithmetic, which is how it managed to disagree
 * with itself. Guarding by source inspection is crude, but it is the only thing
 * that catches a well-meaning reintroduction in a *new* file.
 */
describe("onboarding payment gate stays removed", () => {
  const gateSurface = [
    "src/services/tenants/invitation-service.ts",
    "src/services/tenants/activation-workflow-service.ts",
    "src/services/tenants/tenant-invitation-lifecycle-service.ts",
    "src/services/tenants/tenant-service.ts",
    "lib/services/room-capacity-service.ts",
    "lib/services/move-out-service.ts",
    "lib/services/tenant-profile-portal-service.ts",
    "lib/services/tenant-migration-service.ts",
    "src/services/admissions/admissions-service.ts",
    "scripts/repair-onboarding-maintenance-obligations.ts",
  ];

  it("has no reservation-status vocabulary left in the onboarding path", () => {
    for (const file of gateSurface) {
      const source = read(file);
      expect(source, file).not.toContain("reservationStatusService");
      expect(source, file).not.toContain("PAYMENT_PENDING");
      expect(source, file).not.toContain("MOVE_IN_READY");
    }
  });

  it("does not gate activation or allocation on financial readiness", () => {
    for (const file of gateSurface) {
      const source = read(file);
      expect(source, file).not.toContain("assertActivationFinancialReady");
    }
  });

  it("does not reimplement the deposit/maintenance calculation outside its one service", () => {
    for (const file of gateSurface) {
      const source = read(file);
      expect(source, file).not.toMatch(/depositOutstanding\s*[<>=]/);
      expect(source, file).not.toMatch(/maintenanceOutstanding\s*[<>=]/);
    }
  });

  it("no longer carries the partial-deposit reservation threshold", () => {
    for (const file of [...gateSurface, "src/services/tenants/activation-financial-status-service.ts"]) {
      const source = read(file);
      expect(source, file).not.toContain("minimum_reservation_deposit");
      expect(source, file).not.toContain("reservation_policy");
    }
  });
});
