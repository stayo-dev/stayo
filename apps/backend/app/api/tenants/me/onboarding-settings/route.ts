export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiError, apiResponse } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTenantOperationalContext } from "@/lib/hostel-context";

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return apiError("Only tenants can access onboarding settings", "FORBIDDEN", 403);
  }

  try {
    const tenant = await prisma.tenants.findUnique({
      where: { profile_id: session.sub },
      select: {
        id: true,
        owner_id: true,
        hostel_id: true,
        profile_type: true,
        monthly_rent: true,
        joined_on: true,
        billing_start_date: true,
        security_deposit: true,
        maintenance_charge: true,
        maintenance_type: true,
        phone_1: true,
        phone_2: true,
        phone_3: true,
        personal_email: true,
        gender: true,
        date_of_birth: true,
        temporary_address: true,
        permanent_address: true,
        college_name: true,
        roll_number: true,
        course: true,
        year_of_study: true,
        section: true,
        branch: true,
        office_name: true,
        office_location: true,
        job_role: true,
        profiles: {
          select: {
            name: true,
            email: true,
            phone: true,
            emergency_contact: true,
          },
        },
        room_allocations: {
          where: { is_active: true, end_date: null },
          orderBy: { start_date: "desc" },
          take: 1,
          select: {
            start_date: true,
            room: {
              select: {
                id: true,
                room_no: true,
                floor: true,
                room_type: true,
                base_rent: true,
              },
            },
          },
        },
      },
    });

    if (!tenant) {
      return apiError("Tenant record not found", "NOT_FOUND", 404);
    }

    let prefs: any = null;
    if (tenant.owner_id) {
      try {
        prefs = (await getTenantOperationalContext(tenant.id, tenant.owner_id, tenant.hostel_id)).prefs;
      } catch (prefsError) {
        console.error("[tenant.onboarding-settings] Failed to resolve onboarding preferences", prefsError);
      }
    }

    return apiResponse({
      require_profile_photo_onboarding: Boolean(prefs?.require_profile_photo_onboarding),
      require_phone_otp_onboarding: false,
      invited_defaults: {
        name: tenant.profiles?.name || "",
        phone: tenant.phone_1 || tenant.profiles?.phone || "",
        emergency_contact: tenant.phone_3 || tenant.profiles?.emergency_contact || "",
        personal_email: tenant.personal_email || tenant.profiles?.email || "",
        gender: tenant.gender || "",
        date_of_birth: tenant.date_of_birth ? tenant.date_of_birth.toISOString().slice(0, 10) : "",
        temporary_address: tenant.temporary_address || "",
        permanent_address: tenant.permanent_address || "",
        profile_type: tenant.profile_type || "",
        college_name: tenant.college_name || "",
        roll_number: tenant.roll_number || "",
        course: tenant.course || "",
        year_of_study: tenant.year_of_study || "",
        section: tenant.section || "",
        branch: tenant.branch || "",
        office_name: tenant.office_name || "",
        office_location: tenant.office_location || "",
        job_role: tenant.job_role || "",
      },
      invite_summary: {
        monthly_rent: tenant.monthly_rent ? Number(tenant.monthly_rent) : 0,
        advance_deposit: Number(tenant.security_deposit || 0),
        maintenance_charge: Number(tenant.maintenance_charge || 0),
        maintenance_type: tenant.maintenance_type,
        joined_on: tenant.joined_on,
        billing_start_date: tenant.billing_start_date,
        room: tenant.room_allocations[0]?.room || null,
      },
    });
  } catch (error: any) {
    return apiError(error?.message || "Failed to fetch onboarding settings");
  }
}
