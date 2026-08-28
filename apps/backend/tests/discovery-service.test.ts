import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  prisma: {
    hostels: { findFirst: vi.fn(), findMany: vi.fn() },
    visitorLead: { findFirst: vi.fn(), create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
    saved_hostels: { findMany: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
    // `findMany` backs fillCoverPhotos, which every card-projection path runs
    // through. Defaulted to [] rather than a bare vi.fn() so a test that does
    // not care about photos does not have to stub it; vi.clearAllMocks() keeps
    // implementations, so this default survives between tests.
    hostel_marketing_revisions: { findFirst: vi.fn(), findMany: vi.fn(async () => []) },
    profile: { findUnique: vi.fn() },
    rooms: { findFirst: vi.fn() },
    floors: { findFirst: vi.fn() },
  },
  supabase: {},
}));

// The cache must not swallow the query under test — run the producer every time.
vi.mock("@/lib/redis/cache", () => ({
  getOrSetJson: vi.fn(async (_key: string, _ttl: number, producer: () => Promise<unknown>) => producer()),
  invalidateTag: vi.fn(async () => undefined),
}));

vi.mock("@/src/services/admissions/admissions-service", () => ({
  ACTIVE_LEAD_STATUSES: ["NEW", "INTERESTED", "ROOM_VISITED", "DECISION_PENDING", "READY_TO_JOIN", "INVITED"],
  admissionsService: {
    getPublicHostel: vi.fn(async () => ({
      hostel: { id: "h1", public_slug: "sri-adithya", name: "Sri Adithya", photos: [], starting_price: 4500 },
      rooms: [],
    })),
    recordActivity: vi.fn(async () => undefined),
  },
}));

vi.mock("@/lib/services/notification-service", () => ({
  notificationService: { createNotification: vi.fn(async () => undefined) },
}));

// `whatsapp-template-delivery` constructs a MetaWhatsAppProvider at module
// scope, which throws WhatsAppConfigError when WHATSAPP_ACCESS_TOKEN is absent.
// Importing discovery-service therefore blew up before a single test ran, and
// this whole file has been silently failing at import rather than executing.
vi.mock("@/lib/services/notifications/whatsapp-template-delivery", () => ({
  whatsAppTemplateDeliveryService: { sendTemplate: vi.fn(async () => ({ ok: true })) },
}));

import { prisma } from "@/lib/db";
import { discoveryService, DISCOVERABLE } from "@/src/services/discovery/discovery-service";
import { admissionsService } from "@/src/services/admissions/admissions-service";

const hostels = () => (prisma as any).hostels;
const leads = () => (prisma as any).visitorLead;
const rooms = () => (prisma as any).rooms;
const floors = () => (prisma as any).floors;

/** A hostel row shaped the way the search projection selects it. */
function hostelRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "h1",
    public_slug: "sri-adithya",
    name: "Sri Adithya",
    city: "Hyderabad",
    address: "Adikmet",
    hostel_type: "BOYS",
    food_included: true,
    verification_status: "VERIFIED",
    admission_photos: [],
    created_at: new Date("2026-01-01"),
    rooms: [],
    ...overrides,
  };
}

function room(capacity: number, baseRent: number | null, occupied = 0, reserved = 0) {
  return {
    capacity,
    base_rent: baseRent,
    room_allocations: Array.from({ length: occupied }, (_, i) => ({ id: `a${i}` })),
    room_reservations: Array.from({ length: reserved }, (_, i) => ({ id: `r${i}` })),
    tenant_invitation_reservations: [],
  };
}

beforeEach(() => vi.clearAllMocks());

describe("discovery visibility", () => {
  it("only ever asks for LIVE + VERIFIED + ACTIVE hostels that accept admissions", () => {
    // The predicate is the security boundary — assert its shape directly so a
    // future edit that drops a clause fails here rather than in production.
    expect(DISCOVERABLE).toEqual({
      status: "ACTIVE",
      listing_status: "LIVE",
      verification_status: "VERIFIED",
      admissions_enabled: true,
      public_slug: { not: null },
    });
  });

  it("applies the predicate to search", async () => {
    hostels().findMany.mockResolvedValueOnce([]);
    await discoveryService.search({});

    const where = hostels().findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      status: "ACTIVE",
      listing_status: "LIVE",
      verification_status: "VERIFIED",
      admissions_enabled: true,
    });
  });

  it("404s a listing that is not discoverable, without falling back to the admissions payload", async () => {
    hostels().findFirst.mockResolvedValueOnce(null);

    await expect(discoveryService.getListing("suspended-hostel")).rejects.toThrow(
      /not listed on Stayo/i,
    );
    // The suspended hostel's /visit page may still resolve; discovery must not
    // reach for it as a consolation.
    expect(admissionsService.getPublicHostel).not.toHaveBeenCalled();
  });

  it("looks up the requested slug, not merely any discoverable hostel", async () => {
    // Regression: `{ public_slug: slug, ...DISCOVERABLE }` let DISCOVERABLE's
    // own `public_slug: { not: null }` overwrite the slug, so every request
    // matched the first listed hostel.
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", hostel_type: "BOYS", food_included: true });
    // No approved marketing revision — the listing must still render.
    (prisma as any).hostel_marketing_revisions.findFirst.mockResolvedValueOnce(null);

    await discoveryService.getListing("sri-adithya");

    expect(hostels().findFirst.mock.calls[0][0].where.public_slug).toBe("sri-adithya");
  });

  it("never writes listing or verification status (ADR-040)", async () => {
    hostels().findMany.mockResolvedValueOnce([]);
    await discoveryService.search({});

    // The service exposes no write path at all for these columns.
    expect(hostels().update).toBeUndefined();
    expect(hostels().updateMany).toBeUndefined();
  });
});

describe("the published mess menu", () => {
  /** A discoverable hostel whose approved revision carries `mess`. */
  function listingWithMess(mess: unknown) {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", hostel_type: "BOYS", food_included: true });
    (prisma as any).hostel_marketing_revisions.findFirst.mockResolvedValueOnce({
      content: { mess },
    });
  }

  it("publishes the reviewed weekly menu on the listing", async () => {
    listingWithMess({
      provided: true,
      type: "BOTH",
      week: [{ b: "Idli · Sambar" }],
    });

    const listing: any = await discoveryService.getListing("sri-adithya");

    expect(listing.mess.type).toBe("BOTH");
    expect(listing.mess.week).toHaveLength(7);
    expect(listing.mess.week[0].b).toBe("Idli · Sambar");
  });

  it("sends null when the hostel does not provide meals", async () => {
    // The section hides outright rather than rendering "Food & mess" with
    // nothing under it — that reads as missing data, not as no mess.
    listingWithMess({ provided: false, week: [{ b: "leftover draft text" }] });

    const listing: any = await discoveryService.getListing("sri-adithya");

    expect(listing.mess).toBeNull();
  });

  it("drops meals the owner switched off", async () => {
    // A listing must never advertise a meal slot the owner does not serve.
    listingWithMess({
      provided: true,
      meals: [
        { key: "b", label: "Breakfast", time: "7:30 – 9:00 AM", enabled: true },
        { key: "s", label: "Snacks", time: "5:00 – 6:00 PM", enabled: false },
      ],
    });

    const listing: any = await discoveryService.getListing("sri-adithya");

    expect(listing.mess.meals.map((meal: any) => meal.key)).toEqual(["b", "l", "dn"]);
  });

  it("sends null for a hostel that has never published a listing", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", hostel_type: "BOYS", food_included: true });
    (prisma as any).hostel_marketing_revisions.findFirst.mockResolvedValueOnce(null);

    const listing: any = await discoveryService.getListing("sri-adithya");

    expect(listing.mess).toBeNull();
  });
});

describe("card projection", () => {
  it("treats an unpriced room as unpriced, not free", async () => {
    hostels().findMany.mockResolvedValueOnce([hostelRow({ rooms: [room(4, null), room(2, 6000)] })]);

    const result = await discoveryService.search({});
    expect(result.results[0].starting_price).toBe(6000);
  });

  it("reports no price at all when nothing is priced", async () => {
    hostels().findMany.mockResolvedValueOnce([hostelRow({ rooms: [room(4, null), room(2, 0)] })]);

    const result = await discoveryService.search({});
    expect(result.results[0].starting_price).toBeNull();
  });

  it("counts vacancy as capacity minus allocations minus reservations", async () => {
    hostels().findMany.mockResolvedValueOnce([
      hostelRow({ rooms: [room(4, 5000, 2, 1), room(2, 6000, 0, 0)] }),
    ]);

    const result = await discoveryService.search({});
    expect(result.results[0].vacant_beds).toBe(3); // (4-2-1) + (2-0-0)
  });

  it("never reports negative vacancy when a room is over-allocated", async () => {
    hostels().findMany.mockResolvedValueOnce([hostelRow({ rooms: [room(2, 5000, 3, 1)] })]);

    const result = await discoveryService.search({});
    expect(result.results[0].vacant_beds).toBe(0);
  });

  it("filters out full hostels only when vacancy is asked for", async () => {
    hostels().findMany.mockResolvedValue([hostelRow({ rooms: [room(2, 5000, 2)] })]);

    await expect(discoveryService.search({})).resolves.toMatchObject({ total: 1 });
    await expect(discoveryService.search({ hasVacancy: true })).resolves.toMatchObject({ total: 0 });
  });

  it("sorts unpriced hostels last by price, not first", async () => {
    hostels().findMany.mockResolvedValueOnce([
      hostelRow({ id: "unpriced", public_slug: "a", rooms: [room(2, null)] }),
      hostelRow({ id: "cheap", public_slug: "b", rooms: [room(2, 3000)] }),
    ]);

    const result = await discoveryService.search({ sort: "price_low" });
    expect(result.results.map((card) => card.id)).toEqual(["cheap", "unpriced"]);
  });
});

describe("enquiries", () => {
  const seeker = { id: "p1", name: "Asha R", email: "asha@example.com", phone: "919000000000" };

  it("creates a lead attributed to the seeker and sourced to Discover", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", name: "Sri Adithya" });
    leads().findFirst
      .mockResolvedValueOnce(null) // no open lead
      .mockResolvedValueOnce({
        id: "l1",
        status: "NEW",
        notes: null,
        created_at: new Date(),
        last_activity_at: new Date(),
        hostel: { id: "h1", name: "Sri Adithya", public_slug: "sri-adithya", city: "Hyderabad", address: "Adikmet", admission_photos: [] },
      });
    leads().create.mockResolvedValueOnce({ id: "l1" });

    await discoveryService.createEnquiry(seeker, { slug: "sri-adithya", roomCapacity: 4 });

    expect(leads().create.mock.calls[0][0].data).toMatchObject({
      hostel_id: "h1",
      owner_id: "o1",
      seeker_profile_id: "p1",
      source: "DISCOVER",
    });
  });

  it("updates the open lead instead of stacking a duplicate in the owner's inbox", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", name: "Sri Adithya" });
    leads().findFirst
      .mockResolvedValueOnce({ id: "existing", student_phone: "919000000000", student_email: null, notes: null })
      .mockResolvedValueOnce({
        id: "existing",
        status: "INTERESTED",
        notes: null,
        created_at: new Date(),
        last_activity_at: new Date(),
        hostel: { id: "h1", name: "Sri Adithya", public_slug: "sri-adithya", city: "Hyderabad", address: "Adikmet", admission_photos: [] },
      });
    leads().update.mockResolvedValueOnce({ id: "existing" });

    await discoveryService.createEnquiry(seeker, { slug: "sri-adithya" });

    expect(leads().create).not.toHaveBeenCalled();
    expect(leads().update).toHaveBeenCalled();
  });

  it("refuses to enquire to a hostel that is not discoverable", async () => {
    hostels().findFirst.mockResolvedValueOnce(null);

    await expect(discoveryService.createEnquiry(seeker, { slug: "suspended" })).rejects.toThrow(
      /not listed on Stayo/i,
    );
    expect(leads().create).not.toHaveBeenCalled();
  });

  // The owner's whole reason for receiving a lead is being able to call back, so
  // a phone-less lead is worse than no lead. `EnquiryPage` already gates this,
  // but a request made outside that screen reached `visitor_leads` directly.
  it("refuses an enquiry from a seeker with no phone on file", async () => {
    const phoneless = { ...seeker, phone: null };

    await expect(discoveryService.createEnquiry(phoneless, { slug: "sri-adithya" })).rejects.toThrow(
      /mobile number/i,
    );
    expect(leads().create).not.toHaveBeenCalled();
    expect(leads().update).not.toHaveBeenCalled();
  });

  it("refuses before touching the database, so no hostel lookup is spent on it", async () => {
    const phoneless = { ...seeker, phone: null };

    await expect(discoveryService.createEnquiry(phoneless, { slug: "sri-adithya" })).rejects.toThrow();
    expect(hostels().findFirst).not.toHaveBeenCalled();
  });

  // ADR-034: WhatsApp can be undeliverable, in which case the UI deliberately
  // lets signup through with a SKIPPED row. Gating on `phone_verified` here
  // would break that path, so the rule is "a number is on file", not "a code
  // was entered".
  it("accepts a seeker whose number is on file but was never OTP-verified", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", name: "Sri Adithya" });
    leads().findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({
        id: "l1",
        status: "NEW",
        notes: null,
        created_at: new Date(),
        last_activity_at: new Date(),
        hostel: { id: "h1", name: "Sri Adithya", public_slug: "sri-adithya", city: "Hyderabad", address: "Adikmet", admission_photos: [] },
      });
    leads().create.mockResolvedValueOnce({ id: "l1" });

    await discoveryService.createEnquiry(
      { ...seeker, phone: "919000000000" },
      { slug: "sri-adithya" },
    );

    expect(leads().create).toHaveBeenCalled();
    expect(leads().create.mock.calls[0][0].data.student_phone).toBe("919000000000");
  });

  it("scopes a single enquiry read to its own seeker", async () => {
    leads().findFirst.mockResolvedValueOnce(null);

    await expect(discoveryService.getEnquiry("p1", "someone-elses-id")).rejects.toThrow(/not found/i);
    expect(leads().findFirst.mock.calls[0][0].where).toEqual({
      id: "someone-elses-id",
      seeker_profile_id: "p1",
    });
  });

  it("shows the seeker a stage, never the owner's internal funnel status", async () => {
    leads().findMany.mockResolvedValueOnce([
      {
        id: "l1",
        status: "DECISION_PENDING",
        notes: null,
        created_at: new Date(),
        last_activity_at: new Date(),
        hostel: { id: "h1", name: "Sri Adithya", public_slug: "s", city: "Hyderabad", address: "A", admission_photos: [] },
      },
    ]);

    const [enquiry] = await discoveryService.listEnquiries("p1");
    expect(enquiry.stage).toBe("REVIEWING");
    expect(enquiry).not.toHaveProperty("status");
  });
});

describe("enquiry room preference", () => {
  const seeker = { id: "p1", name: "Asha R", email: "asha@example.com", phone: "919000000000" };

  function stubHostelAndLeadLookups() {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", name: "Sri Adithya" });
    leads().findFirst
      .mockResolvedValueOnce(null) // no open lead
      .mockResolvedValueOnce({
        id: "l1",
        status: "NEW",
        notes: null,
        created_at: new Date(),
        last_activity_at: new Date(),
        hostel: { id: "h1", name: "Sri Adithya", public_slug: "sri-adithya", city: "Hyderabad", address: "Adikmet", admission_photos: [] },
      });
    leads().create.mockResolvedValueOnce({ id: "l1" });
  }

  it("stores a specific preferred room, deriving the floor from the room itself", async () => {
    stubHostelAndLeadLookups();
    rooms().findFirst.mockResolvedValueOnce({ id: "room-1", floor_id: "floor-1" });

    await discoveryService.createEnquiry(seeker, { slug: "sri-adithya", preferredRoomId: "room-1" });

    expect(rooms().findFirst.mock.calls[0][0].where).toMatchObject({ id: "room-1", hostel_id: "h1", is_active: true });
    expect(leads().create.mock.calls[0][0].data).toMatchObject({
      preferred_room_id: "room-1",
      preferred_floor_id: "floor-1",
    });
  });

  it("stores a floor-only preference with no room chosen", async () => {
    stubHostelAndLeadLookups();
    floors().findFirst.mockResolvedValueOnce({ id: "floor-1" });

    await discoveryService.createEnquiry(seeker, { slug: "sri-adithya", preferredFloorId: "floor-1" });

    expect(leads().create.mock.calls[0][0].data).toMatchObject({
      preferred_floor_id: "floor-1",
      preferred_room_id: null,
    });
  });

  it("writes no preference at all when none was sent", async () => {
    stubHostelAndLeadLookups();

    await discoveryService.createEnquiry(seeker, { slug: "sri-adithya" });

    expect(leads().create.mock.calls[0][0].data).toMatchObject({
      preferred_floor_id: null,
      preferred_room_id: null,
    });
  });

  it("rejects a preferred room that belongs to a different hostel", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", name: "Sri Adithya" });
    // Scoped to this hostel in the query itself, so a room from elsewhere
    // simply doesn't match.
    rooms().findFirst.mockResolvedValueOnce(null);

    await expect(
      discoveryService.createEnquiry(seeker, { slug: "sri-adithya", preferredRoomId: "someone-elses-room" }),
    ).rejects.toThrow(/isn't part of this hostel/i);
    expect(leads().create).not.toHaveBeenCalled();
    expect(leads().update).not.toHaveBeenCalled();
  });

  it("rejects a preferred floor that belongs to a different hostel", async () => {
    hostels().findFirst.mockResolvedValueOnce({ id: "h1", owner_id: "o1", name: "Sri Adithya" });
    floors().findFirst.mockResolvedValueOnce(null);

    await expect(
      discoveryService.createEnquiry(seeker, { slug: "sri-adithya", preferredFloorId: "someone-elses-floor" }),
    ).rejects.toThrow(/isn't part of this hostel/i);
    expect(leads().create).not.toHaveBeenCalled();
  });
});
