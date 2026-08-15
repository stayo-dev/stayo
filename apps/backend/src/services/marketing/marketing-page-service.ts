import { prisma } from "@/lib/db";
import { ApiError } from "@/src/lib/api-error";
import {
  EMPTY_CONTENT,
  MarketingContentSchema,
  contentIssues,
  normaliseContent,
  type MarketingContent,
} from "./marketing-content";

/**
 * The hostel marketing page and its approval cycle.
 *
 * ── The state machine ──────────────────────────────────────────────────────
 *
 *   DRAFT ──submit──▶ PENDING_REVIEW ──approve──▶ APPROVED
 *     ▲                     │                        │
 *     └────── reject ───────┘            (previous APPROVED → SUPERSEDED)
 *
 * The APPROVED revision serves Discovery throughout. Editing an approved page
 * opens a **new** DRAFT rather than mutating it, so the live listing never
 * flickers while a change is in review and a rejection cannot take down a page
 * that was previously fine.
 *
 * ── Two independent gates ──────────────────────────────────────────────────
 *
 * This does **not** replace ADR-040. `hostels.listing_status` /
 * `verification_status` decide whether a hostel may appear in Discovery at
 * all; an approved marketing revision decides whether its content may be
 * shown. A listing needs both, and nothing here writes either of those
 * columns.
 */

export type RevisionStatus = "DRAFT" | "PENDING_REVIEW" | "APPROVED" | "REJECTED" | "SUPERSEDED";

/** Statuses an owner is still working on — at most one exists per hostel. */
const OPEN_STATUSES = ["DRAFT", "PENDING_REVIEW"];

const REVISION_SELECT = {
  id: true,
  hostel_id: true,
  version: true,
  status: true,
  content: true,
  submitted_at: true,
  reviewed_at: true,
  review_note: true,
  created_at: true,
  updated_at: true,
} as const;

export class MarketingPageService {
  private async assertOwnsHostel(ownerId: string, hostelId: string) {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, owner_id: ownerId },
      select: { id: true, name: true },
    });
    if (!hostel) throw ApiError.forbidden("You do not manage this hostel");
    return hostel;
  }

  /**
   * The owner's editing view: their open draft (created on demand), plus what
   * is currently live, so the editor can show "you have unpublished changes".
   */
  async getEditorState(ownerId: string, hostelId: string) {
    await this.assertOwnsHostel(ownerId, hostelId);

    const [open, approved] = await Promise.all([
      prisma.hostel_marketing_revisions.findFirst({
        where: { hostel_id: hostelId, status: { in: OPEN_STATUSES } },
        select: REVISION_SELECT,
      }),
      prisma.hostel_marketing_revisions.findFirst({
        where: { hostel_id: hostelId, status: "APPROVED" },
        select: REVISION_SELECT,
      }),
    ]);

    // With no open revision, the next draft is seeded from the owner's most
    // recent work — **whatever its status** — not from what happens to be
    // live. Seeding from `approved` would silently discard everything an owner
    // wrote in a revision that was just rejected, which is exactly the moment
    // they need it back to act on the reviewer's note.
    const latest = open
      ? null
      : await prisma.hostel_marketing_revisions.findFirst({
          where: { hostel_id: hostelId },
          orderBy: { version: "desc" },
          select: { version: true, status: true, content: true, review_note: true, reviewed_at: true },
        });

    const lastRejected =
      latest?.status === "REJECTED"
        ? { version: latest.version, review_note: latest.review_note, reviewed_at: latest.reviewed_at }
        : null;

    const draftContent = open
      ? normaliseContent(open.content)
      : latest
        ? normaliseContent(latest.content)
        : EMPTY_CONTENT;

    return {
      draft: open
        ? { ...open, content: draftContent, status: open.status as RevisionStatus }
        : { id: null, version: (approved?.version ?? 0) + 1, status: "DRAFT" as RevisionStatus, content: draftContent },
      published: approved ? { ...approved, content: normaliseContent(approved.content) } : null,
      last_rejection: lastRejected,
      issues: contentIssues(draftContent),
      /** False while a submission is in review — the editor locks rather than
          letting an owner change what a reviewer is currently reading. */
      is_editable: !open || open.status === "DRAFT",
    };
  }

  /**
   * Save the owner's work in progress.
   *
   * A revision already submitted is **not** editable: letting an owner change
   * it mid-review would mean the admin approves something other than what they
   * read. They withdraw it first (which returns it to DRAFT).
   */
  async saveDraft(ownerId: string, hostelId: string, rawContent: unknown) {
    await this.assertOwnsHostel(ownerId, hostelId);

    const parsed = MarketingContentSchema.safeParse(rawContent ?? {});
    if (!parsed.success) {
      throw ApiError.validationError(parsed.error.issues[0]?.message ?? "Check the listing details");
    }
    const content = normaliseContent(parsed.data);

    const open = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: hostelId, status: { in: OPEN_STATUSES } },
      select: { id: true, status: true },
    });

    if (open?.status === "PENDING_REVIEW") {
      throw new ApiError(
        "This listing is being reviewed. Withdraw it if you need to make changes.",
        409,
        "CONFLICT",
      );
    }

    if (open) {
      const updated = await prisma.hostel_marketing_revisions.update({
        where: { id: open.id },
        data: { content: content as any, updated_at: new Date() },
        select: REVISION_SELECT,
      });
      return { ...updated, content, issues: contentIssues(content) };
    }

    const created = await prisma.hostel_marketing_revisions.create({
      data: {
        hostel_id: hostelId,
        version: await this.nextVersion(hostelId),
        status: "DRAFT",
        content: content as any,
      },
      select: REVISION_SELECT,
    });
    return { ...created, content, issues: contentIssues(content) };
  }

  /** Hand the draft to the admin queue. */
  async submitForReview(ownerId: string, hostelId: string) {
    await this.assertOwnsHostel(ownerId, hostelId);

    const draft = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: hostelId, status: "DRAFT" },
      select: { id: true, content: true },
    });
    if (!draft) throw ApiError.notFound("There is nothing to submit");

    const content = normaliseContent(draft.content);
    const issues = contentIssues(content);
    if (issues.length > 0) {
      // Caught here rather than by the reviewer: sending an obviously
      // incomplete listing into a human queue wastes the reviewer's time and
      // the owner's, and the fix is entirely the owner's to make.
      throw new ApiError(issues[0], 400, "VALIDATION_ERROR", { issues });
    }

    return prisma.hostel_marketing_revisions.update({
      where: { id: draft.id },
      data: {
        status: "PENDING_REVIEW",
        submitted_at: new Date(),
        submitted_by: ownerId,
        // A resubmission clears the previous verdict — the note referred to a
        // version that no longer exists.
        review_note: null,
        reviewed_at: null,
        reviewed_by: null,
        updated_at: new Date(),
      },
      select: REVISION_SELECT,
    });
  }

  /** Pull a submission back out of the queue so it can be edited again. */
  async withdraw(ownerId: string, hostelId: string) {
    await this.assertOwnsHostel(ownerId, hostelId);

    const pending = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: hostelId, status: "PENDING_REVIEW" },
      select: { id: true },
    });
    if (!pending) throw ApiError.notFound("Nothing is awaiting review");

    return prisma.hostel_marketing_revisions.update({
      where: { id: pending.id },
      data: { status: "DRAFT", submitted_at: null, updated_at: new Date() },
      select: REVISION_SELECT,
    });
  }

  private async nextVersion(hostelId: string) {
    const latest = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: hostelId },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  }

  // ── Public read ────────────────────────────────────────────────────────────

  /**
   * The live content for a hostel, or null.
   *
   * Discovery calls this. It never throws on malformed content — see
   * `normaliseContent` — because a revision approved under an older shape must
   * degrade to "no details yet", not take down a public page.
   */
  async getPublishedContent(hostelId: string): Promise<MarketingContent | null> {
    const approved = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: hostelId, status: "APPROVED" },
      select: { content: true },
    });
    if (!approved) return null;
    return normaliseContent(approved.content);
  }
}

export const marketingPageService = new MarketingPageService();
