export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import crypto from "crypto";
import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { requireAdminOrManagerPermission } from "@/src/services/managers/manager-authorization";
import { prisma } from "@/lib/db";
import { PlatformLeadStatus, PlatformLeadAcquisitionSource } from "@prisma/client";

const VALID_STATUSES: string[] = Object.values(PlatformLeadStatus);
const VALID_SOURCES: string[] = Object.values(PlatformLeadAcquisitionSource);

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * GET /api/platform-admin/leads?search=&status=&limit=&offset=
 *
 * Prospective hostel-owner leads (distinct from the tenant-admissions
 * `leads` table — see docs/obsidian/Database.md).
 *
 * Paginated, and returns `total` plus a per-status breakdown. Previously this
 * was a bare `take: 200` with no total and no next page: at ~100 leads a day
 * that silently truncated after two days, with nothing on screen to say so.
 * The counts also let the filter chips show the shape of the backlog without
 * one request per status.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_LEADS");
    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const status = searchParams.get("status") || undefined;
    if (status && !VALID_STATUSES.includes(status)) {
      return apiError(`status must be one of ${VALID_STATUSES.join(", ")}`, "VALIDATION_ERROR", 400);
    }
    // Lets the Admin Owners page show a "Pending onboarding" panel of
    // DIRECT_ADMIN leads without a second endpoint — see Admin -> Add Owner.
    const source = searchParams.get("source") || undefined;
    if (source && !VALID_SOURCES.includes(source)) {
      return apiError(`source must be one of ${VALID_SOURCES.join(", ")}`, "VALIDATION_ERROR", 400);
    }

    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(searchParams.get("limit")) || DEFAULT_LIMIT));
    const offset = Math.max(0, Number(searchParams.get("offset")) || 0);

    // Search applies to the counts too, otherwise the chips would advertise
    // statuses that the current search has no results for.
    const searchWhere = search
      ? {
          OR: [
            { name: { contains: search, mode: "insensitive" as const } },
            { hostel_name: { contains: search, mode: "insensitive" as const } },
            { city: { contains: search, mode: "insensitive" as const } },
            { phone: { contains: search } },
          ],
        }
      : {};

    const where = {
      ...(status ? { status: status as PlatformLeadStatus } : {}),
      ...(source ? { acquisition_source: source as PlatformLeadAcquisitionSource } : {}),
      ...searchWhere,
    };

    const [leads, total, grouped] = await Promise.all([
      prisma.platform_leads.findMany({
        where,
        orderBy: { created_at: "desc" },
        take: limit,
        skip: offset,
      }),
      prisma.platform_leads.count({ where }),
      // The status breakdown ignores the active `status` filter on purpose —
      // it's what draws the filter chips, which must show the full shape of
      // the backlog regardless of which chip is currently selected. `source`
      // is not the same kind of filter: a caller viewing only WEBSITE leads
      // (the normal Leads screen) wants chip counts scoped to WEBSITE too, or
      // "New leads: 12" would include Admin -> Add Owner leads it never lists.
      prisma.platform_leads.groupBy({
        by: ["status"],
        where: { ...searchWhere, ...(source ? { acquisition_source: source as PlatformLeadAcquisitionSource } : {}) },
        _count: { _all: true },
      }),
    ]);

    const counts: Record<string, number> = {};
    for (const value of VALID_STATUSES) counts[value] = 0;
    for (const row of grouped as Array<{ status: string; _count: { _all: number } }>) {
      counts[row.status] = row._count._all;
    }

    // A lead's own `city`/`bed_count`/`qual_beds` are a snapshot from
    // signup/qualification — before the owner had a real hostel to describe.
    // Once a lead has converted (`converted_owner_id` set), the owner's
    // actual hostel is the more current answer. This is returned as
    // separate `display_city`/`display_beds` fields, not merged into
    // `city`/`qual_beds` themselves: `qual_beds` in particular is a
    // two-way field the admin edits on a qualification call
    // (LeadDrawerBody's QUAL_FIELDS form initializes its draft straight
    // from this response and posts it back) — writing a derived hostel
    // number into it would risk that derived number being saved back as
    // if the admin had recorded it on a call. Only the read-only list
    // table consumes the `display_*` fields.
    const convertedOwnerIds: string[] = Array.from(
      new Set(leads.map((l: any) => l.converted_owner_id).filter((id: any): id is string => !!id)),
    );
    const ownerHostelInfo = new Map<string, { city: string | null; beds: number }>();
    // A converted lead's avatar can show the owner's actual profile picture
    // once one exists — stored on `profile_identity.photo_url`, never on
    // `profile` or on an `owner_documents` row (see
    // app/api/owner/me/photo/route.ts).
    const ownerPhotoById = new Map<string, string>();
    if (convertedOwnerIds.length > 0) {
      const hostels = await prisma.hostels.findMany({
        where: { owner_id: { in: convertedOwnerIds } },
        select: { id: true, owner_id: true, city: true },
      });
      const hostelIds = hostels.map((h: { id: string }) => h.id);
      const capacitySums = hostelIds.length > 0
        ? await prisma.rooms.groupBy({
            by: ["hostel_id"],
            where: { hostel_id: { in: hostelIds }, is_active: true },
            _sum: { capacity: true },
          })
        : [];
      const capacityByHostel = new Map<string, number>(
        capacitySums.map((r: any) => [r.hostel_id as string, Number(r._sum.capacity ?? 0)]),
      );
      for (const h of hostels) {
        const existing = ownerHostelInfo.get(h.owner_id);
        const beds = capacityByHostel.get(h.id) ?? 0;
        // One owner can hold several hostels; take the first with a city and
        // sum beds across all of them, rather than picking one arbitrarily.
        ownerHostelInfo.set(h.owner_id, {
          city: existing?.city ?? h.city,
          beds: (existing?.beds ?? 0) + beds,
        });
      }

      const identities = await prisma.profile_identity.findMany({
        where: { profile_id: { in: convertedOwnerIds }, photo_url: { not: null } },
        select: { profile_id: true, photo_url: true },
      });
      for (const i of identities) {
        if (i.photo_url) ownerPhotoById.set(i.profile_id, i.photo_url);
      }
    }

    const enrichedLeads = leads.map((l: any) => {
      const ownerInfo = l.converted_owner_id ? ownerHostelInfo.get(l.converted_owner_id) : undefined;
      return {
        ...l,
        // Display-only, read by the leads-list table alone. Raw fields
        // (`city`, `qual_beds`, `bed_count`) are returned exactly as stored.
        display_city: l.city ?? ownerInfo?.city ?? null,
        display_beds: l.qual_beds ?? l.bed_count ?? ownerInfo?.beds ?? null,
        display_photo_url: l.converted_owner_id ? ownerPhotoById.get(l.converted_owner_id) ?? null : null,
      };
    });

    return apiResponse({
      leads: enrichedLeads,
      total,
      limit,
      offset,
      has_more: offset + leads.length < total,
      counts,
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to fetch leads");
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}

/**
 * POST /api/platform-admin/leads
 * Body: { name, hostelName, phone, city?, bedCount?, notes? }
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_LEADS");
    const body = await req.json().catch(() => ({}));
    const { name, hostelName, phone, city, bedCount, notes } = body;

    if (!name?.trim()) return apiError("name is required", "VALIDATION_ERROR", 400);
    if (!hostelName?.trim()) return apiError("hostelName is required", "VALIDATION_ERROR", 400);
    if (!phone?.trim()) return apiError("phone is required", "VALIDATION_ERROR", 400);

    const trimmedPhone = phone.trim();
    // A partial unique index (migration 078) enforces one active lead per
    // phone at the DB level; this pre-check exists so an admin re-adding a
    // known number gets a clear message instead of a raw unique-constraint
    // error out of the catch block below.
    const existingLead = await prisma.platform_leads.findFirst({
      where: { phone: trimmedPhone, status: { not: "LOST" } },
      orderBy: { created_at: "desc" },
    });
    if (existingLead) {
      return apiError(
        `A lead with this phone number already exists (id ${existingLead.id}, status ${existingLead.status})`,
        "DUPLICATE_PHONE",
        409,
      );
    }

    const lead = await prisma.platform_leads.create({
      data: {
        name: name.trim(),
        hostel_name: hostelName.trim(),
        phone: trimmedPhone,
        city: city?.trim() || null,
        bed_count: bedCount ? Number(bedCount) : null,
        notes: notes?.trim() || null,
        tracking_token: crypto.randomBytes(32).toString("hex"),
      },
    });

    return apiResponse(lead, 201);
  } catch (error: any) {
    const msg = String(error?.message || "Failed to create lead");
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
