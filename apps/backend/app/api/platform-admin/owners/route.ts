export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { AdminAddOwnerSchema } from "@/lib/validators";
import { normalizeWhatsAppPhone } from "@/lib/services/notifications/providers/whatsapp";
import { resolveSignupPhoneVerification } from "@/lib/services/auth/signup-phone-verification-gate";
import { profilePhoneCandidates } from "@/lib/services/auth/auth-otp-service";
import { createPlatformLead } from "@/src/services/platform-leads/create-platform-lead";
import { requireAdminOrManagerPermission, scopeHostelIds } from "@/src/services/managers/manager-authorization";
import { PLATFORM_OWNER_EMAIL } from "@/src/services/marketing/platform-owner";

const REQUIRED_DOCS = ["AADHAAR", "PAN"];

/**
 * GET /api/platform-admin/owners?search=&limit=&offset=
 *
 * The platform's customers, one row each — the entity the admin actually
 * manages. `/platform-admin/hostels` lists properties, so an owner running
 * three hostels appears there as three unrelated rows with no way to see them
 * as one business.
 *
 * Returns **raw signals, not a verdict.** Health, at-risk reasons and
 * needs-attention bucketing are derived in one pure, tested frontend module
 * (`ownerHealth.ts`) so the rules live in one readable place and can be tested
 * without a database — the same split the owner-facing dashboard uses.
 *
 * Two signals are deliberately absent because nothing records them:
 * engagement (there is no last-login tracking anywhere) and support issues
 * (there is no ticketing backend). They are not approximated — a fabricated
 * "healthy" is worse than an honest gap.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_OWNERS");
    const restrictToHostelIds = await scopeHostelIds(session);

    const { searchParams } = new URL(req.url);
    const search = searchParams.get("search")?.trim();
    const limit = Math.min(Number(searchParams.get("limit") ?? 50), 100);
    const offset = Math.max(Number(searchParams.get("offset") ?? 0), 0);

    const where = {
      role: "OWNER" as const,
      // The sentinel "Stayo Platform" profile (platform-owner.ts) owns
      // PLATFORM_LISTED hostels until a real owner claims one — it satisfies
      // `role: OWNER` for the foreign key but is not an account anyone
      // manages, so it must never appear in the real owner roster.
      email: { not: PLATFORM_OWNER_EMAIL },
      // A manager only sees owners who run at least one hostel assigned to
      // them — resolved server-side from manager_hostel_assignments, never
      // trusted from the request.
      ...(restrictToHostelIds ? { hostels: { some: { id: { in: restrictToHostelIds } } } } : {}),
      ...(search
        ? {
            // City is matched through the owner's hostels: an admin searching
            // "Hyderabad" wants the owners operating there, and an owner's own
            // profile carries no city.
            OR: [
              { name: { contains: search, mode: "insensitive" as const } },
              { email: { contains: search, mode: "insensitive" as const } },
              { phone: { contains: search, mode: "insensitive" as const } },
              { hostels: { some: { city: { contains: search, mode: "insensitive" as const } } } },
              { hostels: { some: { name: { contains: search, mode: "insensitive" as const } } } },
            ],
          }
        : {}),
    };

    const [owners, total] = await Promise.all([
      prisma.profile.findMany({
        where,
        select: { id: true, name: true, email: true, phone: true, created_at: true, is_active: true },
        orderBy: { created_at: "desc" },
        skip: offset,
        take: limit,
      }),
      prisma.profile.count({ where }),
    ]);

    const ownerIds = owners.map((o: { id: string }) => o.id);
    if (ownerIds.length === 0) {
      return apiResponse({ owners: [], total, offset, has_more: false });
    }

    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    // Every hostel belonging to this page of owners, so per-hostel figures can
    // be rolled up without a second round trip per owner.
    const hostels = await prisma.hostels.findMany({
      where: { owner_id: { in: ownerIds } },
      select: { id: true, owner_id: true, name: true, city: true, listing_status: true, verification_status: true },
    });
    const hostelIds = hostels.map((h: { id: string }) => h.id);

    const [
      tenantCounts,
      activeTenantCounts,
      capacitySums,
      collectionSums,
      duesSums,
      documents,
      identities,
      subscriptions,
      lastActivity,
    ] = await Promise.all([
      prisma.tenants.groupBy({ by: ["owner_id"], where: { owner_id: { in: ownerIds } }, _count: { _all: true } }),
      prisma.tenants.groupBy({
        by: ["owner_id"],
        where: { owner_id: { in: ownerIds }, status: "ACTIVE" },
        _count: { _all: true },
      }),
      prisma.rooms.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, is_active: true },
        _sum: { capacity: true },
      }),
      prisma.payments.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, payment_date: { gte: monthStart } },
        _sum: { amount_paid: true },
      }),
      prisma.rent_obligations.groupBy({
        by: ["hostel_id"],
        where: { hostel_id: { in: hostelIds }, status: { in: ["PENDING", "PARTIAL", "OVERDUE"] } },
        _sum: { amount: true },
      }),
      prisma.owner_documents.findMany({
        where: { profile_id: { in: ownerIds }, is_active: true },
        select: { profile_id: true, doc_type: true, status: true },
      }),
      // The owner's profile picture — stored on `profile_identity.photo_url`,
      // never on `profile` (see app/api/owner/me/photo/route.ts). Not every
      // owner has a row here; only those who uploaded a photo.
      prisma.profile_identity.findMany({
        where: { profile_id: { in: ownerIds } },
        select: { profile_id: true, photo_url: true },
      }),
      // ADR-172: billing is owner-level. One subscription per owner; MRR is the
      // current plan price (paise) of an ACTIVE subscription.
      prisma.owner_subscriptions.findMany({
        where: { owner_id: { in: ownerIds } },
        select: {
          owner_id: true,
          status: true,
          next_renewal_at: true,
          subscription_plans: { select: { price_paise: true, code: true, name: true } },
        },
      }),
      // Real, but sparse: only a few services write activity_logs, so this is
      // "last recorded action", never "last seen". The UI must not present it
      // as a login.
      prisma.activity_logs.groupBy({
        by: ["owner_id"],
        where: { owner_id: { in: ownerIds } },
        _max: { timestamp: true },
      }),
    ]);

    const byOwner = <T>(rows: any[], key: string, pick: (row: any) => T) =>
      new Map<string, T>(rows.map((r) => [r[key] as string, pick(r)]));

    const tenantsByOwner = byOwner(tenantCounts, "owner_id", (r) => r._count._all as number);
    const activeByOwner = byOwner(activeTenantCounts, "owner_id", (r) => r._count._all as number);
    const capacityByHostel = byOwner(capacitySums, "hostel_id", (r) => Number(r._sum.capacity ?? 0));
    const collectedByHostel = byOwner(collectionSums, "hostel_id", (r) => Number(r._sum.amount_paid ?? 0));
    const duesByHostel = byOwner(duesSums, "hostel_id", (r) => Number(r._sum.amount ?? 0));
    const lastActivityByOwner = byOwner(lastActivity, "owner_id", (r) => r._max.timestamp as Date | null);
    const subscriptionByOwner = new Map(subscriptions.map((s: any) => [s.owner_id, s] as const));
    const photoByOwner = new Map(identities.map((i: any) => [i.profile_id, i.photo_url] as const));

    const result = owners.map((owner: any) => {
      const own = hostels.filter((h: any) => h.owner_id === owner.id);
      const ids = own.map((h: any) => h.id);

      const sum = (map: Map<string, number>) =>
        ids.reduce((acc: number, id: string) => acc + (map.get(id) ?? 0), 0);
      const capacity = sum(capacityByHostel);
      const activeTenants = activeByOwner.get(owner.id) ?? 0;

      const ownerDocs = documents.filter((d: any) => d.profile_id === owner.id);
      const verifiedTypes = new Set(
        ownerDocs
          .filter((d: any) => String(d.status).toUpperCase() === "VERIFIED")
          .map((d: any) => String(d.doc_type).toUpperCase()),
      );

      const ownerSub: any = subscriptionByOwner.get(owner.id) ?? null;
      const mrr =
        ownerSub && String(ownerSub.status) === "ACTIVE"
          ? Number(ownerSub.subscription_plans?.price_paise ?? 0) / 100
          : 0;
      const renewals = ownerSub?.next_renewal_at ? [ownerSub.next_renewal_at as Date] : [];

      return {
        id: owner.id,
        name: owner.name,
        email: owner.email,
        phone: owner.phone,
        // profile.city is essentially never filled in for an owner — the
        // real city lives on their hostel (matches the detail route).
        city: own[0]?.city ?? null,
        joined_at: owner.created_at,
        is_active: owner.is_active,
        photo_url: photoByOwner.get(owner.id) ?? null,

        hostels: own.length,
        hostels_live: own.filter((h: any) => String(h.listing_status) === "LIVE").length,
        hostels_awaiting_approval: own.filter((h: any) => String(h.verification_status) === "PENDING").length,
        hostel_names: own.slice(0, 3).map((h: any) => h.name),

        tenants: tenantsByOwner.get(owner.id) ?? 0,
        active_tenants: activeTenants,
        capacity,
        occupancy: capacity > 0 ? Math.round((activeTenants / capacity) * 100) : 0,

        collected_this_month: sum(collectedByHostel),
        outstanding: sum(duesByHostel),

        documents_verified: REQUIRED_DOCS.every((t) => verifiedTypes.has(t)),
        documents_rejected: ownerDocs.some((d: any) => String(d.status).toUpperCase() === "REJECTED"),
        documents_submitted: ownerDocs.length,

        mrr,
        // Whatever plan the owner is on right now, active or not — a paused
        // or expired subscription still names a real plan, and showing
        // "Unassigned" for it would misreport a billing lapse as never having
        // signed up. `Unassigned` is reserved for owners with no
        // `owner_subscriptions` row at all (pre-ADR-172 backfill gap).
        plan_name: ownerSub?.subscription_plans?.name ?? null,
        plan_code: ownerSub?.subscription_plans?.code ?? null,
        subscription_statuses: ownerSub ? [String(ownerSub.status)] : [],
        next_renewal_at: renewals.length > 0 ? new Date(Math.min(...renewals.map((d: Date) => d.getTime()))) : null,

        /** Last recorded *action*, not a login — see the note above. */
        last_activity_at: lastActivityByOwner.get(owner.id) ?? null,
      };
    });

    return apiResponse({
      owners: result,
      total,
      offset,
      has_more: offset + owners.length < total,
    });
  } catch (error: any) {
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    return apiError(String(error?.message || "Failed to fetch owners"));
  }
}

const ADD_OWNER_OTP_PURPOSE = "PHONE_VERIFICATION";

/**
 * POST /api/platform-admin/owners
 *
 * Admin -> Add Owner (field/direct marketing). Creates a `platform_leads`
 * row tagged `acquisition_source: DIRECT_ADMIN` and converges into the
 * exact same invitation/onboarding/subscription pipeline the public lead
 * form uses (see docs/obsidian/Features.md) — this route does not create an
 * owner account itself; the account is created later, when the owner opens
 * the invitation link, exactly like the website channel.
 *
 * Requires the admin to have already run the owner's phone through the
 * existing public OTP endpoints (POST /api/auth/send-phone-otp then
 * verify-phone-otp, purpose PHONE_VERIFICATION) — this route only checks
 * that a recent verification record exists (resolveSignupPhoneVerification),
 * it never marks a phone verified on the admin's say-so.
 */
export async function POST(req: NextRequest) {
  const session = await getSession(req);
  try {
    await requireAdminOrManagerPermission(session, "MANAGE_OWNERS");

    const body = await req.json().catch(() => ({}));
    const validated = AdminAddOwnerSchema.safeParse(body);
    if (!validated.success) {
      return apiError("Validation error", "VALIDATION_ERROR", 400);
    }
    const { name, email, phone } = validated.data;
    const normalizedEmail = email.trim().toLowerCase();
    const normalizedPhone = normalizeWhatsAppPhone(phone);

    // Existing owner/tenant/admin account with this email or phone already —
    // do not create a second lead/account for someone already on the
    // platform. Phone is matched across every historical storage shape
    // (see profilePhoneCandidates), since profile.phone predates today's
    // normalization.
    const existingProfile = await prisma.profile.findFirst({
      where: {
        OR: [
          { email: normalizedEmail },
          { phone: { in: profilePhoneCandidates(normalizedPhone) } },
        ],
      },
      select: { id: true, name: true, email: true, role: true },
    });
    if (existingProfile) {
      return apiError(
        `An account already exists for this email/phone (${existingProfile.name}, ${existingProfile.role}).`,
        "OWNER_EXISTS",
        409,
        { existing_profile_id: existingProfile.id },
      );
    }

    const verification = await resolveSignupPhoneVerification(normalizedPhone, ADD_OWNER_OTP_PURPOSE);
    if (!verification.ok) {
      return apiError(
        "Verify the owner's phone number (send + confirm the OTP) before creating this owner.",
        "PHONE_NOT_VERIFIED",
        400,
      );
    }

    const result = await createPlatformLead({
      name,
      // Real hostel name is collected later, during the owner's own
      // onboarding — the Add Owner form deliberately only asks for name,
      // email, phone. `platform_leads.hostel_name` is NOT NULL, so this is a
      // display-only placeholder until the owner names their hostel for real.
      hostel_name: name,
      phone: normalizedPhone,
      google_email: normalizedEmail,
      phone_verified: verification.phoneVerified,
      acquisition_source: "DIRECT_ADMIN",
    });

    if (result.duplicate) {
      return apiError(
        `A pending onboarding already exists for this phone (status ${result.lead.status}).`,
        "DUPLICATE_PHONE",
        409,
        { existing_lead_id: result.lead.id, status: result.lead.status },
      );
    }

    return apiResponse(
      {
        id: result.lead.id,
        status: result.lead.status,
        acquisition_source: result.lead.acquisition_source,
        phone_verified: result.lead.phone_verified,
      },
      201,
    );
  } catch (error: any) {
    if (error?.name === "HttpForbidden") return apiError(error.message, "FORBIDDEN", 403);
    console.error("Detailed API Error [platform-admin.owners.POST]:", error);
    return apiError("Could not create this owner. Please try again.", "INTERNAL_ERROR", 500);
  }
}
