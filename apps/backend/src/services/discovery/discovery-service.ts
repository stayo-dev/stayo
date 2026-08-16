import { createHash } from "crypto";

import { prisma } from "@/lib/db";
import { projectListing } from "./listing-projection";
import { ApiError } from "@/src/lib/api-error";
import { redisKeys } from "@/lib/redis/keys";
import { getOrSetJson, invalidateTag } from "@/lib/redis/cache";
import { admissionsService, ACTIVE_LEAD_STATUSES } from "@/src/services/admissions/admissions-service";
import { notificationService } from "@/lib/services/notification-service";
import { marketingPageService } from "@/src/services/marketing/marketing-page-service";

/**
 * Stayo Discover — the public marketplace surface.
 *
 * Two rules shape everything in this file.
 *
 * **1. One visibility predicate.** `DISCOVERABLE` below is the only definition
 * of "appears in Discover", and search and detail both use it. Duplicating it
 * is the specific failure mode where an admin suspends a hostel, it vanishes
 * from search, and stays reachable by direct URL forever.
 *
 * **2. Never write listing state.** ADR-040 makes `listing_status` and
 * `verification_status` admin-controlled precisely so an owner cannot
 * self-approve past platform verification. Nothing in discovery writes them,
 * and `tests/discovery-service.test.ts` asserts it.
 *
 * Detail composes `admissionsService.getPublicHostel()` rather than re-querying
 * rooms and vacancy. That function already encodes the correct availability
 * math — capacity minus active allocations minus active room reservations minus
 * active invitation reservations — and a second implementation is how two
 * surfaces silently drift apart. Note it deliberately gates only on
 * `status = ACTIVE` + `admissions_enabled`, because `/visit/:slug` is a
 * direct-link surface with intentionally looser rules; discovery layers its own
 * predicate on top rather than tightening that one.
 */

/** @see the file header — the single source of truth for discovery visibility. */
export const DISCOVERABLE = {
  status: "ACTIVE" as const,
  listing_status: "LIVE" as const,
  verification_status: "VERIFIED" as const,
  admissions_enabled: true,
  public_slug: { not: null },
};

/**
 * Availability and price are computed from room rows, not stored, so they
 * cannot be expressed as a SQL WHERE. Rather than paginate in SQL and then
 * post-filter a page (which silently returns short pages), discovery fetches
 * the whole matching set up to this cap, computes, sorts and paginates in
 * memory. Correct and simple at the scale this product operates at; if the
 * listed-hostel count ever approaches this number, the aggregate belongs in a
 * materialised column, not a bigger cap.
 */
const MAX_CANDIDATES = 500;

const SEARCH_CACHE_SECONDS = 60;

export type DiscoverSort = "recommended" | "price_low" | "newest";

export interface DiscoverSearchParams {
  q?: string;
  city?: string;
  minPrice?: number;
  maxPrice?: number;
  /** Room capacities, e.g. [2, 4] for "2-bed or 4-bed". */
  sharing?: number[];
  hostelType?: string;
  foodIncluded?: boolean;
  hasVacancy?: boolean;
  sort?: DiscoverSort;
  limit?: number;
  offset?: number;
}

/** Photos are a Json column that has held both an array and a `{urls:[…]}` shape. */
function asPhotoArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
  if (value && typeof value === "object" && Array.isArray((value as any).urls)) {
    return (value as any).urls.filter((item: unknown): item is string => typeof item === "string");
  }
  return [];
}

/** The room shape the summary math needs — mirrors getPublicHostel's sibling query. */
const SUMMARY_ROOM_SELECT = {
  where: { is_active: true },
  select: {
    capacity: true,
    base_rent: true,
    room_allocations: {
      where: { is_active: true, end_date: null, tenant: { status: "ACTIVE" as const } },
      select: { id: true },
    },
    room_reservations: {
      where: { status: "ACTIVE", reserved_until: { gt: new Date() } },
      select: { id: true },
    },
    tenant_invitation_reservations: {
      where: { status: "ACTIVE", expires_at: { gt: new Date() } },
      select: { id: true },
    },
  },
};

function summariseRooms(rooms: any[]) {
  let vacantBeds = 0;
  let startingPrice: number | null = null;
  const sharingSet = new Set<number>();

  for (const room of rooms) {
    const occupied = room.room_allocations.length;
    const reserved = room.room_reservations.length + room.tenant_invitation_reservations.length;
    const available = Math.max(0, Number(room.capacity || 0) - occupied - reserved);
    vacantBeds += available;

    if (room.capacity) sharingSet.add(Number(room.capacity));


    const rent = Number(room.base_rent || 0);
    // A room with no rent set is not free — it is unpriced, and quoting ₹0 as
    // "from" would be a lie on the card.
    if (rent > 0 && (startingPrice === null || rent < startingPrice)) startingPrice = rent;
  }

  return {
    vacant_beds: vacantBeds,
    starting_price: startingPrice,
    sharing: Array.from(sharingSet).sort((a, b) => a - b),
  };
}

export interface DiscoverCard {
  id: string;
  slug: string | null;
  name: string;
  city: string | null;
  address: string;
  hostel_type: string | null;
  food_included: boolean;
  verified: boolean;
  photos: string[];
  listed_at: Date;
  vacant_beds: number;
  starting_price: number | null;
  sharing: number[];
}

function toCard(hostel: any): DiscoverCard {
  return {
    id: hostel.id,
    slug: hostel.public_slug,
    name: hostel.name,
    city: hostel.city,
    address: hostel.address,
    hostel_type: hostel.hostel_type,
    food_included: hostel.food_included,
    verified: hostel.verification_status === "VERIFIED",
    photos: asPhotoArray(hostel.admission_photos),
    listed_at: hostel.created_at,
    ...summariseRooms(hostel.rooms || []),
  };
}

/**
 * The seeker's stay preferences ride in `notes` rather than in new columns.
 * Phase A deliberately adds one column to `visitor_leads`, not five: move-in
 * date and duration are read by a human in the owner's inbox, not queried, and
 * a structured shape can be lifted out later once phase C knows what a bed
 * booking actually looks like.
 */
function buildEnquiryNote(input: {
  roomCapacity?: number;
  moveInDate?: string;
  durationMonths?: number;
  message?: string;
}) {
  const parts: string[] = [];
  if (input.roomCapacity) parts.push(`Wants a ${input.roomCapacity}-bed room`);
  if (input.moveInDate) parts.push(`Move-in ${input.moveInDate}`);
  if (input.durationMonths) parts.push(`Staying ~${input.durationMonths} months`);
  const header = parts.join(" · ");
  const message = (input.message ?? "").trim().slice(0, 1000);
  return [header, message].filter(Boolean).join("\n") || null;
}

const ENQUIRY_SELECT = {
  id: true,
  status: true,
  notes: true,
  created_at: true,
  last_activity_at: true,
  converted_tenant_id: true,
  hostel: {
    select: {
      id: true,
      name: true,
      public_slug: true,
      city: true,
      address: true,
      admission_photos: true,
    },
  },
} as const;

/**
 * The seeker sees a three-step story — sent → owner reviewing → decision —
 * projected from `visitor_leads.status`. It is a *view* of that column, not a
 * second state machine: the owner keeps driving the same funnel they always
 * have, and nothing here writes status.
 */
function toEnquiryStage(status: string): "SENT" | "REVIEWING" | "ACCEPTED" | "CLOSED" {
  if (status === "JOINED" || status === "INVITED") return "ACCEPTED";
  if (status === "LOST") return "CLOSED";
  if (status === "NEW") return "SENT";
  return "REVIEWING";
}

function toEnquiry(lead: any) {
  return {
    id: lead.id,
    stage: toEnquiryStage(lead.status),
    // The raw funnel status is deliberately not exposed: "DECISION_PENDING" is
    // the owner's internal vocabulary, and showing it to the applicant invites
    // them to read meaning into a label that was never written for them.
    notes: lead.notes,
    created_at: lead.created_at,
    last_activity_at: lead.last_activity_at,
    hostel: {
      id: lead.hostel.id,
      name: lead.hostel.name,
      slug: lead.hostel.public_slug,
      city: lead.hostel.city,
      address: lead.hostel.address,
      photos: asPhotoArray(lead.hostel.admission_photos),
    },
  };
}

export class DiscoveryService {
  /**
   * Search is cached briefly and keyed by the full parameter set. 60s rather
   * than getPublicHostel's 180s: a bed filling up should drop the hostel out
   * of a "has vacancy" search quickly, and this response is cheap to rebuild.
   */
  async search(params: DiscoverSearchParams) {
    const limit = Math.min(Math.max(params.limit ?? 12, 1), 50);
    const offset = Math.max(params.offset ?? 0, 0);
    const sort: DiscoverSort = params.sort ?? "recommended";

    // Hashed rather than embedded raw: a free-text `q` would otherwise put
    // arbitrary user input (spaces, colons, unbounded length) straight into a
    // Redis key.
    const cacheKey = redisKeys.discovery.search(
      createHash("sha1")
        .update(JSON.stringify({ ...params, limit, offset, sort }))
        .digest("hex"),
    );

    return getOrSetJson(cacheKey, SEARCH_CACHE_SECONDS, async () => {
      const where: any = { ...DISCOVERABLE };

      if (params.city) where.city = { equals: params.city, mode: "insensitive" };
      if (params.hostelType) where.hostel_type = params.hostelType;
      if (params.foodIncluded) where.food_included = true;

      if (params.q) {
        const q = params.q.trim();
        if (q) {
          where.OR = [
            { name: { contains: q, mode: "insensitive" } },
            { address: { contains: q, mode: "insensitive" } },
            { city: { contains: q, mode: "insensitive" } },
          ];
        }
      }

      // Room-derived filters that CAN be pushed into SQL. `some` is the right
      // quantifier: a hostel qualifies if any active room matches, which is
      // what "has 2-bed rooms" and "has something under ₹6,000" both mean.
      const roomSome: any = { is_active: true };
      let needsRoomFilter = false;
      if (params.sharing?.length) {
        roomSome.capacity = { in: params.sharing };
        needsRoomFilter = true;
      }
      if (params.minPrice != null || params.maxPrice != null) {
        roomSome.base_rent = {
          ...(params.minPrice != null ? { gte: params.minPrice } : {}),
          ...(params.maxPrice != null ? { lte: params.maxPrice } : {}),
        };
        needsRoomFilter = true;
      }
      if (needsRoomFilter) where.rooms = { some: roomSome };

      const hostels = await prisma.hostels.findMany({
        where,
        take: MAX_CANDIDATES,
        select: {
          id: true,
          public_slug: true,
          name: true,
          city: true,
          address: true,
          hostel_type: true,
          food_included: true,
          verification_status: true,
          admission_photos: true,
          created_at: true,
          rooms: SUMMARY_ROOM_SELECT,
        },
      });

      let cards = hostels.map(toCard);

      // Vacancy is the one filter that cannot be a WHERE — it is capacity minus
      // three live relations, computed above.
      if (params.hasVacancy) cards = cards.filter((card: DiscoverCard) => card.vacant_beds > 0);

      cards.sort((a: DiscoverCard, b: DiscoverCard) => {
        if (sort === "price_low") {
          // Unpriced hostels sort last rather than first, which is what a
          // null-as-zero comparison would have done.
          const ap = a.starting_price ?? Number.POSITIVE_INFINITY;
          const bp = b.starting_price ?? Number.POSITIVE_INFINITY;
          if (ap !== bp) return ap - bp;
        }
        if (sort === "newest") {
          return new Date(b.listed_at).getTime() - new Date(a.listed_at).getTime();
        }
        // recommended: somewhere to actually move into, first.
        if (b.vacant_beds !== a.vacant_beds) return b.vacant_beds - a.vacant_beds;
        return new Date(b.listed_at).getTime() - new Date(a.listed_at).getTime();
      });

      // Facets describe the result set before pagination, so the count next to
      // a city is the number a visitor would actually get by picking it.
      const cityFacets = new Map<string, number>();
      for (const card of cards) {
        if (!card.city) continue;
        cityFacets.set(card.city, (cityFacets.get(card.city) ?? 0) + 1);
      }

      return {
        total: cards.length,
        limit,
        offset,
        results: cards.slice(offset, offset + limit),
        facets: {
          cities: Array.from(cityFacets.entries())
            .map(([city, count]) => ({ city, count }))
            .sort((a, b) => b.count - a.count),
        },
      };
    });
  }

  /**
   * Listing detail. The visibility check runs against the hostel row directly
   * rather than trusting `getPublicHostel`, whose gate is deliberately looser
   * (see the file header) — a SUSPENDED hostel must 404 here even though its
   * `/visit/:slug` page may still resolve.
   */
  async getListing(slug: string) {
    const visible = await prisma.hostels.findFirst({
      // DISCOVERABLE first: it carries its own `public_slug: { not: null }`,
      // which would otherwise spread *over* the slug being looked up and match
      // any listed hostel at all.
      where: { ...DISCOVERABLE, public_slug: slug },
      // hostel_type and food_included are read here rather than added to
      // getPublicHostel's payload: that response serves `/visit/:slug`, and
      // widening a shared contract for one consumer is how it stops being a
      // contract. Discovery merges what it needs on top instead.
      // listing_source is REQUIRED here: without it projectListing defaults to
      // OWNER_MANAGED and a platform listing would claim confirmed
      // availability it cannot honour.
      select: { id: true, hostel_type: true, food_included: true, listing_source: true },
    });
    if (!visible) throw ApiError.notFound("This hostel is not listed on Stayo");

    const [detail, marketing] = await Promise.all([
      admissionsService.getPublicHostel(slug),
      // Only ever the APPROVED revision. A draft or a submission awaiting
      // review is invisible here by construction — there is no code path from
      // owner-authored content to a public page that skips the admin.
      marketingPageService.getPublishedContent(visible.id),
    ]);

    // One projection, shared with the admin preview — see listing-projection.ts
    // for why this must not be duplicated.
    return projectListing({ detail, visible, marketing });
  }

  // ── Saved ──────────────────────────────────────────────────────────────────

  async listSaved(profileId: string) {
    const rows = await prisma.saved_hostels.findMany({
      where: { profile_id: profileId, hostel: DISCOVERABLE },
      orderBy: { created_at: "desc" },
      select: {
        created_at: true,
        hostel: {
          select: {
            id: true,
            public_slug: true,
            name: true,
            city: true,
            address: true,
            hostel_type: true,
            food_included: true,
            verification_status: true,
            admission_photos: true,
            created_at: true,
            rooms: SUMMARY_ROOM_SELECT,
          },
        },
      },
    });

    return rows.map((row: any) => ({ ...toCard(row.hostel), saved_at: row.created_at }));
  }

  async save(profileId: string, hostelId: string) {
    const hostel = await prisma.hostels.findFirst({
      where: { id: hostelId, ...DISCOVERABLE },
      select: { id: true },
    });
    if (!hostel) throw ApiError.notFound("This hostel is not listed on Stayo");

    // Idempotent: a double tap on the heart is one save, not a 500.
    await prisma.saved_hostels.upsert({
      where: { profile_id_hostel_id: { profile_id: profileId, hostel_id: hostelId } },
      create: { profile_id: profileId, hostel_id: hostelId },
      update: {},
    });

    return { saved: true };
  }

  async unsave(profileId: string, hostelId: string) {
    await prisma.saved_hostels.deleteMany({
      where: { profile_id: profileId, hostel_id: hostelId },
    });
    return { saved: false };
  }

  // ── Enquiries ──────────────────────────────────────────────────────────────

  /**
   * An enquiry **is** a `visitor_leads` row — the same table, funnel, scoring
   * and owner inbox that QR and walk-in leads already use. No parallel entity,
   * because the owner must not have two places to look.
   *
   * The only new column is `seeker_profile_id`, which is what lets the sender
   * see their own enquiries later.
   */
  async createEnquiry(
    seeker: { id: string; name: string; email: string; phone: string | null },
    input: { slug: string; roomCapacity?: number; moveInDate?: string; durationMonths?: number; message?: string },
  ) {
    const hostel = await prisma.hostels.findFirst({
      // Spread first — see getListing for why the order matters.
      where: { ...DISCOVERABLE, public_slug: input.slug },
      select: { id: true, owner_id: true, name: true },
    });
    if (!hostel) throw ApiError.notFound("This hostel is not listed on Stayo");

    // Re-enquiring to the same hostel updates the open lead rather than
    // stacking duplicates in the owner's inbox — matching what
    // admissionsService.createLead does for the public microsite.
    const existing = await prisma.visitorLead.findFirst({
      where: {
        hostel_id: hostel.id,
        seeker_profile_id: seeker.id,
        status: { in: [...ACTIVE_LEAD_STATUSES] },
      },
      orderBy: { created_at: "desc" },
    });

    const notes = buildEnquiryNote(input);

    const lead = existing
      ? await prisma.visitorLead.update({
          where: { id: existing.id },
          data: {
            student_name: seeker.name,
            student_email: seeker.email,
            student_phone: seeker.phone ?? existing.student_phone,
            notes,
            last_activity_at: new Date(),
            updated_at: new Date(),
          },
        })
      : await prisma.visitorLead.create({
          data: {
            hostel_id: hostel.id,
            owner_id: hostel.owner_id,
            seeker_profile_id: seeker.id,
            student_name: seeker.name,
            student_email: seeker.email,
            student_phone: seeker.phone,
            decision_maker_type: "STUDENT",
            source: "DISCOVER",
            notes,
            assigned_to: "Stayo Discover",
          },
        });

    // REQUEST_JOIN carries real weight in the lead score (30) — a verified
    // account asking for a specific bed is a stronger signal than a page view.
    await admissionsService.recordActivity(lead.id, "REQUEST_JOIN", {
      source: "discover",
      room_capacity: input.roomCapacity ?? null,
      move_in_date: input.moveInDate ?? null,
      duration_months: input.durationMonths ?? null,
    });

    await notificationService
      .createNotification(
        hostel.owner_id,
        "New enquiry from Stayo Discover",
        `${seeker.name} enquired about ${hostel.name}.`,
        "lead",
      )
      // A failed notification must not lose the lead — the row is already
      // committed and visible in the owner's inbox regardless.
      .catch(() => undefined);

    await invalidateTag(redisKeys.admissions.owner(hostel.owner_id));

    return this.getEnquiry(seeker.id, lead.id);
  }

  async listEnquiries(profileId: string) {
    const leads = await prisma.visitorLead.findMany({
      where: { seeker_profile_id: profileId },
      orderBy: { created_at: "desc" },
      take: 100,
      select: ENQUIRY_SELECT,
    });
    return leads.map(toEnquiry);
  }

  async getEnquiry(profileId: string, enquiryId: string) {
    const lead = await prisma.visitorLead.findFirst({
      // Scoped by seeker, not just id: an enquiry id must never be readable by
      // whoever guesses it.
      where: { id: enquiryId, seeker_profile_id: profileId },
      select: ENQUIRY_SELECT,
    });
    if (!lead) throw ApiError.notFound("Enquiry not found");
    return toEnquiry(lead);
  }
}

export const discoveryService = new DiscoveryService();
