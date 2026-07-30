export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { TenantProfileUpdateSchema } from "@/lib/validators";
import { getTenantOperationalContext } from "@/lib/hostel-context";
import { imagekit } from "@/lib/imagekit";
import { normalizeIndianPhone } from "@/lib/utils/phone-utils";
import { withOnboardingMetrics } from "@/lib/onboarding-metrics";

/**
 * 👨‍🎓 COMPLETE TENANT PROFILE (Onboarding)
 * POST /api/tenants/me/complete-profile
 * Parses FormData for profile details. Aadhaar documents uploaded via document service.
 */
export async function POST(req: NextRequest) {
  const startedAt = performance.now();
  let externalCalls = 0;
  const session = await getSession(req);
  if (!session || session.role !== "TENANT") {
    return withOnboardingMetrics(apiError("Only tenants can complete profile", "FORBIDDEN", 403), { startedAt });
  }

  try {
    const formData = await req.formData();
    const profileDataStr = formData.get("profile_data") as string;
    if (!profileDataStr) {
      return withOnboardingMetrics(apiError("profile_data is required", "VALIDATION_ERROR", 400), { startedAt });
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(profileDataStr);
    } catch (e) {
      return withOnboardingMetrics(apiError("Invalid JSON in profile_data", "VALIDATION_ERROR", 400), { startedAt });
    }

    const validated = TenantProfileUpdateSchema.safeParse(parsedData);
    if (!validated.success) {
      const firstIssue = validated.error.issues[0];
      const issuePath = firstIssue?.path?.join(".") || "profile_data";
      const issueMessage = firstIssue?.message || "Invalid value";
      return withOnboardingMetrics(apiError(`Validation error at ${issuePath}: ${issueMessage}`, "VALIDATION_ERROR", 400), { startedAt });
    }

    const payload = (validated.data as any);
    const normalizedPhone = normalizeIndianPhone(payload.phone);
    if (!normalizedPhone) {
      return withOnboardingMetrics(apiError("Valid Indian mobile number is required", "VALIDATION_ERROR", 400), { startedAt });
    }
    const normalizedEmergencyPhone = payload.emergency_contact
      ? normalizeIndianPhone(payload.emergency_contact)
      : null;
    if (payload.emergency_contact && !normalizedEmergencyPhone) {
      return withOnboardingMetrics(apiError("Valid emergency mobile number is required", "VALIDATION_ERROR", 400), { startedAt });
    }
    if (normalizedEmergencyPhone && normalizedEmergencyPhone === normalizedPhone) {
      return withOnboardingMetrics(apiError("Primary mobile and emergency mobile must be different numbers", "VALIDATION_ERROR", 400), { startedAt });
    }

    // Default mapped values
    let gender = payload.gender;
    if (gender === "Prefer not to say") gender = null;
    
    // Address backwards compatibility
    const tempAddr = payload.temporary_address || payload.address || null;
    const permAddr = payload.permanent_address || payload.address || null;

    const profilePhotoFile = formData.get("profile_photo") as File | null;

    const tenantOwner = await prisma.tenants.findUnique({
      where: { profile_id: session.sub },
      select: { id: true, owner_id: true, hostel_id: true },
    });
    const normalizedRollNumber =
      payload.profile_type !== "WORKING_PROFESSIONAL" && payload.roll_number
        ? String(payload.roll_number).trim().toUpperCase()
        : null;
    if (tenantOwner && tenantOwner.owner_id && normalizedRollNumber) {
      const duplicateRollNumberTenant = await prisma.tenants.findFirst({
        where: {
          id: { not: tenantOwner.id },
          owner_id: tenantOwner.owner_id,
          roll_number: { equals: normalizedRollNumber, mode: "insensitive" },
          status: { not: "CANCELLED" },
        },
        select: { id: true },
      });

      if (duplicateRollNumberTenant) {
        return withOnboardingMetrics(
          apiError("This roll number is already used by another tenant. Enter a unique roll number.", "VALIDATION_ERROR", 400),
          { startedAt },
        );
      }
    }
    let ownerPrefs: any = null;
    if (tenantOwner?.owner_id) {
      try {
        ownerPrefs = (await getTenantOperationalContext(tenantOwner.id, tenantOwner.owner_id, tenantOwner.hostel_id)).prefs;
      } catch (prefsError) {
        console.error("[tenant.complete-profile] Failed to resolve onboarding preferences", prefsError);
      }
    }
    const profilePhotoRequired = Boolean(ownerPrefs?.require_profile_photo_onboarding);
    if (profilePhotoRequired && !profilePhotoFile) {
      return withOnboardingMetrics(apiError("Profile photo is required by your hostel owner.", "VALIDATION_ERROR", 400), { startedAt });
    }

    if (profilePhotoFile) {
      const allowed = ["image/jpeg", "image/png", "image/webp"];
      if (!allowed.includes(profilePhotoFile.type)) {
        return withOnboardingMetrics(apiError("Profile photo must be JPG, PNG, or WEBP", "VALIDATION_ERROR", 400), { startedAt });
      }
      if (profilePhotoFile.size > 2 * 1024 * 1024) {
        return withOnboardingMetrics(apiError("Profile photo must be less than 2MB", "VALIDATION_ERROR", 400), { startedAt });
      }
    }

    // Upload profile photo to ImageKit before the DB transaction
    let photoUrl: string | undefined;
    if (profilePhotoFile && tenantOwner) {
      try {
        const photoBuffer = Buffer.from(await profilePhotoFile.arrayBuffer());
        externalCalls = 1;
        const upload = await imagekit.files.upload({
          file:              photoBuffer.toString("base64"),
          fileName:          profilePhotoFile.name || "profile.jpg",
          folder:            `owners/${tenantOwner.owner_id}/tenants/${tenantOwner.id}/documents/PROFILE_PHOTO`,
          useUniqueFileName: true,
          tags:              ["PROFILE_PHOTO", tenantOwner.id],
        });
        photoUrl = upload.url;
      } catch (uploadError) {
        console.error("[tenant.complete-profile] Profile photo upload failed", uploadError);
        if (profilePhotoRequired) {
          return withOnboardingMetrics(apiError("Profile photo upload failed. Please try again.", "UPLOAD_FAILED", 502), {
            startedAt,
            externalCalls,
          });
        }
      }
    }

    // Atomic onboarding transaction
    const updated = await prisma.$transaction(async (tx: any) => {
      // 1. Update Profile Layer
      await tx.profile.update({
        where: { id: session.sub },
        data: {
          name: payload.name || undefined,
          phone: normalizedPhone,
          emergency_contact: normalizedEmergencyPhone || undefined,
          is_profile_completed: true,
        }
      });

      // 2. Update Tenant Layer
      const tenantUpdate = await tx.tenants.update({
        where: { profile_id: session.sub },
        data: {
          phone_1: normalizedPhone,
          personal_email: payload.personal_email || undefined,
          gender: gender || undefined,
          date_of_birth: payload.date_of_birth ? new Date(payload.date_of_birth) : undefined,
          temporary_address: tempAddr || undefined,
          permanent_address: permAddr || undefined,
          profile_type: payload.profile_type || "STUDENT",

          college_name: payload.college_name || null,
          roll_number: normalizedRollNumber,
          course: payload.course || null,
          year_of_study: payload.year_of_study || null,
          branch: payload.branch || null,
          section: payload.section || null,

          office_name: payload.office_name || null,
          office_location: payload.office_location || null,
          job_role: payload.job_role || null,

          photo_url: photoUrl || undefined,
          profile_completed: true,
        }
      });

      return tenantUpdate;
    }, { timeout: 15000 });

    return withOnboardingMetrics(apiResponse(updated, 201), { startedAt, payload: updated, externalCalls });
  } catch (error: any) {
    console.error(error);
    const msg = String(error?.message || "");
    if (error?.code === "P2002") {
      return withOnboardingMetrics(apiError("This record violates a unique constraint.", "DUPLICATE", 409), {
        startedAt,
        externalCalls,
      });
    }
    return withOnboardingMetrics(apiError(error?.message || "Failed to complete profile"), {
      startedAt,
      payload: { message: error?.message },
      externalCalls,
    });
  }
}
