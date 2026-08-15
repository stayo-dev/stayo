import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    hostels: { findFirst: vi.fn() },
    rooms: { findMany: vi.fn() },
    hostel_marketing_revisions: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
  supabase: {},
}));

vi.mock("@/lib/services/notification-service", () => ({
  notificationService: { createNotification: vi.fn(async () => undefined) },
}));

import { prisma } from "@/lib/db";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";
import { marketingReviewService, buildReviewFlags } from "@/src/services/marketing/marketing-review-service";
import { normaliseContent, contentIssues, EMPTY_CONTENT } from "@/src/services/marketing/marketing-content";

const revisions = () => (prisma as any).hostel_marketing_revisions;
const hostels = () => (prisma as any).hostels;
const rooms = () => (prisma as any).rooms;

/** A listing complete enough to submit. */
function validContent(overrides: Record<string, unknown> = {}) {
  return normaliseContent({
    basics: { tagline: "Walk to campus", about: null, highlights: [] },
    photos: [{ url: "https://example.com/a.jpg", label: "front", is_cover: true, sort: 0 }],
    beds: [{ name: "4-Bed AC", sharing: 4, price: 6000, inclusions: null, availability: "BEDS_LEFT" }],
    amenities: [{ label: "Wi-Fi", enabled: true }],
    places: [{ name: "Osmania University", distance: "400 m", category: "COLLEGE", sort: 0 }],
    ...overrides,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  hostels().findFirst.mockResolvedValue({ id: "h1", name: "Sri Adithya" });
});

describe("content normalisation", () => {
  it("never publishes without exactly one cover photo", () => {
    // "No cover" and "three covers" are both broken states — Discovery's card
    // shows the cover first, so it must be unambiguous.
    const none = normaliseContent({ photos: [{ url: "https://e.com/a.jpg" }, { url: "https://e.com/b.jpg" }] });
    expect(none.photos.filter((p) => p.is_cover)).toHaveLength(1);

    const many = normaliseContent({
      photos: [
        { url: "https://e.com/a.jpg", is_cover: true },
        { url: "https://e.com/b.jpg", is_cover: true },
      ],
    });
    expect(many.photos.filter((p) => p.is_cover)).toHaveLength(1);
  });

  it("degrades unparseable content to empty rather than throwing", () => {
    // A revision approved under an older shape must not take down a public
    // page; it renders as "no details yet".
    expect(normaliseContent({ beds: "not-an-array" })).toEqual(EMPTY_CONTENT);
    expect(normaliseContent(null)).toEqual(EMPTY_CONTENT);
  });

  it("has no field for an owner to write a review", () => {
    // "Managed by Stayo" is a trust property, not a layout choice.
    const parsed = normaliseContent({ reviews: [{ stars: 5, text: "Great!" }] } as any);
    expect(parsed).not.toHaveProperty("reviews");
  });

  it("flags an incomplete listing before a human sees it", () => {
    const issues = contentIssues(normaliseContent({}));
    expect(issues.join(" ")).toMatch(/photo/i);
    expect(issues.join(" ")).toMatch(/bed type/i);
  });

  it("treats a ₹0 bed price as unpriced, not free", () => {
    const issues = contentIssues(validContent({ beds: [{ name: "Free?", sharing: 2, price: 0 }] }));
    expect(issues.join(" ")).toMatch(/₹0 price reads as free/i);
  });
});

describe("the owner's side of the cycle", () => {
  it("refuses to edit a hostel the caller does not own", async () => {
    hostels().findFirst.mockResolvedValueOnce(null);
    await expect(marketingPageService.saveDraft("owner-b", "h1", {})).rejects.toThrow(/do not manage/i);
  });

  it("will not let an owner edit what a reviewer is currently reading", async () => {
    revisions().findFirst.mockResolvedValueOnce({ id: "r1", status: "PENDING_REVIEW" });

    await expect(marketingPageService.saveDraft("owner-a", "h1", validContent())).rejects.toThrow(
      /being reviewed/i,
    );
    expect(revisions().update).not.toHaveBeenCalled();
  });

  it("blocks submission of an incomplete listing instead of queueing it", async () => {
    revisions().findFirst.mockResolvedValueOnce({ id: "r1", content: {} });

    await expect(marketingPageService.submitForReview("owner-a", "h1")).rejects.toThrow(/photo/i);
    expect(revisions().update).not.toHaveBeenCalled();
  });

  it("clears the previous verdict when resubmitting", async () => {
    revisions().findFirst.mockResolvedValueOnce({ id: "r1", content: validContent() });
    revisions().update.mockResolvedValueOnce({ id: "r1", status: "PENDING_REVIEW" });

    await marketingPageService.submitForReview("owner-a", "h1");

    const data = revisions().update.mock.calls[0][0].data;
    expect(data.status).toBe("PENDING_REVIEW");
    // The old note referred to a version that no longer exists.
    expect(data.review_note).toBeNull();
    expect(data.reviewed_at).toBeNull();
  });

  it("seeds a new draft from the owner's own rejected work, not from what is live", async () => {
    // Regression: seeding from the APPROVED revision silently discarded
    // everything an owner wrote in a revision that was just rejected — exactly
    // when they need it back to act on the reviewer's note.
    revisions().findFirst
      .mockResolvedValueOnce(null) // no open revision
      .mockResolvedValueOnce({ version: 2, content: validContent({ basics: { tagline: "LIVE", highlights: [] } }) })
      .mockResolvedValueOnce({
        version: 3,
        status: "REJECTED",
        content: validContent({ basics: { tagline: "MY REJECTED EDIT", highlights: [] } }),
        review_note: "Photos are too dark",
        reviewed_at: new Date(),
      });

    const state = await marketingPageService.getEditorState("owner-a", "h1");

    expect(state.draft.content.basics.tagline).toBe("MY REJECTED EDIT");
    expect(state.last_rejection?.review_note).toBe("Photos are too dark");
  });
});

describe("what the reviewer is shown", () => {
  it("catches a listing advertising less than the rooms actually cost", async () => {
    rooms().findMany.mockResolvedValueOnce([{ capacity: 4, base_rent: 6000 }]);

    const flags = await buildReviewFlags(
      "h1",
      validContent({ beds: [{ name: "4-Bed AC", sharing: 4, price: 4500 }] }),
    );

    expect(flags[0].code).toBe("PRICE_DRIFT");
    expect(flags[0].detail).toMatchObject({ advertised: 4500, actual: 6000, difference: 1500 });
  });

  it("tolerates a small difference rather than crying wolf on every listing", async () => {
    rooms().findMany.mockResolvedValueOnce([{ capacity: 4, base_rent: 6000 }]);

    const flags = await buildReviewFlags(
      "h1",
      validContent({ beds: [{ name: "4-Bed AC", sharing: 4, price: 5900 }] }),
    );
    expect(flags).toHaveLength(0);
  });

  it("catches a tier the hostel has no rooms for", async () => {
    rooms().findMany.mockResolvedValueOnce([{ capacity: 4, base_rent: 6000 }]);

    const flags = await buildReviewFlags(
      "h1",
      validContent({ beds: [{ name: "2-Bed Deluxe", sharing: 2, price: 9000 }] }),
    );
    expect(flags[0].code).toBe("SHARING_NOT_IN_INVENTORY");
  });

  it("says so plainly when a hostel has no rooms at all", async () => {
    rooms().findMany.mockResolvedValueOnce([]);
    const flags = await buildReviewFlags("h1", validContent());
    expect(flags).toEqual([{ code: "NO_ROOMS", message: expect.stringMatching(/no active rooms/i) }]);
  });
});

describe("approval", () => {
  it("retires the live revision and promotes the new one in one transaction", async () => {
    // The partial unique index allows one APPROVED per hostel, so a
    // non-transactional approve would leave the hostel with two or none.
    revisions().findUnique.mockResolvedValueOnce({
      id: "r2",
      status: "PENDING_REVIEW",
      hostel_id: "h1",
      version: 2,
      hostel: { owner_id: "owner-a", name: "Sri Adithya" },
    });
    revisions().updateMany.mockResolvedValue({ count: 1 });
    revisions().update.mockResolvedValue({ id: "r2", version: 2, status: "APPROVED" });

    await marketingReviewService.approve("admin-1", "r2");

    expect((prisma as any).$transaction).toHaveBeenCalled();
    expect(revisions().updateMany.mock.calls[0][0].data.status).toBe("SUPERSEDED");
  });

  it("refuses to approve something no longer awaiting review", async () => {
    revisions().findUnique.mockResolvedValueOnce({
      id: "r2",
      status: "APPROVED",
      hostel_id: "h1",
      hostel: { owner_id: "owner-a", name: "X" },
    });

    await expect(marketingReviewService.approve("admin-1", "r2")).rejects.toThrow(/no longer awaiting/i);
  });

  it("requires a reason to reject", async () => {
    await expect(marketingReviewService.reject("admin-1", "r2", "   ")).rejects.toThrow(/give a reason/i);
    expect(revisions().update).not.toHaveBeenCalled();
  });

  it("never writes listing_status or verification_status", async () => {
    // ADR-040's gate is separate and stays admin-console-only: approving
    // content must not silently make a hostel discoverable.
    revisions().findUnique.mockResolvedValueOnce({
      id: "r2",
      status: "PENDING_REVIEW",
      hostel_id: "h1",
      version: 2,
      hostel: { owner_id: "owner-a", name: "Sri Adithya" },
    });
    revisions().updateMany.mockResolvedValue({ count: 0 });
    revisions().update.mockResolvedValue({ id: "r2", version: 2, status: "APPROVED" });

    await marketingReviewService.approve("admin-1", "r2");

    expect(hostels().update).toBeUndefined();
    expect(hostels().updateMany).toBeUndefined();
  });
});

describe("what Discovery can reach", () => {
  it("only ever reads an APPROVED revision", async () => {
    revisions().findFirst.mockResolvedValueOnce(null);
    await marketingPageService.getPublishedContent("h1");

    // There is no code path from owner-authored content to a public page that
    // skips the admin.
    expect(revisions().findFirst.mock.calls[0][0].where.status).toBe("APPROVED");
  });

  it("returns null when nothing has ever been approved", async () => {
    revisions().findFirst.mockResolvedValueOnce(null);
    await expect(marketingPageService.getPublishedContent("h1")).resolves.toBeNull();
  });
});
