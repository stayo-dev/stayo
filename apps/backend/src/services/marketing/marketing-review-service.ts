import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";
import { notificationService } from "@/lib/services/notification-service";
import { normaliseReviewFlags, isSendBackActionable, summariseFlagsForOwner, type SectionFlag } from "./review-flags";
import { normaliseContent, type MarketingContent } from "./marketing-content";

/**
 * The platform-admin side of the marketing approval cycle.
 *
 * Approving is not a rubber stamp — Stayo's name is on every listing it lets
 * through — so the queue hands the reviewer the two things a human cannot
 * check by eye:
 *
 *   1. **Price drift.** The advertised price is owner-authored, while
 *      `rooms.base_rent` is what the hostel actually bills. A listing saying
 *      ₹4,500 over rooms priced at ₹6,000 is the single most damaging thing
 *      that can reach a tenant here, and it is invisible unless computed.
 *   2. **Sharing types that don't exist.** A tier advertising 2-bed rooms at a
 *      hostel with no 2-bed room is an offer that cannot be honoured.
 *
 * Neither blocks approval. They are surfaced, with numbers, for a human to
 * judge — an owner may legitimately advertise an introductory rate or a tier
 * they are about to build.
 */

export interface ReviewFlag {
  code: "PRICE_DRIFT" | "SHARING_NOT_IN_INVENTORY" | "NO_ROOMS";
  message: string;
  detail?: Record<string, unknown>;
}

/** Rooms as the reviewer needs them: what actually exists and what it costs. */
async function loadInventory(hostelId: string) {
  const rooms = await prisma.rooms.findMany({
    where: { hostel_id: hostelId, is_active: true },
    select: { capacity: true, base_rent: true },
  });

  const byCapacity = new Map<number, number[]>();
  for (const room of rooms) {
    const capacity = Number(room.capacity || 0);
    if (!capacity) continue;
    const rent = Number(room.base_rent || 0);
    const list = byCapacity.get(capacity) ?? [];
    if (rent > 0) list.push(rent);
    byCapacity.set(capacity, list);
  }
  return { roomCount: rooms.length, byCapacity };
}

/**
 * How far an advertised price may sit under the real rent before a reviewer is
 * told. Deliberately a ratio rather than a flat rupee amount — ₹500 off ₹4,000
 * is a different claim from ₹500 off ₹15,000.
 */
const DRIFT_TOLERANCE = 0.05;

export async function buildReviewFlags(hostelId: string, content: MarketingContent): Promise<ReviewFlag[]> {
  const flags: ReviewFlag[] = [];
  const { roomCount, byCapacity } = await loadInventory(hostelId);

  if (roomCount === 0) {
    flags.push({
      code: "NO_ROOMS",
      message: "This hostel has no active rooms, so nothing on this listing can actually be booked.",
    });
    return flags;
  }

  for (const bed of content.beds) {
    const rents = byCapacity.get(bed.sharing);

    if (!rents) {
      flags.push({
        code: "SHARING_NOT_IN_INVENTORY",
        message: `Advertises ${bed.sharing}-bed rooms, but this hostel has none.`,
        detail: { sharing: bed.sharing, tier: bed.name },
      });
      continue;
    }

    if (rents.length === 0) continue; // real rooms exist but are unpriced

    const cheapestReal = Math.min(...rents);
    if (bed.price > 0 && bed.price < cheapestReal * (1 - DRIFT_TOLERANCE)) {
      flags.push({
        code: "PRICE_DRIFT",
        message: `Advertises ₹${bed.price.toLocaleString("en-IN")}/mo for ${bed.name}, but the cheapest real ${bed.sharing}-bed room is ₹${cheapestReal.toLocaleString("en-IN")}.`,
        detail: { tier: bed.name, advertised: bed.price, actual: cheapestReal, difference: cheapestReal - bed.price },
      });
    }
  }

  return flags;
}

export class MarketingReviewService {
  /** Everything waiting on a human, oldest first — a queue, not a dashboard. */
  async listPending() {
    const pending = await prisma.hostel_marketing_revisions.findMany({
      where: { status: "PENDING_REVIEW" },
      orderBy: { submitted_at: "asc" },
      select: {
        id: true,
        version: true,
        submitted_at: true,
        content: true,
        hostel: {
          select: {
            id: true,
            name: true,
            city: true,
            listing_status: true,
            verification_status: true,
            owner_id: true,
          },
        },
      },
    });

    return Promise.all(
      pending.map(async (revision: any) => {
        const content = normaliseContent(revision.content);
        return {
          id: revision.id,
          version: revision.version,
          submitted_at: revision.submitted_at,
          hostel: revision.hostel,
          summary: {
            photos: content.photos.length,
            beds: content.beds.length,
            amenities: content.amenities.filter((amenity) => amenity.enabled).length,
            places: content.places.length,
            tagline: content.basics.tagline,
          },
          flags: await buildReviewFlags(revision.hostel.id, content),
        };
      }),
    );
  }

  /** One submission in full, with the currently-live version to diff against. */
  async getSubmission(revisionId: string) {
    const revision = await prisma.hostel_marketing_revisions.findUnique({
      where: { id: revisionId },
      select: {
        id: true,
        version: true,
        status: true,
        content: true,
        submitted_at: true,
        review_flags: true,
        hostel: {
          select: {
            id: true, name: true, city: true, address: true,
            listing_status: true, verification_status: true,
            listing_source: true,
          },
        },
      },
    });
    if (!revision) throw ApiError.notFound("Submission not found");

    const content = normaliseContent(revision.content);
    const live = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: revision.hostel.id, status: "APPROVED" },
      select: { version: true, content: true, reviewed_at: true },
    });

    return {
      ...revision,
      content,
      /** What Discovery is showing right now, so the reviewer sees the change. */
      live: live ? { version: live.version, reviewed_at: live.reviewed_at, content: normaliseContent(live.content) } : null,
      flags: await buildReviewFlags(revision.hostel.id, content),
    };
  }

  /**
   * Approve, and retire whatever was live.
   *
   * Both writes happen in one transaction: the partial unique index allows a
   * single APPROVED revision per hostel, so a non-transactional approve would
   * fail halfway and leave the hostel with either two live revisions or none.
   */
  async approve(adminId: string, revisionId: string, note?: string | null) {
    const revision = await prisma.hostel_marketing_revisions.findUnique({
      where: { id: revisionId },
      select: { id: true, status: true, hostel_id: true, version: true, hostel: { select: { owner_id: true, name: true } } },
    });
    if (!revision) throw ApiError.notFound("Submission not found");
    if (revision.status !== "PENDING_REVIEW") {
      throw new ApiError("This submission is no longer awaiting review", 409, "CONFLICT");
    }

    const now = new Date();
    const [, approved] = await prisma.$transaction([
      prisma.hostel_marketing_revisions.updateMany({
        where: { hostel_id: revision.hostel_id, status: "APPROVED" },
        data: { status: "SUPERSEDED", updated_at: now },
      }),
      prisma.hostel_marketing_revisions.update({
        where: { id: revisionId },
        data: {
          status: "APPROVED",
          reviewed_at: now,
          reviewed_by: adminId,
          review_note: note?.trim() || null,
          updated_at: now,
        },
        select: { id: true, version: true, status: true },
      }),
    ]);

    await notificationService
      .createNotification(
        revision.hostel.owner_id,
        "Your listing is live",
        `The Discovery listing for ${revision.hostel.name} was approved and is now visible to tenants.`,
        "marketing",
      )
      .catch(() => undefined);

    return approved;
  }

  /**
   * Send back, with feedback the owner can act on.
   *
   * Accepts per-section flags as well as the covering note. Either is enough
   * on its own — a flagged section IS an instruction ("this part") — but
   * neither is not: a bare "no" just produces a resubmission of the same page,
   * which is what ADR-076 set out to prevent.
   */
  async reject(adminId: string, revisionId: string, note: string, rawFlags?: unknown) {
    const flags: SectionFlag[] = normaliseReviewFlags(rawFlags, adminId);
    if (!isSendBackActionable(flags, note)) {
      throw ApiError.validationError(
        "Flag at least one section or give a reason — the owner sees this and acts on it",
      );
    }

    const revision = await prisma.hostel_marketing_revisions.findUnique({
      where: { id: revisionId },
      select: { id: true, status: true, hostel: { select: { owner_id: true, name: true } } },
    });
    if (!revision) throw ApiError.notFound("Submission not found");
    if (revision.status !== "PENDING_REVIEW") {
      throw new ApiError("This submission is no longer awaiting review", 409, "CONFLICT");
    }

    const rejected = await prisma.hostel_marketing_revisions.update({
      where: { id: revisionId },
      data: {
        status: "REJECTED",
        reviewed_at: new Date(),
        reviewed_by: adminId,
        review_note: note?.trim() || null,
        review_flags: flags as any,
        updated_at: new Date(),
      },
      select: { id: true, version: true, status: true, review_note: true, review_flags: true },
    });

    await notificationService
      .createNotification(
        revision.hostel.owner_id,
        "Your listing needs changes",
        // Name the sections, so the notification itself says what to fix
        // rather than "something needs changing, go and look".
        [revision.hostel.name, summariseFlagsForOwner(flags) || note?.trim()]
          .filter(Boolean)
          .join(": "),
        "marketing",
      )
      .catch(() => undefined);

    return rejected;
  }
}

export const marketingReviewService = new MarketingReviewService();
