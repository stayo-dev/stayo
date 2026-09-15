import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/lib/services/event-log-service", () => ({ eventLog: { log: vi.fn(async () => undefined) } }));

import { loadHostStats, publicResidents, roundRating } from "@/src/services/host-profile/host-stats";
import { createHostProfileService, HostProfileError } from "@/src/services/host-profile/host-profile-service";

const NOW = new Date("2026-09-14T06:30:00.000Z");
const OWNER = { id: "o1", name: "  Shiva   Prakash ", created_at: new Date("2026-09-10T00:00:00.000Z") };

function missingTable() {
  return Object.assign(new Error("The table `public.owner_host_profiles` does not exist in the current database."), { code: "P2021" });
}

function makeDb({ row = null as any, owner = OWNER as any, photo = "https://ik.example/p.jpg" as string | null, missing = false } = {}) {
  let current = row;
  const db: any = {
    profile: {
      findFirst: vi.fn(async () => owner),
      findUnique: vi.fn(async () => ({ name: "Asha  Admin" })),
      update: vi.fn(async () => ({ id: "o1" })),
    },
    profile_identity: { findUnique: vi.fn(async () => (photo ? { photo_url: photo } : null)) },
    owner_host_profile: {
      findUnique: vi.fn(async () => {
        if (missing) throw missingTable();
        return current;
      }),
      upsert: vi.fn(async ({ create, update }: any) => {
        if (missing) throw missingTable();
        current = current ? { ...current, ...update } : { ...create };
        return { profile_id: "o1" };
      }),
    },
    hostel_reviews: { aggregate: vi.fn(async () => ({ _count: { _all: 36 }, _avg: { rating: 4.83 } })) },
    tenants: { findMany: vi.fn(async () => Array.from({ length: 243 }, (_, i) => ({ profile_id: `p${i}` }))) },
    owner_documents: { count: vi.fn(async () => 1) },
  };
  return db;
}

const log = { log: vi.fn(async () => undefined) };
const service = (db: any) => createHostProfileService({ db, log, now: () => NOW });

describe("host stats", () => {
  it("omits residents below five, keeps 5–9 exact, floors from ten", () => {
    expect(publicResidents(0)).toBeNull();
    expect(publicResidents(4)).toBeNull();
    expect(publicResidents(5)).toBe(5);
    expect(publicResidents(9)).toBe(9);
    expect(publicResidents(10)).toBe(10);
    expect(publicResidents(243)).toBe(240);
  });

  it("rounds the rating to one decimal and has none without reviews", () => {
    expect(roundRating(4.83, 36)).toBe(4.8);
    expect(roundRating(4.86, 2)).toBe(4.9);
    expect(roundRating(null, 0)).toBeNull();
    expect(roundRating(5, 0)).toBeNull();
  });

  it("counts only published reviews, real residents and verified ID on this owner's hostels", async () => {
    const db = makeDb();
    const stats = await loadHostStats(db, "o1");
    expect(stats).toEqual({ review_count: 36, rating: 4.8, residents: 240, verified: true });
    expect(db.hostel_reviews.aggregate.mock.calls[0][0].where).toEqual({ status: "PUBLISHED", hostel: { owner_id: "o1" } });
    const tenantQuery = db.tenants.findMany.mock.calls[0][0];
    // Scoped through the hostel, not `tenants.owner_id` — that column is
    // nullable, so older rows could otherwise drop out of the count.
    expect(tenantQuery.where).toEqual({
      hostels: { owner_id: "o1" }, status: { in: ["ACTIVE", "FORMER_TENANT"] }, profile_id: { not: null },
    });
    expect(tenantQuery.distinct).toEqual(["profile_id"]);
    expect(db.owner_documents.count.mock.calls[0][0].where).toEqual({
      profile_id: "o1", is_active: true, status: "VERIFIED", doc_type: { in: ["AADHAAR", "PAN"] },
    });
  });
});

describe("getPublicHost", () => {
  it("gives the full name, photo, words and earned stats", async () => {
    const db = makeDb({ row: { bio: "I started in 2015.", languages: ["Telugu", "Hindi"], hosting_since: 2015, bio_hidden: false, photo_hidden: false } });
    expect(await service(db).getPublicHost("o1")).toEqual({
      name: "Shiva Prakash",
      photo_url: "https://ik.example/p.jpg",
      bio: "I started in 2015.",
      languages: ["Telugu", "Hindi"],
      hosting_since: 2015,
      verified: true,
      listed_since: "2026-09-10T00:00:00.000Z",
      stats: { review_count: 36, rating: 4.8, residents: 240 },
    });
  });

  it("drops what an admin has hidden", async () => {
    const db = makeDb({ row: { bio: "Words", languages: [], hosting_since: null, bio_hidden: true, photo_hidden: true } });
    const host = await service(db).getPublicHost("o1");
    expect(host.bio).toBeNull();
    expect(host.photo_url).toBeNull();
    expect(host).not.toHaveProperty("bio_hidden");
  });

  it("reads a missing table as no bio rather than failing", async () => {
    const host = await service(makeDb({ missing: true })).getPublicHost("o1");
    expect(host.bio).toBeNull();
    expect(host.languages).toEqual([]);
    expect(host.name).toBe("Shiva Prakash");
  });

  it("404s for anyone who is not an owner", async () => {
    await expect(service(makeDb({ owner: null })).getPublicHost("x")).rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
  });
});

describe("getForOwner", () => {
  it("shows the owner their own hidden words, with the flags", async () => {
    const db = makeDb({ row: { bio: "Words", languages: [], hosting_since: null, bio_hidden: true, photo_hidden: false } });
    const host = await service(db).getForOwner("o1");
    expect(host.bio).toBe("Words");
    expect(host.bio_hidden).toBe(true);
    expect(host.photo_hidden).toBe(false);
  });
});

describe("updateByOwner", () => {
  it("saves the three owner fields, stamped with the owner", async () => {
    const db = makeDb();
    await service(db).updateByOwner("o1", { bio: " Hello ", languages: ["Telugu"], hosting_since: 2015 });
    const { create } = db.owner_host_profile.upsert.mock.calls[0][0];
    expect(create).toEqual({
      profile_id: "o1", bio: "Hello", languages: ["Telugu"], hosting_since: 2015, updated_by: "o1", updated_at: NOW,
    });
  });

  it("ignores hide flags an owner tries to send", async () => {
    const db = makeDb({ row: { bio: "Old", languages: [], hosting_since: null, bio_hidden: true, photo_hidden: true } });
    const host = await service(db).updateByOwner("o1", { bio: "New", languages: [], hosting_since: null, bio_hidden: false, photo_hidden: false });
    const { update } = db.owner_host_profile.upsert.mock.calls[0][0];
    expect(update).not.toHaveProperty("bio_hidden");
    expect(update).not.toHaveProperty("photo_hidden");
    expect(host.bio).toBe("New");
    expect(host.bio_hidden).toBe(true);
  });

  it("refuses contact details before writing anything", async () => {
    const db = makeDb();
    await expect(service(db).updateByOwner("o1", { bio: "Call 9876543210" })).rejects.toMatchObject({
      code: "VALIDATION_ERROR", status: 400, message: "Remove the phone number — residents reach you through Stayo.",
    });
    expect(db.owner_host_profile.upsert).not.toHaveBeenCalled();
  });

  it("says the feature is unavailable when the table is not there yet", async () => {
    await expect(service(makeDb({ missing: true })).updateByOwner("o1", { bio: "Hi" })).rejects.toMatchObject({
      code: "HOST_PROFILE_UNAVAILABLE", status: 503,
    });
  });
});

describe("updateByAdmin", () => {
  it("edits only what was sent, can hide, and records who", async () => {
    const db = makeDb({ row: { bio: "Words", languages: ["Telugu"], hosting_since: 2015, bio_hidden: false, photo_hidden: false } });
    const host = await service(db).updateByAdmin("o1", "admin-1", { bio_hidden: true });
    const { update } = db.owner_host_profile.upsert.mock.calls[0][0];
    expect(update).toEqual({ bio_hidden: true, updated_by: "admin-1", updated_at: NOW });
    expect(host.bio_hidden).toBe(true);
    expect(host.languages).toEqual(["Telugu"]);
    expect(host.updated_by_name).toBe("Asha Admin");
    expect(log.log).toHaveBeenCalledWith("OWNER_HOST_PROFILE_ADMIN_EDIT", "o1", { fields: ["bio_hidden"], admin_id: "admin-1" });
  });

  it("corrects the owner's account name", async () => {
    const db = makeDb();
    await service(db).updateByAdmin("o1", "admin-1", { name: "  Shiva  Prakash Reddy " });
    expect(db.profile.update).toHaveBeenCalledWith({
      where: { id: "o1" }, data: { name: "Shiva Prakash Reddy", updated_at: NOW }, select: { id: true },
    });
    expect(db.owner_host_profile.upsert).not.toHaveBeenCalled();
  });

  it("holds admins to the same bio rules", async () => {
    await expect(service(makeDb()).updateByAdmin("o1", "admin-1", { bio: "www.example.com" })).rejects.toMatchObject({ status: 400 });
  });

  it("refuses a non-boolean hide flag and an empty patch", async () => {
    await expect(service(makeDb()).updateByAdmin("o1", "a", { bio_hidden: "yes" })).rejects.toMatchObject({ status: 400 });
    await expect(service(makeDb()).updateByAdmin("o1", "a", {})).rejects.toMatchObject({ status: 400, message: "Nothing to update." });
  });

  it("404s for a profile that is not an owner", async () => {
    await expect(service(makeDb({ owner: null })).updateByAdmin("x", "a", { bio_hidden: true })).rejects.toBeInstanceOf(HostProfileError);
  });
});
