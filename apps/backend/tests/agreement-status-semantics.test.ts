import { describe, expect, it } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  agreementDocumentAccessibleWhere,
  currentAgreementWhere,
  historicalAgreementWhere,
  isAgreementDocumentAccessibleStatus,
  isCurrentAgreementStatus,
  isHistoricalAgreementStatus,
  isSignedAgreementStatus,
} from "@/src/services/tenants/agreement-status";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

describe("agreement status semantics", () => {
  it("keeps renewed agreements document-accessible for downloads and history", () => {
    expect(isAgreementDocumentAccessibleStatus("SIGNED")).toBe(true);
    expect(isAgreementDocumentAccessibleStatus("EXPIRING_SOON")).toBe(true);
    expect(isAgreementDocumentAccessibleStatus("AGREEMENT_EXPIRED")).toBe(true);
    expect(isAgreementDocumentAccessibleStatus("RENEWED")).toBe(true);
    expect(isAgreementDocumentAccessibleStatus("TERMINATED")).toBe(true);
    expect(isAgreementDocumentAccessibleStatus("DRAFT")).toBe(false);
    expect(isAgreementDocumentAccessibleStatus("VOID")).toBe(false);
    expect(agreementDocumentAccessibleWhere()).toEqual({
      in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED", "RENEWED", "TERMINATED"],
    });
  });

  it("excludes renewed agreements from current-agreement queries", () => {
    expect(isCurrentAgreementStatus("SIGNED")).toBe(true);
    expect(isCurrentAgreementStatus("EXPIRING_SOON")).toBe(true);
    expect(isCurrentAgreementStatus("AGREEMENT_EXPIRED")).toBe(true);
    expect(isCurrentAgreementStatus("RENEWED")).toBe(false);
    expect(isCurrentAgreementStatus("TERMINATED")).toBe(false);
    expect(isCurrentAgreementStatus("DRAFT")).toBe(false);
    expect(isCurrentAgreementStatus("VOID")).toBe(false);
    expect(currentAgreementWhere()).toEqual({
      in: ["SIGNED", "EXPIRING_SOON", "AGREEMENT_EXPIRED"],
    });
  });

  it("identifies historical agreement statuses", () => {
    expect(isHistoricalAgreementStatus("RENEWED")).toBe(true);
    expect(isHistoricalAgreementStatus("TERMINATED")).toBe(true);
    expect(isHistoricalAgreementStatus("SIGNED")).toBe(false);
    expect(isHistoricalAgreementStatus("EXPIRING_SOON")).toBe(false);
    expect(isHistoricalAgreementStatus("AGREEMENT_EXPIRED")).toBe(false);
    expect(historicalAgreementWhere()).toEqual({ in: ["RENEWED", "TERMINATED"] });
  });

  it("preserves the existing signed-document compatibility helper", () => {
    expect(isSignedAgreementStatus("RENEWED")).toBe(true);
    expect(isSignedAgreementStatus("TERMINATED")).toBe(true);
    expect(isSignedAgreementStatus("DRAFT")).toBe(false);
  });

  it("keeps downloads on document-access semantics", () => {
    const downloadRoute = read("app/api/tenants/[id]/documents/[docId]/download/route.ts");
    expect(downloadRoute).toContain("agreementDocumentAccessibleWhere()");
    expect(downloadRoute).not.toContain("currentAgreementWhere()");
  });

  it("uses current-agreement semantics for profile and document cards", () => {
    const files = [
      "lib/services/tenant-profile-portal-service.ts",
      "app/api/tenants/me/documents/route.ts",
      "app/api/tenants/[id]/documents/route.ts",
      "app/api/tenants/[id]/full/route.ts",
    ];

    for (const file of files) {
      const source = read(file);
      expect(source).toContain("currentAgreementWhere()");
      expect(source).not.toContain("signedAgreementStatusWhere()");
    }
  });

  it("keeps activation signed-step compatibility but selects current agreements for active context", () => {
    const source = read("src/services/tenants/activation-workflow-service.ts");
    expect(source).toContain("isSignedAgreementStatus(a.status)");
    expect(source).toContain("isCurrentAgreementStatus(a.status)");
    expect(source).toContain("status: currentAgreementWhere()");
  });

  it("does not change lifecycle cron managed statuses", () => {
    const source = read("src/services/tenants/agreement-lifecycle-service.ts");
    expect(source).toContain("AGREEMENT_LIFECYCLE_MANAGED_STATUSES");
    expect(source).not.toContain("currentAgreementWhere()");
    expect(source).not.toContain("agreementDocumentAccessibleWhere()");
  });
});
