import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("R3 renewal integration static checks", () => {
  it("exposes renewal queue, tenant renewal, history, draft, and signing routes", () => {
    expect(read("app/api/agreements/renewals/route.ts")).toContain("getOwnerRenewalQueue");
    expect(read("app/api/tenant/agreement-renewal/route.ts")).toContain("getTenantRenewalDecision");
    expect(read("app/api/agreements/history/route.ts")).toContain("getAgreementHistory");
    expect(read("app/api/agreements/[id]/renewal-draft/route.ts")).toContain("agreementRenewalService.createRenewalDraft");
    expect(read("app/api/agreements/[id]/sign-renewal/route.ts")).toContain("agreementRenewalSigningService.signRenewalAgreement");
  });

  it("keeps WhatsApp agreement summary on current-agreement semantics", () => {
    const source = read("lib/services/notifications/owner-whatsapp-assistant.ts");
    expect(source).toContain("CURRENT_AGREEMENT_STATUSES");
    expect(source).toContain("a.status::text IN");
  });

  it("renders AGREEMENT_RENEWED in owner activity logs", () => {
    const source = read("app/api/owner/activity-logs/route.ts");
    expect(source).toContain("systemEventLog.findMany");
    expect(source).toContain("AGREEMENT_RENEWED");
    expect(source).toContain("Agreement renewed");
  });

  it("does not change agreement lifecycle cron status source", () => {
    const source = read("src/services/tenants/agreement-lifecycle-service.ts");
    expect(source).toContain("AGREEMENT_LIFECYCLE_MANAGED_STATUSES");
    expect(source).not.toContain("renewalDecisionService");
  });
});
