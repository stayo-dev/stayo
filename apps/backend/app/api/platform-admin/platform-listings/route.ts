export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getOrCreatePlatformOwnerProfile } from "@/src/services/marketing/platform-owner";

function requireAdmin(session: any): asserts session is { sub: string; role: string } {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

const CreateSchema = z.object({
  name: z.string().trim().min(2).max(120),
  city: z.string().trim().min(1).max(80),
  address: z.string().trim().min(4).max(400),
  phone: z.string().trim().min(6).max(20),
  hostel_type: z.enum(["BOYS", "GIRLS", "CO_LIVING", "WORKING_PROS"]).default("CO_LIVING"),
});

function slugify(name: string, city: string) {
  const base = `${name}-${city}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Suffixed so two hostels with the same name in one city cannot collide on
  // the unique slug and fail the insert.
  return `${base}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * GET /api/platform-admin/platform-listings
 *
 * Hostels Stayo listed itself and nobody has claimed. Includes the enquiry
 * count, which is the whole point: demand on an unclaimed listing is the
 * argument for approaching that owner.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);

    const hostels = await prisma.hostels.findMany({
      where: { listing_source: "PLATFORM_LISTED", claimed_at: null },
      select: {
        id: true, name: true, city: true, address: true, public_slug: true,
        listing_status: true, verification_status: true, created_at: true,
      },
      orderBy: { created_at: "desc" },
      take: 200,
    });

    const ids = hostels.map((h: any) => h.id);
    const enquiries = ids.length
      ? await prisma.leads.groupBy({
          by: ["hostel_id"],
          where: { hostel_id: { in: ids } },
          _count: { _all: true },
        })
      : [];
    const countByHostel = new Map(enquiries.map((e: any) => [e.hostel_id, e._count._all]));

    return apiResponse({
      listings: hostels.map((h: any) => ({ ...h, enquiry_count: countByHostel.get(h.id) ?? 0 })),
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to list platform listings");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * POST /api/platform-admin/platform-listings
 *
 * Creates the hostel shell for a Stayo-authored listing. Marketing content is
 * then authored through the same editor owners use — this only creates
 * something for that content to belong to.
 *
 * The row is owned by a sentinel "Stayo Platform" profile rather than having a
 * null owner, so no owner-scoped query in the codebase has to learn that a
 * hostel might have nobody. See migration 068.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const parsed = CreateSchema.safeParse(await req.json());
    if (!parsed.success) {
      return apiError(parsed.error.issues[0]?.message ?? "Invalid listing", "VALIDATION_ERROR", 400);
    }
    const { name, city, address, phone, hostel_type } = parsed.data;

    const platformOwnerId = await getOrCreatePlatformOwnerProfile();

    const hostel = await prisma.hostels.create({
      data: {
        owner_id: platformOwnerId,
        listing_source: "PLATFORM_LISTED",
        name,
        city,
        address,
        phone,
        hostel_type,
        public_slug: slugify(name, city),
        // Not discoverable on creation. It becomes visible only once its
        // marketing revision is approved, exactly like an owner's listing —
        // creating a listing is not publishing one.
        listing_status: "DRAFT",
        verification_status: "PENDING",
      },
      select: { id: true, name: true, city: true, public_slug: true },
    });

    return apiResponse({ hostel });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create platform listing");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
