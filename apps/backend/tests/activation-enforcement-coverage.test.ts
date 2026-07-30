import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("C6 activation financial enforcement coverage", () => {
  it("does not enforce through first-activation writers anymore (decoupled)", () => {
    const invitationService = read("src/services/tenants/invitation-service.ts");
    const activationWorkflowService = read("src/services/tenants/activation-workflow-service.ts");
    const tenantInvitationLifecycleService = read("src/services/tenants/tenant-invitation-lifecycle-service.ts");

    expect(invitationService).not.toContain("assertActivationFinancialReady");
    expect(activationWorkflowService).not.toContain("assertActivationFinancialReady");
    expect(tenantInvitationLifecycleService).not.toContain("assertActivationFinancialReady");
  });

  it("does not enforce through reactivation, migration, or repair paths", () => {
    const tenantService = read("src/services/tenants/tenant-service.ts");
    const tenantMigrationService = read("lib/services/tenant-migration-service.ts");
    const repairScript = read("scripts/repair-onboarding-maintenance-obligations.ts");

    expect(tenantService).not.toContain("assertActivationFinancialReady");
    expect(tenantMigrationService).not.toContain("assertActivationFinancialReady");
    expect(repairScript).not.toContain("assertActivationFinancialReady");
  });

  it("does not duplicate financial readiness calculations outside the source-of-truth services", () => {
    const allowed = new Set([
      "src/services/tenants/activation-financial-status-service.ts",
      "src/services/tenants/activation-financial-enforcement-service.ts",
    ]);
    const files = [
      "src/services/tenants/invitation-service.ts",
      "src/services/tenants/activation-workflow-service.ts",
      "src/services/tenants/tenant-invitation-lifecycle-service.ts",
      "src/services/tenants/tenant-service.ts",
      "lib/services/tenant-migration-service.ts",
      "scripts/repair-onboarding-maintenance-obligations.ts",
    ];

    for (const file of files) {
      if (allowed.has(file)) continue;
      const source = read(file);
      expect(source).not.toMatch(/depositOutstanding\s*[<>=]/);
      expect(source).not.toMatch(/maintenanceOutstanding\s*[<>=]/);
    }
  });
});
