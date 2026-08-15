import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    identity_documents: { findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
    identity_document_shares: { findMany: vi.fn(), findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
    hostels: { findFirst: vi.fn() },
  },
  supabase: {},
}));

import { prisma } from "@/lib/db";
import { documentVaultService, requiredDocumentTypes } from "@/src/services/profile/document-vault-service";

const documents = () => (prisma as any).identity_documents;
const shares = () => (prisma as any).identity_document_shares;
const hostels = () => (prisma as any).hostels;

beforeEach(() => vi.clearAllMocks());

describe("cross-hostel boundary", () => {
  it("refuses to list documents for a hostel the caller does not own", async () => {
    hostels().findFirst.mockResolvedValueOnce(null);

    await expect(documentVaultService.listForHostel("owner-b", "hostel-a")).rejects.toThrow(
      /do not manage this hostel/i,
    );
    expect(shares().findMany).not.toHaveBeenCalled();
  });

  it("scopes the owner's read to that hostel and to live shares only", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "hostel-a" });
    shares().findMany.mockResolvedValueOnce([]);

    await documentVaultService.listForHostel("owner-a", "hostel-a");

    const where = shares().findMany.mock.calls[0][0].where;
    expect(where.hostel_id).toBe("hostel-a");
    // A revoked share must not resurface a document the tenant withdrew.
    expect(where.revoked_at).toBeNull();
    expect(where.document.is_active).toBe(true);
  });

  it("refuses a verdict on a share belonging to another owner's hostel", async () => {
    shares().findUnique.mockResolvedValueOnce({
      id: "s1",
      revoked_at: null,
      hostel_id: "hostel-a",
      document: { is_active: true, doc_type: "AADHAAR", profile_id: "p1" },
    });
    hostels().findFirst.mockResolvedValueOnce(null); // owner-b does not own hostel-a

    await expect(documentVaultService.setShareVerdict("owner-b", "s1", "VERIFIED")).rejects.toThrow(
      /do not manage this hostel/i,
    );
    expect(shares().update).not.toHaveBeenCalled();
  });
});

describe("verification lives on the share, not the document", () => {
  beforeEach(() => {
    shares().findUnique.mockResolvedValue({
      id: "s1",
      revoked_at: null,
      hostel_id: "hostel-a",
      document: { is_active: true, doc_type: "AADHAAR", profile_id: "p1" },
    });
    hostels().findFirst.mockResolvedValue({ id: "hostel-a" });
    shares().update.mockResolvedValue({ id: "s1", status: "VERIFIED" });
  });

  it("writes the verdict to the share and never touches the document", async () => {
    await documentVaultService.setShareVerdict("owner-a", "s1", "VERIFIED");

    expect(shares().update).toHaveBeenCalled();
    // The whole model rests on this: one owner's decision must not become
    // every other owner's.
    expect(documents().updateMany).not.toHaveBeenCalled();
    expect(documents().create).not.toHaveBeenCalled();
  });

  it("clears any prior rejection when verifying", async () => {
    await documentVaultService.setShareVerdict("owner-a", "s1", "VERIFIED");

    const data = shares().update.mock.calls[0][0].data;
    expect(data).toMatchObject({ status: "VERIFIED", verified_by: "owner-a" });
    expect(data.rejected_at).toBeNull();
    expect(data.rejection_reason).toBeNull();
  });

  it("requires a reason to reject, so the tenant knows what to fix", async () => {
    await expect(documentVaultService.setShareVerdict("owner-a", "s1", "REJECTED", "  ")).rejects.toThrow(
      /give a reason/i,
    );
  });

  it("refuses a verdict once the share has been revoked", async () => {
    shares().findUnique.mockResolvedValueOnce({
      id: "s1",
      revoked_at: new Date(),
      hostel_id: "hostel-a",
      document: { is_active: true, doc_type: "AADHAAR", profile_id: "p1" },
    });

    await expect(documentVaultService.setShareVerdict("owner-a", "s1", "VERIFIED")).rejects.toThrow(
      /no longer shared/i,
    );
  });

  it("refuses a verdict on a document that has been replaced", async () => {
    shares().findUnique.mockResolvedValueOnce({
      id: "s1",
      revoked_at: null,
      hostel_id: "hostel-a",
      document: { is_active: false, doc_type: "AADHAAR", profile_id: "p1" },
    });

    await expect(documentVaultService.setShareVerdict("owner-a", "s1", "VERIFIED")).rejects.toThrow(
      /replaced by a newer upload/i,
    );
  });
});

describe("sharing and revoking", () => {
  it("upserts one share per document so a re-grant cannot duplicate a verdict", async () => {
    documents().findMany.mockResolvedValueOnce([{ id: "d1" }, { id: "d2" }]);
    shares().upsert.mockResolvedValue({});

    const result = await documentVaultService.grantToHostel("p1", "hostel-a", "t1");

    expect(result).toEqual({ granted: 2 });
    expect(shares().upsert).toHaveBeenCalledTimes(2);
    // Re-granting must revive the existing row rather than create a rival one.
    expect(shares().upsert.mock.calls[0][0].update).toMatchObject({ revoked_at: null });
  });

  it("grants nothing when the vault is empty", async () => {
    documents().findMany.mockResolvedValueOnce([]);
    const result = await documentVaultService.grantToHostel("p1", "hostel-a");
    expect(result).toEqual({ granted: 0 });
    expect(shares().upsert).not.toHaveBeenCalled();
  });

  it("revokes by marking, never by deleting, so verifiers stay attributable", async () => {
    shares().updateMany.mockResolvedValueOnce({ count: 2 });

    await documentVaultService.revokeFromHostel("p1", "hostel-a");

    const call = shares().updateMany.mock.calls[0][0];
    expect(call.data.revoked_at).toBeInstanceOf(Date);
    // Scoped to this person's own documents — a tenant cannot revoke someone
    // else's share by naming their hostel.
    expect(call.where.document.profile_id).toBe("p1");
  });

  it("retires the previous document of the same type instead of deleting it", async () => {
    documents().updateMany.mockResolvedValueOnce({ count: 1 });
    documents().create.mockResolvedValueOnce({ id: "d2" });

    await documentVaultService.addDocument("p1", {
      doc_type: "AADHAAR",
      file_url: "https://example.com/a.jpg",
      mime_type: "image/jpeg",
      file_size: 1024,
    });

    // Existing shares point at the old row; an owner's past verification must
    // stay attributable to what they actually looked at.
    expect(documents().updateMany.mock.calls[0][0].data).toMatchObject({ is_active: false });
    expect(documents().create).toHaveBeenCalled();
  });
});

describe("required document types", () => {
  it("asks a working professional for a work ID, not a college ID", () => {
    expect(requiredDocumentTypes("WORKING_PROFESSIONAL")).toEqual(["AADHAAR", "WORK_ID"]);
  });

  it("defaults to the student set when the type is unknown or absent", () => {
    expect(requiredDocumentTypes(null)).toEqual(["AADHAAR", "COLLEGE_ID"]);
    expect(requiredDocumentTypes("anything-else")).toEqual(["AADHAAR", "COLLEGE_ID"]);
  });
});
