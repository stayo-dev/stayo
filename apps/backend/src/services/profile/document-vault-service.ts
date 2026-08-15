import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";

/**
 * The person-level document vault (phase B).
 *
 * A document is uploaded **once**, by the person, and belongs to them. A
 * hostel gets access through an `identity_document_shares` row, and that share
 * — not the document — carries the verification decision.
 *
 * That split is the entire model, and it settles a contradiction in the design
 * source: the prototype's verify screen promises "shared only with the owner
 * you enquire to" while its profile screen promises "verified once, reuse
 * anywhere". Only one can be the default. The tenant re-uses **the file**; no
 * owner inherits another owner's judgement about it.
 *
 * The access rule, in one sentence: an owner may see a document only through a
 * live (non-revoked) share for a hostel they own.
 */

/** What each kind of applicant must produce. Mirrors the pre-phase-B routes. */
export function requiredDocumentTypes(profileType?: string | null): string[] {
  return String(profileType || "STUDENT").toUpperCase() === "WORKING_PROFESSIONAL"
    ? ["AADHAAR", "WORK_ID"]
    : ["AADHAAR", "COLLEGE_ID"];
}

export type ShareStatus = "PENDING" | "VERIFIED" | "REJECTED";

const DOCUMENT_SELECT = {
  id: true,
  doc_type: true,
  doc_number: true,
  file_url: true,
  mime_type: true,
  file_size: true,
  is_active: true,
  created_at: true,
} as const;

export class DocumentVaultService {
  // ── Tenant side ────────────────────────────────────────────────────────────

  /**
   * The person's own vault, each document annotated with who it is shared with
   * and what each of them decided. The tenant is the one party entitled to see
   * every hostel's verdict at once — it is their document.
   */
  async listForProfile(profileId: string) {
    const documents = await prisma.identity_documents.findMany({
      where: { profile_id: profileId, is_active: true },
      orderBy: { created_at: "desc" },
      select: {
        ...DOCUMENT_SELECT,
        shares: {
          where: { revoked_at: null },
          select: {
            id: true,
            status: true,
            verified_at: true,
            rejection_reason: true,
            hostel: { select: { id: true, name: true } },
          },
        },
      },
    });

    return documents.map((document: any) => ({
      ...document,
      shared_with: document.shares.map((share: any) => ({
        share_id: share.id,
        hostel_id: share.hostel.id,
        hostel_name: share.hostel.name,
        status: share.status as ShareStatus,
        verified_at: share.verified_at,
        rejection_reason: share.rejection_reason,
      })),
      shares: undefined,
    }));
  }

  async addDocument(
    profileId: string,
    input: {
      doc_type: string;
      doc_number?: string | null;
      file_url: string;
      file_path?: string | null;
      file_id?: string | null;
      mime_type: string;
      file_size: number;
    },
  ) {
    if (!input.doc_type?.trim()) throw ApiError.validationError("Document type is required");
    if (!input.file_url?.trim()) throw ApiError.validationError("File URL is required");

    // Replacing a document of the same type retires the old one rather than
    // deleting it: existing shares point at it, and an owner's past
    // verification must stay attributable to what they actually looked at.
    await prisma.identity_documents.updateMany({
      where: { profile_id: profileId, doc_type: input.doc_type, is_active: true },
      data: { is_active: false, updated_at: new Date() },
    });

    return prisma.identity_documents.create({
      data: { profile_id: profileId, ...input },
      select: DOCUMENT_SELECT,
    });
  }

  /**
   * Share every active document with a hostel. Called when a tenancy is
   * created, and idempotent — re-granting reactivates the existing share
   * instead of stacking a second one with a conflicting verdict.
   *
   * Re-granting a previously revoked share deliberately **keeps** its old
   * status: the owner's earlier verification of that same file still stands,
   * and forcing them to re-verify a document they already checked is friction
   * with no safety benefit.
   */
  async grantToHostel(profileId: string, hostelId: string, tenantId?: string | null) {
    const documents = await prisma.identity_documents.findMany({
      where: { profile_id: profileId, is_active: true },
      select: { id: true },
    });
    if (documents.length === 0) return { granted: 0 };

    for (const document of documents) {
      await prisma.identity_document_shares.upsert({
        where: {
          identity_document_id_hostel_id: {
            identity_document_id: document.id,
            hostel_id: hostelId,
          },
        },
        create: {
          identity_document_id: document.id,
          hostel_id: hostelId,
          tenant_id: tenantId ?? null,
        },
        update: {
          revoked_at: null,
          tenant_id: tenantId ?? undefined,
          updated_at: new Date(),
        },
      });
    }

    return { granted: documents.length };
  }

  /**
   * End a hostel's access. The row survives with `revoked_at` set rather than
   * being deleted, so who verified what stays answerable afterwards.
   */
  async revokeFromHostel(profileId: string, hostelId: string) {
    const result = await prisma.identity_document_shares.updateMany({
      where: {
        hostel_id: hostelId,
        revoked_at: null,
        document: { profile_id: profileId },
      },
      data: { revoked_at: new Date(), updated_at: new Date() },
    });
    return { revoked: result.count };
  }

  // ── Owner side ─────────────────────────────────────────────────────────────

  /**
   * What one hostel may see of a person's documents.
   *
   * Scoped by `hostelId` **and** by ownership of that hostel, both checked
   * here rather than trusted from the caller — this is the boundary that stops
   * one hostel reading another's KYC.
   */
  async listForHostel(ownerId: string, hostelId: string, profileId?: string) {
    await this.assertOwnsHostel(ownerId, hostelId);

    const shares = await prisma.identity_document_shares.findMany({
      where: {
        hostel_id: hostelId,
        revoked_at: null,
        document: { is_active: true, ...(profileId ? { profile_id: profileId } : {}) },
      },
      orderBy: { granted_at: "desc" },
      select: {
        id: true,
        status: true,
        verified_at: true,
        rejected_at: true,
        rejection_reason: true,
        tenant_id: true,
        document: {
          select: {
            ...DOCUMENT_SELECT,
            profile: { select: { id: true, name: true } },
          },
        },
      },
    });

    return shares.map((share: any) => ({
      share_id: share.id,
      status: share.status as ShareStatus,
      verified_at: share.verified_at,
      rejected_at: share.rejected_at,
      rejection_reason: share.rejection_reason,
      tenant_id: share.tenant_id,
      document: share.document,
    }));
  }

  async setShareVerdict(
    ownerId: string,
    shareId: string,
    verdict: "VERIFIED" | "REJECTED",
    rejectionReason?: string | null,
  ) {
    const share = await prisma.identity_document_shares.findUnique({
      where: { id: shareId },
      select: {
        id: true,
        revoked_at: true,
        hostel_id: true,
        document: { select: { is_active: true, doc_type: true, profile_id: true } },
      },
    });
    if (!share) throw ApiError.notFound("Document not found");

    await this.assertOwnsHostel(ownerId, share.hostel_id);

    if (share.revoked_at) throw ApiError.forbidden("This document is no longer shared with your hostel");
    if (!share.document.is_active) {
      throw new ApiError("This document has been replaced by a newer upload", 409, "CONFLICT");
    }
    if (verdict === "REJECTED" && !rejectionReason?.trim()) {
      // A rejection with no reason just makes the tenant re-upload the same
      // thing — the same rule `owner_documents.review_note` already follows.
      throw ApiError.validationError("Give a reason so the tenant knows what to fix");
    }

    const now = new Date();
    return prisma.identity_document_shares.update({
      where: { id: shareId },
      data:
        verdict === "VERIFIED"
          ? {
              status: "VERIFIED",
              verified_by: ownerId,
              verified_at: now,
              rejected_by: null,
              rejected_at: null,
              rejection_reason: null,
              updated_at: now,
            }
          : {
              status: "REJECTED",
              rejected_by: ownerId,
              rejected_at: now,
              rejection_reason: rejectionReason!.trim(),
              verified_by: null,
              verified_at: null,
              updated_at: now,
            },
      select: { id: true, status: true, verified_at: true, rejected_at: true, rejection_reason: true },
    });
  }

  private async assertOwnsHostel(ownerId: string, hostelId: string) {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: ownerId },
      select: { id: true },
    });
    if (!hostel) throw ApiError.forbidden("You do not manage this hostel");
  }
}

export const documentVaultService = new DocumentVaultService();
