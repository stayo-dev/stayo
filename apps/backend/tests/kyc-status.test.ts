import { describe, expect, it, vi } from "vitest";
import {
  requiredKycDocTypes,
  isKycComplete,
  describeKycGap,
  kycGapMessage,
  isApprovedKycDoc,
  recomputeDocumentVerified,
  approveRequiredActiveKycDocs,
} from "@/src/services/tenants/kyc-status";

const approved = (doc_type: string) => ({ doc_type, document_status: "APPROVED", is_verified: true, is_active: true });
const pending = (doc_type: string) => ({ doc_type, document_status: "PENDING", is_verified: false, is_active: true });
const rejected = (doc_type: string) => ({ doc_type, document_status: "REJECTED", is_verified: false, is_active: true });
const archivedApproved = (doc_type: string) => ({ doc_type, document_status: "APPROVED", is_verified: true, is_active: false });

describe("kyc-status — pure helpers", () => {
  describe("requiredKycDocTypes", () => {
    it("is Aadhaar + College ID for students and the default", () => {
      expect(requiredKycDocTypes("STUDENT")).toEqual(["AADHAAR", "COLLEGE_ID"]);
      expect(requiredKycDocTypes(null)).toEqual(["AADHAAR", "COLLEGE_ID"]);
      expect(requiredKycDocTypes("nonsense")).toEqual(["AADHAAR", "COLLEGE_ID"]);
    });
    it("is Aadhaar + Work ID for working professionals", () => {
      expect(requiredKycDocTypes("WORKING_PROFESSIONAL")).toEqual(["AADHAAR", "WORK_ID"]);
      expect(requiredKycDocTypes("working_professional")).toEqual(["AADHAAR", "WORK_ID"]);
    });
  });

  describe("isApprovedKycDoc", () => {
    it("needs both APPROVED status and is_verified", () => {
      expect(isApprovedKycDoc({ doc_type: "AADHAAR", document_status: "APPROVED", is_verified: true })).toBe(true);
      expect(isApprovedKycDoc({ doc_type: "AADHAAR", document_status: "APPROVED", is_verified: false })).toBe(false);
      expect(isApprovedKycDoc({ doc_type: "AADHAAR", document_status: "PENDING", is_verified: true })).toBe(false);
    });
  });

  describe("isKycComplete", () => {
    it("is true only when every required type has an active APPROVED doc", () => {
      expect(isKycComplete("STUDENT", [approved("AADHAAR"), approved("COLLEGE_ID")])).toBe(true);
      expect(isKycComplete("STUDENT", [approved("AADHAAR"), pending("COLLEGE_ID")])).toBe(false);
      expect(isKycComplete("STUDENT", [approved("AADHAAR")])).toBe(false);
    });
    it("ignores archived documents", () => {
      expect(isKycComplete("STUDENT", [approved("AADHAAR"), archivedApproved("COLLEGE_ID")])).toBe(false);
    });
    it("does not count a rejected or pending document", () => {
      expect(isKycComplete("STUDENT", [approved("AADHAAR"), rejected("COLLEGE_ID")])).toBe(false);
    });
    it("re-evaluates against the new type — College ID stops counting for a professional", () => {
      const studentDocs = [approved("AADHAAR"), approved("COLLEGE_ID")];
      expect(isKycComplete("STUDENT", studentDocs)).toBe(true);
      expect(isKycComplete("WORKING_PROFESSIONAL", studentDocs)).toBe(false);
    });
  });

  describe("describeKycGap / kycGapMessage", () => {
    it("reports nothing when complete", () => {
      const gap = describeKycGap("STUDENT", [approved("AADHAAR"), approved("COLLEGE_ID")]);
      expect(gap).toEqual({ missing: [], pending: [], rejected: [], complete: true });
      expect(kycGapMessage(gap)).toBeNull();
    });
    it("separates missing, pending and rejected", () => {
      const gap = describeKycGap("WORKING_PROFESSIONAL", [pending("AADHAAR")]);
      expect(gap.missing).toEqual(["WORK_ID"]);
      expect(gap.pending).toEqual(["AADHAAR"]);
      expect(kycGapMessage(gap)).toMatch(/Work ID/);
    });
    it("flags a rejected type", () => {
      const gap = describeKycGap("STUDENT", [approved("AADHAAR"), rejected("COLLEGE_ID")]);
      expect(gap.rejected).toEqual(["COLLEGE_ID"]);
      expect(kycGapMessage(gap)).toMatch(/rejected/i);
    });
  });
});

describe("recomputeDocumentVerified", () => {
  function fakeTx(profileType: string, docs: any[], current = false) {
    return {
      tenants: {
        findUnique: vi.fn(async () => ({ id: "t1", profile_type: profileType, document_verified: current })),
        update: vi.fn(async () => ({})),
      },
      identificationDocument: {
        findMany: vi.fn(async () => docs),
      },
    } as any;
  }

  it("sets document_verified true once every required active doc is approved", async () => {
    const tx = fakeTx("STUDENT", [approved("AADHAAR"), approved("COLLEGE_ID")]);
    const result = await recomputeDocumentVerified(tx, "t1");
    expect(result).toBe(true);
    expect(tx.tenants.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { document_verified: true } });
  });

  it("stays false while a required type is pending, and skips a no-op write", async () => {
    const tx = fakeTx("STUDENT", [approved("AADHAAR"), pending("COLLEGE_ID")], false);
    const result = await recomputeDocumentVerified(tx, "t1");
    expect(result).toBe(false);
    expect(tx.tenants.update).not.toHaveBeenCalled();
  });

  it("flips a verified student to false after switching to working professional", async () => {
    const tx = fakeTx("WORKING_PROFESSIONAL", [approved("AADHAAR"), approved("COLLEGE_ID")], true);
    const result = await recomputeDocumentVerified(tx, "t1");
    expect(result).toBe(false);
    expect(tx.tenants.update).toHaveBeenCalledWith({ where: { id: "t1" }, data: { document_verified: false } });
  });
});

describe("approveRequiredActiveKycDocs", () => {
  function fakeTx(activeDocs: any[]) {
    return {
      identificationDocument: {
        findMany: vi.fn(async () => activeDocs.map((d, i) => ({ id: `d${i}`, ...d }))),
        updateMany: vi.fn(async () => ({ count: 0 })),
      },
    } as any;
  }

  it("refuses when a required type has no active row", async () => {
    const tx = fakeTx([pending("AADHAAR")]);
    const result = await approveRequiredActiveKycDocs(tx, { id: "t1", profile_type: "STUDENT" }, "owner-1");
    expect(result.gap.missing).toEqual(["COLLEGE_ID"]);
    expect(result.approved).toBe(0);
    expect(tx.identificationDocument.updateMany).not.toHaveBeenCalled();
  });

  it("approves only the not-yet-approved required rows", async () => {
    const tx = fakeTx([approved("AADHAAR"), pending("COLLEGE_ID")]);
    const result = await approveRequiredActiveKycDocs(tx, { id: "t1", profile_type: "STUDENT" }, "owner-1");
    expect(result.gap.missing).toEqual([]);
    expect(result.approved).toBe(1);
    expect(tx.identificationDocument.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ document_status: "APPROVED", is_verified: true }) }),
    );
  });
});
