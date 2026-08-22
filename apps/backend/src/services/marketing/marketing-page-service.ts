import { prisma } from "@/lib/db";
import { imagekit } from "@/lib/imagekit";
import { actorId, marketingScopeWhere, type MarketingActor } from "./marketing-scope";
import { mealsServed, scheduleToMessWeek } from "./mess-import";
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

/**
 * Listing photo limits. Larger than the 2MB hostel-logo cap because these are
 * full-bleed gallery images straight off a phone camera, and rejecting a normal
 * photo teaches owners to stop uploading rather than to compress.
 */
const ALLOWED_PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp"];
/**
 * Video, alongside photos. `quicktime` is here because that is what an iPhone
 * hands over when someone picks a clip from their camera roll — refusing it
 * would reject the single most likely video an owner uploads.
 */
const ALLOWED_VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
/**
 * Videos are allowed to be much bigger than photos, but not unbounded: this
 * request is buffered in memory by the function that receives it, and a phone
 * on Indian mobile data uploading 200MB is a failed upload with a spinner.
 */
const MAX_VIDEO_BYTES = 60 * 1024 * 1024;
/**
 * **One file per request is what the client sends** (see `PhotosScreen`), so
 * this is a ceiling on abuse rather than the normal path. It used to be the
 * batch size, and a phone multi-select of ten 4MB photos became a single
 * ~40MB request that the platform rejected before any of this code ran — the
 * owner saw "limit exceeded" while every individual file was well inside the
 * limit.
 */
const MAX_PHOTOS_PER_UPLOAD = 10;

/**
 * ImageKit's video-to-still transform. `so-1` seeks one second in — frame zero
 * of a phone video is very often a blur or a black frame while the sensor
 * settles.
 */
export function videoThumbnailUrl(videoUrl: string): string {
  const separator = videoUrl.includes("?") ? "&" : "?";
  return `${videoUrl}${separator}tr=so-1`;
}

/** Just enough of a schedule's 28 rows to rebuild a week. */
const MEAL_SELECT = {
  select: { day_of_week: true, meal_type: true, item_name: true },
} as const;

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
  /**
   * `ownerId` may be an owner (scoped to their own hostels) or an admin
   * (unscoped). Stayo's team authors listings on an owner's behalf, so the
   * editor must open for hostels the actor does not own — see marketing-scope.ts.
   */
  private async assertOwnsHostel(actor: string | MarketingActor, hostelId: string) {
    const resolved: MarketingActor = typeof actor === "string" ? { id: actor } : actor;
    const hostel = await prisma.hostels.findFirst({
      where: marketingScopeWhere(resolved, hostelId),
      select: { id: true, name: true, public_slug: true, owner_id: true },
    });
    if (!hostel) throw ApiError.forbidden("You do not manage this hostel");
    return hostel;
  }

  /**
   * The owner's editing view: their open draft (created on demand), plus what
   * is currently live, so the editor can show "you have unpublished changes".
   */
  async getEditorState(ownerId: string | MarketingActor, hostelId: string) {
    const hostel = await this.assertOwnsHostel(ownerId, hostelId);

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

    // WITHDRAWN as well as REJECTED: a listing an admin pulled down after it was
    // live is exactly when the owner most needs to see the reason, and reading
    // only REJECTED here would have left them with a blank listing and no
    // explanation anywhere in the product.
    const lastRejected =
      latest && ["REJECTED", "WITHDRAWN"].includes(String(latest.status))
        ? {
            version: latest.version,
            review_note: latest.review_note,
            reviewed_at: latest.reviewed_at,
            /** REJECTED = never went live. WITHDRAWN = was live and taken down. */
            status: latest.status,
          }
        : null;

    const draftContent = open
      ? normaliseContent(open.content)
      : latest
        ? normaliseContent(latest.content)
        : EMPTY_CONTENT;

    // The design's status card shows "1,240 views · 30d" beside "38
    // enquiries". Enquiries are real — every Discovery enquiry is a
    // `visitor_leads` row. **View tracking does not exist**, so `views` is
    // returned as null rather than as a plausible number, and the UI omits the
    // stat instead of printing one Stayo cannot stand behind.
    const enquiries = await prisma.visitorLead.count({
      where: {
        hostel_id: hostelId,
        source: "DISCOVER",
        created_at: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });

    return {
      hostel: { id: hostel.id, name: hostel.name, public_slug: hostel.public_slug },
      stats: { enquiries_30d: enquiries, views_30d: null as number | null },
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
  async saveDraft(ownerId: string | MarketingActor, hostelId: string, rawContent: unknown) {
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

  /**
   * Upload listing photos and hand back their URLs.
   *
   * This deliberately does **not** touch the revision. The URLs go into the
   * draft the owner is editing in the browser and are persisted by the next
   * `saveDraft` — writing them here too would give the page two sources of
   * truth for its photo list, and an upload followed by a discarded edit would
   * leave a photo on the listing the owner never accepted.
   *
   * Locked while a revision is in review, for the same reason `saveDraft` is:
   * an owner cannot change what a reviewer is currently reading.
   */
  /**
   * Takes an actor, not a bare owner id: an admin authoring a listing on an
   * owner's behalf (marketing-scope.ts) could open the editor and save text,
   * but every photo they uploaded was rejected as somebody else's hostel.
   */
  async uploadPhotos(ownerId: string | MarketingActor, hostelId: string, files: File[]) {
    await this.assertOwnsHostel(ownerId, hostelId);

    const open = await prisma.hostel_marketing_revisions.findFirst({
      where: { hostel_id: hostelId, status: { in: OPEN_STATUSES } },
      select: { status: true },
    });
    if (open?.status === "PENDING_REVIEW") {
      throw new ApiError(
        "This listing is being reviewed. Withdraw it if you need to make changes.",
        409,
        "CONFLICT",
      );
    }

    if (files.length === 0) throw ApiError.validationError("No photos were uploaded");
    if (files.length > MAX_PHOTOS_PER_UPLOAD) {
      throw ApiError.validationError(`Upload up to ${MAX_PHOTOS_PER_UPLOAD} photos at a time`);
    }

    for (const file of files) {
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
      if (!isVideo && !ALLOWED_PHOTO_TYPES.includes(file.type)) {
        throw ApiError.validationError(
          `${file.name || "That file"} is not a JPG, PNG or WebP image, or an MP4/WebM/MOV video`,
        );
      }
      // Per file, never summed. A limit that adds several files together
      // rejects a selection in which nothing is actually too big, and the
      // owner has no way to tell which file to remove.
      const limit = isVideo ? MAX_VIDEO_BYTES : MAX_PHOTO_BYTES;
      if (file.size > limit) {
        throw ApiError.validationError(
          `${file.name || "That file"} is larger than ${limit / (1024 * 1024)}MB`,
        );
      }
    }

    // Sequential rather than Promise.all: a hostel gallery is a handful of
    // large images, and firing ten multi-megabyte uploads at the provider at
    // once is how the whole batch fails together on a phone connection.
    const uploaded: {
      url: string;
      label: string | null;
      kind: "image" | "video";
      thumbnail_url: string | null;
    }[] = [];
    for (const file of files) {
      const isVideo = ALLOWED_VIDEO_TYPES.includes(file.type);
      const buffer = Buffer.from(await file.arrayBuffer());
      const response = await imagekit.files.upload({
        file: buffer.toString("base64"),
        fileName: `hostel_${hostelId}_listing_${Date.now()}_${uploaded.length}`,
        folder: "/hostel_listings",
        tags: ["listing", hostelId],
      });
      if (!response?.url) throw new Error("Photo provider did not return a URL");
      uploaded.push({
        url: response.url,
        label: null,
        kind: isVideo ? "video" : "image",
        // ImageKit renders a still from a video on demand; the card and the
        // share preview need one, because neither can play a clip.
        thumbnail_url: isVideo ? videoThumbnailUrl(response.url) : null,
      });
    }

    return { photos: uploaded };
  }

  /**
   * The hostel's real kitchen menu, shaped for the listing's mess block.
   *
   * Read-only and **not** saved here: it is handed to the editor, the owner
   * adjusts it, and it goes through the normal review cycle like any other
   * edit. The listing keeps its own reviewed copy of the menu (ADR-077) —
   * this only spares the owner retyping 28 cells they already maintain, which
   * is why most listings had no menu at all.
   *
   * Prefers the current month's schedule, falling back to the most recent
   * published one: on the 1st of a month, before that month's schedule is
   * generated, "there is no menu" would be wrong — last month's is what the
   * kitchen is still cooking.
   */
  async getKitchenMenu(actor: string | MarketingActor, hostelId: string) {
    await this.assertOwnsHostel(actor, hostelId);

    const startOfMonth = new Date();
    startOfMonth.setUTCDate(1);
    startOfMonth.setUTCHours(0, 0, 0, 0);

    const schedule =
      (await prisma.food_schedules.findFirst({
        where: { hostel_id: hostelId, status: "PUBLISHED", month: startOfMonth },
        select: { id: true, month: true, food_schedule_meals: MEAL_SELECT },
      })) ??
      (await prisma.food_schedules.findFirst({
        where: { hostel_id: hostelId, status: "PUBLISHED" },
        orderBy: { month: "desc" },
        select: { id: true, month: true, food_schedule_meals: MEAL_SELECT },
      }));

    if (!schedule) return { available: false as const, month: null, week: null, served: null };

    const meals = schedule.food_schedule_meals ?? [];
    return {
      available: true as const,
      month: schedule.month,
      week: scheduleToMessWeek(meals as any),
      served: mealsServed(meals as any),
    };
  }

  /** Hand the draft to the admin queue. */
  async submitForReview(ownerId: string | MarketingActor, hostelId: string) {
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
        // The id, never the actor object — this column is a uuid.
        submitted_by: actorId(ownerId),
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
  async withdraw(ownerId: string | MarketingActor, hostelId: string) {
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
