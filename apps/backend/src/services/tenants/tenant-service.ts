import { prisma } from "../../../lib/db";
import { eventSystem } from "../../../lib/events";
import { z } from "zod";
import { getTenantOperationalContext } from "../../../lib/hostel-context";
import { authOtpService } from "../../../lib/services/auth/auth-otp-service";
import { normalizeWhatsAppPhone } from "../../../lib/services/notifications/providers/whatsapp/meta-provider";
import { assertGuardianPhoneNotTenant } from "../../../lib/utils/phone-utils";
import { frontendUrl } from "../../../lib/config/domains";

import { allocationReconciliationService } from "../../../lib/services/allocation-reconciliation-service";
import { financialService } from "../../../src/services/payments/financial-service";
import { financialReadModelService } from "../../../src/services/payments/financial-read-model-service";
import { obligationEngine } from "../../../src/services/payments/obligation-engine";
import { getLogger } from "../../../lib/logger";
import { currentAgreementWhere } from "./agreement-status";
import { eventLog } from "../../../lib/services/event-log-service";
import { imagekit } from "../../../lib/imagekit";
import { tenantRepository } from "../../repositories/tenantRepository";
/** `7013216327` and `+917013216327` are the same number — the mismatch that made ADR-110 inert once already. */
function samePhoneValue(a: unknown, b: unknown): boolean {
  const digits = (v: unknown) => String(v ?? "").replace(/\D/g, "").slice(-10);
  const left = digits(a);
  return left.length === 10 && left === digits(b);
}

import { isEmailProven, isPhoneProven } from "@/lib/services/auth/contact-verification-service";
import { assertCapability } from "../../../lib/services/move-out-service";
import {
  partitionFieldsByCategory,
  createTenantSnapshot,
  changeRequestService,
  isInCorrectionWindow,
  classifyTenantField,
  changeManagementFacade,
} from "../change-management";
import { ChangeCategory, ChangeApprovalLevel } from "@prisma/client";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

const logger = getLogger("tenant-service");

export class TenantService {
  private withLegacyTenantRelations(tenant: any) {
    if (!tenant) return tenant;
    const invitation = tenant.tenant_invitations?.[0] || null;
    const fallbackProfile = tenant.profile ?? tenant.profiles ?? (invitation
      ? { id: null, name: invitation.name, email: invitation.email, phone: invitation.phone }
      : null);
    const activeMoveOut = tenant.move_out_requests?.find((r: any) => r.status !== "COMPLETED" && r.status !== "REJECTED");
    const hasActiveMoveOut = !!activeMoveOut;
    const hasFutureExit = tenant.exit_date && new Date(tenant.exit_date).getTime() > new Date().getTime();
    const computedStatus = (hasActiveMoveOut || hasFutureExit) ? "MOVE_OUT_REQUESTED" : tenant.status;
    return {
      ...tenant,
      status: computedStatus,
      profile: fallbackProfile,
      profiles: tenant.profiles ?? fallbackProfile,
      allocations: tenant.allocations ?? tenant.room_allocations ?? [],
      obligations: tenant.obligations ?? tenant.rent_obligations ?? [],
    };
  }

  async getTenantById(id: string, requestingUser: { sub: string; role: string }) {
    const tenant = await tenantRepository.findUnique({
      where: { id },
      select: {
        id: true,
        profile_id: true,
        monthly_rent: true,
        joined_on: true,
        status: true,
        owner_id: true,
        profile_completed: true,
        photo_url: true,
        phone_1: true,
        phone_2: true,
        phone_3: true,
        personal_email: true,
        college_name: true,
        roll_number: true,
        course: true,
        year_of_study: true,
        section: true,
        branch: true,
        office_name: true,
        office_location: true,
        job_role: true,
        profile_type: true,
        gender: true,
        permanent_address: true,
        temporary_address: true,
        created_at: true,
        updated_at: true,
        profiles: true,
        tenant_invitations: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { name: true, email: true, phone: true, status: true, agreement_duration_months: true, agreement_start_date: true },
        },
        room_allocations: {
          where: { is_active: true, end_date: null },
          orderBy: { start_date: "desc" },
          take: 1,
          include: { room: true },
        },
        move_out_requests: {
          where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
          orderBy: { created_at: "desc" },
          take: 1,
          select: { id: true, status: true }
        },
      }
    });

    if (!tenant) throw new Error("NOT_FOUND: Tenant record not found");

    if (requestingUser.role === "TENANT" && tenant.profile_id !== requestingUser.sub) {
      throw new Error("FORBIDDEN: You can only view your own record");
    }
    if (requestingUser.role === "OWNER" && tenant.owner_id !== requestingUser.sub) {
      await eventLog.log("OWNER_SCOPE_VIOLATION", requestingUser.sub, {
        entity_type: "Tenant",
        entity_id: id,
        attempted_owner_id: tenant.owner_id,
      });
      throw new Error("FORBIDDEN: You can only view your own tenants");
    }


    return { ...this.withLegacyTenantRelations(tenant), verification_badge: null };
  }

  async getTenantByProfile(profileId: string, requestingUser: { sub: string; role: string }) {
    const tenant = await tenantRepository.findFirst({
      where: liveTenancyWhere(profileId),
      select: {
        id: true,
        profile_id: true,
        monthly_rent: true,
        joined_on: true,
        status: true,
        owner_id: true,
        profile_completed: true,
        photo_url: true,
        phone_1: true,
        phone_2: true,
        phone_3: true,
        personal_email: true,
        college_name: true,
        roll_number: true,
        course: true,
        year_of_study: true,
        section: true,
        branch: true,
        office_name: true,
        office_location: true,
        job_role: true,
        profile_type: true,
        gender: true,
        permanent_address: true,
        temporary_address: true,
        created_at: true,
        updated_at: true,
        profiles: true,
        tenant_invitations: {
          orderBy: { created_at: "desc" },
          take: 1,
          select: { name: true, email: true, phone: true, status: true, agreement_duration_months: true, agreement_start_date: true },
        },
        room_allocations: {
          where: { is_active: true, end_date: null },
          orderBy: { start_date: "desc" },
          take: 1,
          include: { room: true },
        },
        move_out_requests: {
          where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
          orderBy: { created_at: "desc" },
          take: 1,
          select: { id: true, status: true }
        },
      }
    });

    if (!tenant) throw new Error("NOT_FOUND: Tenant record not found");

    if (requestingUser.role === "TENANT" && profileId !== requestingUser.sub) {
      throw new Error("FORBIDDEN: You can only view your own record");
    }
    if (requestingUser.role === "OWNER" && tenant.owner_id !== requestingUser.sub) {
      await eventLog.log("OWNER_SCOPE_VIOLATION", requestingUser.sub, {
        entity_type: "Tenant",
        entity_id: tenant.id,
        attempted_owner_id: tenant.owner_id,
      });
      throw new Error("FORBIDDEN: You can only view your own tenants");
    }


    return { ...this.withLegacyTenantRelations(tenant), verification_badge: null };
  }

  async getAllTenants(params: {
    status?: string;
    search?: string;
    ownerId?: string;
    hostelId: string; // URL-driven hostel isolation
    limit?: number;
    offset?: number;
  }) {
    const { status, search, ownerId, hostelId, limit = 50, offset = 0 } = params;

    const where: any = {
      ...(ownerId && { owner_id: ownerId }),
      ...(hostelId && { hostel_id: hostelId }),
    };

    if (status) {
      if (status === "MOVE_OUT_REQUESTED") {
        where.move_out_requests = {
          some: {
            status: {
              in: [
                "REQUESTED",
                "SETTLEMENT_PENDING",
                "SETTLEMENT_APPROVED",
                "PHYSICALLY_VACATED",
                "SETTLEMENT_PENDING_PAYMENT",
                "APPROVED",
                "VACATED",
              ],
            },
          }
        };
      } else {
        where.status = status as any;
      }
    }

    if (search) {
      where.OR = [
        { profiles: { name: { contains: search, mode: "insensitive" } } },
        { profiles: { email: { contains: search, mode: "insensitive" } } },
        { profiles: { phone: { contains: search, mode: "insensitive" } } },
        { tenant_invitations: { some: { name: { contains: search, mode: "insensitive" } } } },
        { tenant_invitations: { some: { email: { contains: search, mode: "insensitive" } } } },
        { tenant_invitations: { some: { phone: { contains: search, mode: "insensitive" } } } },
        { roll_number: { contains: search, mode: "insensitive" } },
        { personal_email: { contains: search, mode: "insensitive" } },
        { phone_1: { contains: search, mode: "insensitive" } },
        { phone_2: { contains: search, mode: "insensitive" } },
        {
          room_allocations: {
            some: {
              is_active: true,
              end_date: null,
              room: {
                room_no: { contains: search, mode: "insensitive" }
              }
            }
          }
        }
      ];
    }

    const [tenants, total] = await Promise.all([
      tenantRepository.findMany({
        where,
        include: {
          profiles: true,
          tenant_invitations: {
            orderBy: { created_at: "desc" },
            take: 1,
            select: { name: true, email: true, phone: true, status: true },
          },
          room_allocations: {
            where: { is_active: true, end_date: null },
            include: { room: true },
          },
          rent_obligations: {
            where: { status: { in: ["PENDING", "PARTIAL", "PAID"] }, is_superseded: false },
            include: { payments: { select: { amount_paid: true, payment_date: true } } }
          },
          move_out_requests: {
            where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
            orderBy: { created_at: "desc" },
            take: 1,
            select: { id: true, status: true }
          },
          hostels: {
            select: { name: true }
          },
          agreements: {
            select: { id: true, status: true }
          },
          tenant_behavior_scores: {
            select: { score: true }
          }
        },
        take: limit,
        skip: offset,
        orderBy: { joined_on: "desc" },
      }),
      tenantRepository.count({ where }),
    ]);

    const mappedTenants = await Promise.all(tenants.map(async (s: any) => {
      if (!s) return null;
      const tenant = this.withLegacyTenantRelations(s);
      if (!tenant) return null;
      const summary = financialService.getTenantPaymentSummary(tenant.id, tenant.obligations ?? []);
      const firstAllocation = tenant.room_allocations?.[0];
      const firstObligation = (tenant.obligations ?? [])[0];

      // Compute last payment date
      let last_payment_date: string | null = null;
      const allPayments = (tenant.obligations ?? [])
        .flatMap((o: any) => o.payments ?? [])
        .filter((p: any) => p.payment_date)
        .sort((a: any, b: any) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime());
      if (allPayments.length > 0) {
        last_payment_date = allPayments[0].payment_date;
      }

      // Compute overdue days
      let overdue_days = 0;
      const unpaidObligations = (tenant.obligations ?? [])
        .filter((o: any) => ["PENDING", "PARTIAL"].includes(o.status) && o.due_date);
      if (unpaidObligations.length > 0) {
        const today = new Date();
        const overdueDts = unpaidObligations
          .map((o: any) => new Date(o.due_date))
          .filter((d: Date) => d < today);
        if (overdueDts.length > 0) {
          const oldestDue = new Date(Math.min(...overdueDts.map((d: Date) => d.getTime())));
          const diffTime = today.getTime() - oldestDue.getTime();
          if (diffTime > 0) {
            overdue_days = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
          }
        }
      }

      // Check for agreement status
      const has_agreement = (tenant.agreements ?? []).some(
        (a: any) => ["SIGNED", "EXPIRING_SOON"].includes(a.status)
      );

      // Compute deposit status
      const depositObligations = (tenant.obligations ?? []).filter(
        (o: any) => o.obligation_type === "SECURITY_DEPOSIT"
      );
      let deposit_status = "UNKNOWN";
      if (depositObligations.length > 0) {
        const isAllPaid = depositObligations.every((o: any) => o.status === "PAID");
        deposit_status = isAllPaid ? "PAID" : "PENDING";
      } else {
        if (Number(tenant.security_deposit || 0) === 0) {
          deposit_status = "WAIVED";
        } else {
          deposit_status = "PENDING";
        }
      }

      return {
        ...tenant,
        payment_summary: summary,
        // Denormalized top-level fields consumed by the frontend
        name: tenant.profiles?.name ?? null,
        email: tenant.profiles?.email ?? null,
        phone: tenant.profiles?.phone ?? tenant.phone_1 ?? null,
        room_no: firstAllocation?.room?.room_no ?? null,
        room_number: firstAllocation?.room?.room_no ?? null,
        payment_status: summary.payment_status,
        outstanding_amount: summary.pending_amount,
        due_date: firstObligation?.due_date ?? null,
        obligation_id: firstObligation?.id ?? null,
        hostel_name: tenant.hostels?.name ?? null,
        last_payment_date,
        overdue_days,
        has_agreement,
        deposit_status,
        score: tenant.tenant_behavior_scores?.score ?? null,
      };
    }));

    return { tenants: mappedTenants.filter(Boolean), total, limit, offset };
  }

  async updateTenantSelfProfile(profileId: string, data: any, updatedBy: string) {
    const tenantCheck = await tenantRepository.findFirst({
      where: liveTenancyWhere(profileId),
      select: { id: true, owner_id: true, hostel_id: true },
    });

    if (!tenantCheck) throw new Error("NOT_FOUND: Tenant record not found");

    await assertCapability(tenantCheck.id, "EDIT_PROFILE");

    /**
     * No owner gate, and no admin gate — a person's own contact details are
     * theirs to change (ADR-119).
     *
     * Two gates used to stand here and both are gone. `allow_tenant_edits`
     * let an owner switch off a resident's ability to edit their own profile
     * at all. And `GOVERNED_FIELDS` rejected `phone_1`/`phone`/`personal_email`
     * outright, telling the caller to file at
     * `POST /api/tenants/me/profile-requests` for owner approval — a queue
     * that held **0 rows, ever**.
     *
     * What survives is the part that was actually doing work: a contact detail
     * we hold should be one that reaches you. So a *changed* phone or email
     * must be proved by the person changing it, with a code sent to the new
     * value. That is not a permission — nobody decides whether you may change
     * your number; you just show us it is yours. Unchanged values are never
     * re-proved, so saving a form without touching them costs nothing.
     */
    const currentContact = await tenantRepository.findFirst({
      where: { id: tenantCheck.id },
      select: { phone_1: true, personal_email: true },
    });

    const changedPhone = ["phone_1", "phone"].some(
      (key) => key in data && !samePhoneValue(data[key], currentContact?.phone_1),
    );
    if (changedPhone) {
      const target = data.phone_1 ?? data.phone;
      if (!(await isPhoneProven(String(target ?? "")))) {
        throw new Error(
          "PHONE_NOT_VERIFIED: Verify the new number with the code we sent before saving it",
        );
      }
    }

    if ("personal_email" in data) {
      const next = String(data.personal_email ?? "").trim().toLowerCase();
      const previous = String(currentContact?.personal_email ?? "").trim().toLowerCase();
      if (next && next !== previous && !(await isEmailProven(profileId, next))) {
        throw new Error(
          "EMAIL_NOT_VERIFIED: Verify the new email with the code we sent before saving it",
        );
      }
    }

    const profileFields = ["name", "emergency_contact", "city", "state", "pincode"];
    const tenantFields = [
      "photo_url", "phone_2", "phone_3", "date_of_birth",
      "college_name", "roll_number", "course", "year_of_study", "section", "branch",
      "temporary_address", "gender", "profile_type", "nationality", "pan_number",
      "office_name", "office_location", "job_role",
      "guardian_name", "guardian_relation", "expected_completion_date",
    ];

    const profileUpdate: any = {};
    const tenantUpdate: any = {};

    for (const [key, value] of Object.entries(data)) {
      if (profileFields.includes(key)) {
        profileUpdate[key] = value;
      } else if (tenantFields.includes(key)) {
        if (key === "date_of_birth" || key === "expected_completion_date") {
          tenantUpdate[key] = value ? new Date(value as string) : null;
        } else {
          tenantUpdate[key] = value;
        }
      }
    }

    // Synchronize duplicates across profile and tenant tables
    const syncedPhone = data.phone_1 || data.phone;
    if (syncedPhone) {
      profileUpdate.phone = syncedPhone;
      tenantUpdate.phone_1 = syncedPhone;
    }
    const syncedEmergency = data.phone_3 || data.emergency_contact;
    if (syncedEmergency) {
      profileUpdate.emergency_contact = syncedEmergency;
      tenantUpdate.phone_3 = syncedEmergency;
    }
    const syncedGuardian = data.phone_2 || data.guardian_phone;
    if (syncedGuardian) {
      await assertGuardianPhoneNotTenant(syncedGuardian, tenantCheck.id);
      tenantUpdate.phone_2 = syncedGuardian;
      tenantUpdate.guardian_phone = syncedGuardian;
    }

    // Fetch current state to verify if phone numbers changed
    const current = await tenantRepository.findUnique({
      where: { id: tenantCheck.id },
      include: { profiles: true },
    });
    if (!current) throw new Error("NOT_FOUND: Tenant record not found");

    const oldPrimary = (current.profiles?.phone || current.phone_1 || "").trim();
    const newPrimary = (syncedPhone || "").trim();
    if (newPrimary && oldPrimary) {
      try {
        const normOld = normalizeWhatsAppPhone(oldPrimary);
        const normNew = normalizeWhatsAppPhone(newPrimary);
        if (normOld !== normNew) {
          // Check if OTP was already verified by the frontend (status: VERIFIED)
          const alreadyVerified = await prisma.phoneVerificationOtp.findFirst({
            where: {
              phone: normNew,
              purpose: "ProfileUpdate",
              status: "VERIFIED",
              verified_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
            },
            orderBy: { verified_at: "desc" },
          });

          if (!alreadyVerified) {
            const otp = data.phone_1_otp || data.phone_otp;
            if (!otp) {
              throw new Error("VALIDATION_ERROR: Verification code is required to update your primary phone number");
            }
            await authOtpService.verifyPhoneOtp({
              phone: normNew,
              otp,
              purpose: "ProfileUpdate",
              requestIp: null,
            });
          }
        }
      } catch (err: any) {
        if (err.message?.includes("VALIDATION_ERROR")) throw err;
        throw new Error(`VALIDATION_ERROR: Primary phone verification failed: ${err.message || "Invalid or expired code"}`);
      }
    }

    const oldPhone2 = (current.phone_2 || current.guardian_phone || "").trim();
    const newPhone2 = (syncedGuardian || "").trim();
    if (newPhone2) {
      try {
        const normOld = oldPhone2 ? normalizeWhatsAppPhone(oldPhone2) : "";
        const normNew = normalizeWhatsAppPhone(newPhone2);
        if (normOld !== normNew) {
          // Check if OTP was already verified by the frontend (status: VERIFIED)
          const alreadyVerified = await prisma.phoneVerificationOtp.findFirst({
            where: {
              phone: normNew,
              purpose: "ProfileUpdate",
              status: "VERIFIED",
              verified_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
            },
            orderBy: { verified_at: "desc" },
          });

          if (!alreadyVerified) {
            // Fallback: try to verify OTP inline (e.g. if frontend didn't pre-verify)
            const otp = data.phone_2_otp || data.guardian_otp;
            if (!otp) {
              throw new Error("VALIDATION_ERROR: Verification code is required to update the parent/guardian phone number");
            }
            await authOtpService.verifyPhoneOtp({
              phone: normNew,
              otp,
              purpose: "ProfileUpdate",
              requestIp: null,
            });
          }
        }
      } catch (err: any) {
        if (err.message?.includes("VALIDATION_ERROR")) throw err;
        throw new Error(`VALIDATION_ERROR: Parent/Guardian phone verification failed: ${err.message || "Invalid or expired code"}`);
      }
    }

    const oldPhone3 = (current.phone_3 || current.profiles?.emergency_contact || "").trim();
    const newPhone3 = (syncedEmergency || "").trim();
    if (newPhone3) {
      try {
        const normOld = oldPhone3 ? normalizeWhatsAppPhone(oldPhone3) : "";
        const normNew = normalizeWhatsAppPhone(newPhone3);
        if (normOld !== normNew) {
          // Check if OTP was already verified by the frontend (status: VERIFIED)
          const alreadyVerified = await prisma.phoneVerificationOtp.findFirst({
            where: {
              phone: normNew,
              purpose: "ProfileUpdate",
              status: "VERIFIED",
              verified_at: { gte: new Date(Date.now() - 15 * 60 * 1000) },
            },
            orderBy: { verified_at: "desc" },
          });

          if (!alreadyVerified) {
            const otp = data.phone_3_otp || data.emergency_otp;
            if (!otp) {
              throw new Error("VALIDATION_ERROR: Verification code is required to update the emergency contact phone number");
            }
            await authOtpService.verifyPhoneOtp({
              phone: normNew,
              otp,
              purpose: "ProfileUpdate",
              requestIp: null,
            });
          }
        }
      } catch (err: any) {
        if (err.message?.includes("VALIDATION_ERROR")) throw err;
        throw new Error(`VALIDATION_ERROR: Emergency contact phone verification failed: ${err.message || "Invalid or expired code"}`);
      }
    }

    if (tenantUpdate.gender === "Prefer not to say") {
      tenantUpdate.gender = null;
    }

    // Aadhaar is now stored in identification_documents table, not on tenant record

    // Legacy address mapping
    if (data.address) {
      tenantUpdate.temporary_address = data.address;
      tenantUpdate.permanent_address = data.address;
    }
    if (typeof data.profile_type === "string") {
      const raw = String(data.profile_type).trim().toUpperCase();
      if (raw === "WORKING_PROFESSIONAL" || raw === "STUDENT") {
        tenantUpdate.profile_type = raw;
      } else {
        throw new Error("VALIDATION: profile_type must be STUDENT or WORKING_PROFESSIONAL");
      }
    }

    // Intercept Base64 profile photo and upload to ImageKit
    if (tenantUpdate.photo_url && tenantUpdate.photo_url.startsWith("data:image")) {
      try {
        const upload = await imagekit.files.upload({
          file: tenantUpdate.photo_url,
          fileName: `profile_${profileId}.jpg`,
          folder: `owners/${tenantCheck.owner_id}/tenants/${tenantCheck.id}/documents/PROFILE_PHOTO`,
          useUniqueFileName: true,
          tags: ["PROFILE_PHOTO", tenantCheck.id],
        });
        tenantUpdate.photo_url = upload.url;
      } catch (err: any) {
        logger.error("profile_photo_upload_failed", { error: err?.message, tenant_id: tenantCheck.id });
        delete tenantUpdate.photo_url; // Don't save the massive base64 string
      }
    }

    await prisma.$transaction(async (tx: any) => {
      if (Object.keys(profileUpdate).length > 0) {
        await tx.profile.update({
          where: { id: profileId },
          data: profileUpdate,
        });
      }

      if (Object.keys(tenantUpdate).length > 0) {
        try {
          await tx.tenants.updateMany({
            where: liveTenancyWhere(profileId),
            data: tenantUpdate,
          });
        } catch (error: any) {
          const code = (error as any)?.code;
          const msg = String(error?.message || error);
          if (code === "P2002") {
            throw new Error("VALIDATION: This record violates a unique constraint.");
          }
          if (msg.includes("tenants.gender") && Object.prototype.hasOwnProperty.call(tenantUpdate, "gender")) {
            delete tenantUpdate.gender;
            await tx.tenants.updateMany({
              where: liveTenancyWhere(profileId),
              data: tenantUpdate,
            });
          } else {
            throw error;
          }
        }
      }

      const current = await tx.tenants.findFirst({
        where: liveTenancyWhere(profileId),
        select: {
          id: true,
          profile_completed: true,
          phone_1: true,
          phone_2: true,
          college_name: true,
          roll_number: true,
          year_of_study: true,
          branch: true,
          temporary_address: true,
          permanent_address: true,
          profiles: {
            select: {
              name: true,
              email: true,
              phone: true,
              emergency_contact: true
            }
          }
        }
      });

      if (!current) throw new Error("NOT_FOUND: Tenant record not found");

      const isComplete = this.checkProfileCompletion(current);
      if (isComplete) {
        await tx.tenants.update({
          where: { id: current.id },
          data: { profile_completed: true },
        });
        await tx.profile.update({
          where: { id: profileId },
          data: { is_profile_completed: true },
        });
      }
    });

    return this.getTenantByProfile(profileId, { sub: profileId, role: "TENANT" });
  }

  private checkProfileCompletion(tenant: any) {
    const p = tenant.profile ?? tenant.profiles;
    const isWorkingProf = String(tenant.profile_type || "").trim().toUpperCase() === "WORKING_PROFESSIONAL";

    const required = [
      p.name,
      p.email,
      p.phone || tenant.phone_1,
      p.emergency_contact,
      tenant.permanent_address,
    ];

    if (isWorkingProf) {
      required.push(
        tenant.office_name,
        tenant.job_role,
        tenant.office_location
      );
    } else {
      required.push(
        tenant.college_name,
        tenant.roll_number,
        tenant.year_of_study,
        tenant.branch
      );
    }

    return required.every(field => field !== null && field !== undefined && String(field).trim() !== "");
  }

  async requestReactivation(profileId: string, requestedBy: string) {
    // Deliberately NOT `liveTenancyWhere`: reactivation is asked for *by* someone
    // whose tenancy is no longer live (the ACTIVE check below rejects live ones),
    // so scoping to live rows would make this permanently unreachable. Most recent
    // tenancy wins.
    const tenant = await tenantRepository.findFirst({
      where: { profile_id: profileId },
      orderBy: { created_at: "desc" },
      include: { profiles: true },
    });
    const legacyTenant = this.withLegacyTenantRelations(tenant);

    if (!legacyTenant) throw new Error("NOT_FOUND: Tenant record not found");
    if (legacyTenant.status === "ACTIVE") throw new Error("BAD_REQUEST: Account is already active");
    if (!legacyTenant.owner_id) throw new Error("BAD_REQUEST: Owner not linked for this tenant");

    // Check rate limit: 1 request per 24 hours
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = await prisma.reactivation_requests.findFirst({
      where: {
        tenant_id: legacyTenant.id,
        created_at: { gte: cutoff },
      },
      orderBy: { created_at: "desc" },
    });

    if (recent) {
      throw new Error(`BAD_REQUEST: Reactivation request already sent recently. Status: ${recent.status}`);
    }

    const request = await prisma.reactivation_requests.create({
      data: {
        tenant_id: legacyTenant.id,
        owner_id: legacyTenant.owner_id,
        requested_by_profile_id: requestedBy,
        current_status: legacyTenant.status,
        status: "PENDING",
      },
    });

    await eventSystem.trigger("reactivation_requested", {
      requestId: request.id,
      tenantId: legacyTenant.id,
      ownerId: legacyTenant.owner_id,
      tenantName: legacyTenant.profile.name,
    });

    return request;
  }

  async listReactivationRequests(ownerId: string) {
    const requests = await prisma.reactivation_requests.findMany({
      where: { owner_id: ownerId },
      orderBy: { created_at: "desc" },
      include: {
        tenants: {
          include: {
            profiles: true,
            room_allocations: {
              where: { is_active: true, end_date: null },
              include: { room: true }
            }
          }
        }
      }
    });

    return requests.map((req: any) => {
      const tenant = this.withLegacyTenantRelations(req.tenants);
      const profile = tenant.profile;
      const room = tenant.allocations[0]?.room;
      return {
        id: req.id,
        tenant_id: tenant.id,
        owner_id: req.owner_id,
        current_status: req.current_status,
        status: req.status,
        notes: req.notes,
        created_at: req.created_at,
        processed_at: req.processed_at,
        processed_by: req.processed_by,
        tenant_name: profile?.name ?? tenant.name ?? "Tenant",
        tenant_email: profile?.email ?? "",
        tenant_phone: profile?.phone ?? tenant.phone_1 ?? "",
        room_no: room?.room_no || null
      };
    });
  }

  async processReactivationRequest(requestId: string, ownerId: string, action: string, notes?: string) {
    const request = await prisma.reactivation_requests.findFirst({
      where: { id: requestId, owner_id: ownerId }
    });

    if (!request) throw new Error("NOT_FOUND: Reactivation request not found");
    if (request.status !== "PENDING") throw new Error("VALIDATION: Request already processed");

    const actionNorm = action.toLowerCase();
    if (!["approve", "reject"].includes(actionNorm)) throw new Error("VALIDATION: Action must be approve or reject");

    const newStatus = actionNorm === "approve" ? "APPROVED" : "REJECTED";

    if (actionNorm === "approve") {
      await prisma.tenants.update({
        where: { id: request.tenant_id },
        data: { status: "ACTIVE" }
      });
      await eventSystem.trigger("tenant_reactivated", { tenantId: request.tenant_id, userId: ownerId });
    }

    return await prisma.reactivation_requests.update({
      where: { id: requestId },
      data: {
        status: newStatus,
        notes: notes || null,
        processed_at: new Date(),
        processed_by: ownerId
      }
    });
  }
  async getOwnerTenantOverview(tenantId: string, ownerId: string) {
    const tenant = await tenantRepository.findFirst({
      where: { id: tenantId, owner_id: ownerId },
      include: {
        profiles: true,
        tenant_invitations: {
          orderBy: { created_at: "desc" },
          include: {
            room: true,
            // The bed is held by a reservation from the moment of invite —
            // no room_allocation exists until activation. Owner-side screens
            // that read the room from allocations therefore show INVITED
            // tenants as room-less; the reservation is the real answer.
            reservations: {
              where: { status: "ACTIVE" },
              orderBy: { reserved_at: "desc" },
              take: 1,
            },
          },
        },
        move_out_requests: {
          where: { status: { notIn: ["COMPLETED", "REJECTED"] } },
          orderBy: { created_at: "desc" },
          take: 1,
        },
        room_allocations: {
          where: { is_active: true, end_date: null },
          include: { room: true },
        },
        rent_obligations: {
          where: { status: { in: ["PENDING", "PARTIAL", "PAID"] }, is_superseded: false },
          include: { payments: { select: { amount_paid: true, payment_date: true, payment_method: true, reference_number: true } } }
        },
        identification_documents: {
          where: { is_active: true },
          orderBy: { created_at: "desc" },
        },
        rule_acceptances: {
          orderBy: { accepted_at: "desc" },
          take: 1,
          include: { rule_version: true },
        },
      }
    });

    const legacyTenant = this.withLegacyTenantRelations(tenant);

    if (!legacyTenant) throw new Error("NOT_FOUND: Tenant not found");

    const currentRoom = legacyTenant.allocations[0]?.room;

    if (!legacyTenant.hostel_id) throw new Error("HOSTEL_CONTEXT_REQUIRED: tenant hostel scope unavailable");
    const [
      readModel,
      paymentAgg,
      allPayments,
      reminders,
      allocations,
      moveOuts,
      notes,
      currentAgreement
    ] = await Promise.all([
      financialReadModelService.getFinancialReadModel(tenantId, ownerId, legacyTenant.hostel_id),
      prisma.payments.aggregate({
        where: { tenant_id: tenantId, owner_id: ownerId, hostel_id: legacyTenant.hostel_id },
        _sum: { amount_paid: true },
      }),
      prisma.payments.findMany({
        where: { tenant_id: tenantId, owner_id: ownerId, hostel_id: legacyTenant.hostel_id },
        orderBy: { payment_date: "desc" },
        take: 25,
        select: {
          id: true,
          amount_paid: true,
          payment_date: true,
          payment_method: true,
          reference_number: true,
        },
      }),
      prisma.reminder_logs.findMany({
        where: { tenant_id: tenantId },
        orderBy: { sent_at: "desc" },
        take: 10,
        select: { id: true, channel: true, sent_at: true, reminder_type: true }
      }),
      prisma.roomAllocation.findMany({
        where: { tenant_id: tenantId },
        include: { room: { select: { room_no: true } } },
        orderBy: { created_at: "desc" },
        take: 5
      }),
      prisma.move_out_requests.findMany({
        where: { tenant_id: tenantId, owner_id: ownerId },
        orderBy: { created_at: "desc" },
        take: 5
      }),
      prisma.tenant_notes.findMany({
        where: { tenant_id: tenantId, owner_id: ownerId },
        orderBy: { created_at: "desc" },
        take: 10
      }),
      // The tenant's real current agreement — previously this overview never
      // queried `agreement` at all, and the frontend's "has agreement" checks
      // fell back to room-allocation history / a `tenant_invitations` field
      // that's never actually present on this response, so every tenant
      // showed "No active agreement" regardless of having a signed one.
      prisma.agreement.findFirst({
        where: { tenant_id: tenantId, status: currentAgreementWhere() },
        orderBy: { generated_at: "desc" },
      })
    ]);

    const totalPaid = Number(paymentAgg._sum.amount_paid || 0);
    const totalDue = readModel.total_due;
    const outstanding = readModel.total_due;
    // Sourced from FinancialReadModelService — the canonical composition of
    // financialService.getTenantDues() (obligation amounts) and
    // tenantFinancialLedgerService.getBalance() (ledger balance), so this
    // response agrees field-for-field with what the tenant portal reads via
    // GET /api/tenants/me/financial-read-model for the same tenant. Was
    // previously a raw re-sum of tenant_financial_ledger entries with no
    // security-deposit-aware subtraction — the direct cause of owner/tenant
    // "Future Credit" disagreeing (see docs/business-logic/
    // financial-consistency-investigation-report.md).
    const overdueAmount = readModel.overdue_amount;
    const currentPayableAmount = readModel.current_payable_amount;
    const advanceBalance = readModel.future_rent_credit;
    const recentPayments = allPayments
      .sort((a, b) => new Date(b.payment_date).getTime() - new Date(a.payment_date).getTime())
      .slice(0, 5)
      .map(p => ({
        id: p.id,
        amount: Number(p.amount_paid),
        date: p.payment_date,
        method: p.payment_method,
        status: "paid",
        reference_number: p.reference_number
      }));

    const recentActivity = [
      ...allPayments.map((p) => ({
        id: p.id,
        type: "payment",
        title: `Payment received: ₹${Number(p.amount_paid).toLocaleString("en-IN")}`,
        detail: `Paid via ${p.payment_method || "Unknown"}`,
        date: p.payment_date,
      })),
      ...reminders.map((r) => ({
        id: r.id,
        type: "reminder",
        title: `Payment reminder sent (${r.channel})`,
        detail: `Type: ${r.reminder_type || "Standard"} · Status: SENT`,
        date: r.sent_at,
      })),
      ...allocations.map((a) => ({
        id: a.id,
        type: "allocation",
        title: `Room ${a.room?.room_no || "Unassigned"} allocated`,
        detail: `Checked in on ${a.start_date ? new Date(a.start_date).toLocaleDateString() : "unknown"}`,
        date: a.created_at,
      })),
      ...moveOuts.map((m) => ({
        id: m.id,
        type: "moveout",
        title: `Move-out request ${m.status.toLowerCase()}`,
        detail: m.reason_text || "Requested exit",
        date: m.created_at,
      })),
      ...notes.map((n) => ({
        id: n.id,
        type: "note",
        title: "Private note added",
        detail: n.content,
        date: n.created_at,
      }))
    ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 15);

    const floor = currentRoom?.floor ?? null;

    // ── Invitation summary ───────────────────────────────────────────────
    // The raw `tenant_invitations` rows are still returned below for older
    // callers, but they carry the activation `token` and force every consumer
    // to re-derive the same things. This normalized block is the shape owner
    // screens should read: no token, a ready-built activation link, the
    // reserved room (not the not-yet-existent allocation), and the delivery
    // funnel the invitation table already tracks (PENDING → OPENED →
    // ACTIVATION_STARTED) which no surface was exposing.
    const liveInvitation = (legacyTenant.tenant_invitations ?? []).find((inv: any) =>
      ["PENDING", "OPENED", "ACTIVATION_STARTED"].includes(String(inv.status))
    ) ?? legacyTenant.tenant_invitations?.[0] ?? null;

    const invitationSummary = liveInvitation
      ? {
          id: liveInvitation.id,
          status: liveInvitation.status,
          hostel_id: liveInvitation.hostel_id,
          activation_link: frontendUrl(`/activate/${liveInvitation.token}`),
          sent_at: liveInvitation.created_at,
          expires_at: liveInvitation.expires_at,
          opened_at: liveInvitation.opened_at,
          activation_started_at: liveInvitation.activation_started_at,
          cancelled_at: liveInvitation.cancelled_at,
          name: liveInvitation.name,
          email: liveInvitation.email,
          phone: liveInvitation.phone,
          notes: liveInvitation.notes,
          // How many times the owner has revised the terms — the invitation
          // table models this as a parent/child version chain.
          revision: (legacyTenant.tenant_invitations ?? []).length,
          reserved_room: liveInvitation.room
            ? {
                id: liveInvitation.room.id,
                room_no: liveInvitation.room.room_no,
                floor: liveInvitation.room.floor,
                capacity: liveInvitation.room.capacity,
              }
            : null,
          reservation_expires_at: liveInvitation.reservations?.[0]?.expires_at ?? null,
          agreement_duration_months: liveInvitation.agreement_duration_months,
          agreement_start_date: liveInvitation.agreement_start_date,
        }
      : null;

    const latestRuleAcceptance = legacyTenant.rule_acceptances?.[0] ?? null;
    const requiredDocumentTypes = String(legacyTenant.profile_type || "STUDENT").toUpperCase() === "WORKING_PROFESSIONAL"
      ? ["AADHAAR", "WORK_ID"]
      : ["AADHAAR", "COLLEGE_ID"];
    const activeDocuments = (legacyTenant.identification_documents ?? []).filter((doc: any) => requiredDocumentTypes.includes(doc.doc_type));

    return {
      id: legacyTenant.id,
      name: legacyTenant.profile?.name ?? legacyTenant.name ?? "Tenant",
      photo_url: legacyTenant.photo_url,
      phone: legacyTenant.phone_1 || legacyTenant.profile?.phone || "",
      guardian_name: legacyTenant.guardian_name,
      guardian_phone: legacyTenant.phone_2 || legacyTenant.profile?.emergency_contact || "",
      guardian_relation: legacyTenant.guardian_relation,
      email: legacyTenant.profile?.email || "",
      profile_type: legacyTenant.profile_type,
      roll_number: legacyTenant.roll_number,
      course: legacyTenant.course,
      year_of_study: legacyTenant.year_of_study,
      section: legacyTenant.section,
      branch: legacyTenant.branch,
      college_name: legacyTenant.college_name,
      gender: legacyTenant.gender,
      date_of_birth: legacyTenant.date_of_birth,
      permanent_address: legacyTenant.permanent_address,
      temporary_address: legacyTenant.temporary_address,
      room_number: currentRoom?.room_no || null,
      floor: floor,
      joined_on: legacyTenant.joined_on,
      joined_at: legacyTenant.joined_on,
      status: legacyTenant.status,
      monthly_rent: legacyTenant.monthly_rent,
      rent: Number(legacyTenant.monthly_rent),
      maintenance_charge: legacyTenant.maintenance_charge,
      maintenance_type: legacyTenant.maintenance_type,
      advance_deposit: legacyTenant.security_deposit || legacyTenant.advance_deposit,
      security_deposit: legacyTenant.security_deposit || legacyTenant.advance_deposit,
      document_verified: legacyTenant.document_verified,
      profile_completed: legacyTenant.profile_completed,
      total_paid: totalPaid,
      total_due: totalDue,
      outstanding: outstanding,
      overdue_amount: overdueAmount,
      current_payable_amount: currentPayableAmount,
      advance_balance: advanceBalance,
      recent_payments: recentPayments,
      recent_activity: recentActivity,
      current_room: currentRoom
        ? {
            id: currentRoom.id,
            room_no: currentRoom.room_no,
            floor: currentRoom.floor,
            capacity: currentRoom.capacity,
            base_rent: currentRoom.base_rent,
          }
        : null,
      tenant_invitations: legacyTenant.tenant_invitations || [],
      invitation: invitationSummary,
      // Owner screens need the tenant's hostel scope to open any hostel-scoped
      // editor (room lists, pricing defaults). It was never on this response,
      // so callers fell back to `undefined` and silently rendered empty forms.
      hostel_id: legacyTenant.hostel_id,
      payment_frequency: legacyTenant.payment_frequency || "MONTHLY",
      has_active_agreement: Boolean(currentAgreement),
      agreement_duration_months: currentAgreement?.agreement_duration_months
        ?? legacyTenant.tenant_invitations?.[0]?.agreement_duration_months
        ?? null,
      agreement_start_date: currentAgreement?.agreement_start_date
        ?? legacyTenant.tenant_invitations?.[0]?.agreement_start_date
        ?? null,
      current_agreement: currentAgreement
        ? {
            id: currentAgreement.id,
            status: currentAgreement.status,
            agreement_start_date: currentAgreement.agreement_start_date,
            agreement_end_date: currentAgreement.agreement_end_date,
            agreement_duration_months: currentAgreement.agreement_duration_months,
            contract_rent: currentAgreement.contract_rent,
            contract_security_deposit: currentAgreement.contract_security_deposit,
            pdf_url: currentAgreement.pdf_url,
          }
        : null,
      payment_summary: {
        total_paid: totalPaid,
        pending_amount: outstanding,
        outstanding,
        overdue_amount: overdueAmount,
        current_payable_amount: currentPayableAmount,
        payment_status: readModel.payment_status,
      },
      financial_summary: {
        total_paid: totalPaid,
        pending_amount: outstanding,
        outstanding,
        overdue_amount: overdueAmount,
        current_payable_amount: currentPayableAmount,
        deposit_balance: advanceBalance,
      },
      profile: legacyTenant.profile
        ? {
            id: legacyTenant.profile.id,
            name: legacyTenant.profile.name,
            email: legacyTenant.profile.email,
            phone: legacyTenant.profile.phone,
            emergency_contact: legacyTenant.profile.emergency_contact,
            is_profile_completed: legacyTenant.profile.is_profile_completed,
            phone_verified: legacyTenant.profile.phone_verified ?? legacyTenant.profile.mobile_verified ?? false,
          }
        : null,
      tenant: {
        id: legacyTenant.id,
        profile_id: legacyTenant.profile_id,
        profile_type: legacyTenant.profile_type,
        status: legacyTenant.status,
        photo_url: legacyTenant.photo_url,
        monthly_rent: legacyTenant.monthly_rent,
        maintenance_charge: legacyTenant.maintenance_charge,
        maintenance_type: legacyTenant.maintenance_type,
        advance_deposit: legacyTenant.security_deposit || legacyTenant.advance_deposit,
        security_deposit: legacyTenant.security_deposit || legacyTenant.advance_deposit,
        joined_on: legacyTenant.joined_on,
        billing_start_date: legacyTenant.billing_start_date,
        phone_1: legacyTenant.phone_1,
        phone_2: legacyTenant.phone_2,
        phone_3: legacyTenant.phone_3,
        guardian_name: legacyTenant.guardian_name,
        guardian_phone: legacyTenant.phone_2 || legacyTenant.profile?.emergency_contact || "",
        guardian_relation: legacyTenant.guardian_relation,
        gender: legacyTenant.gender,
        date_of_birth: legacyTenant.date_of_birth,
        college_name: legacyTenant.college_name,
        course: legacyTenant.course,
        year_of_study: legacyTenant.year_of_study,
        branch: legacyTenant.branch,
        section: legacyTenant.section,
        roll_number: legacyTenant.roll_number,
        office_name: legacyTenant.office_name,
        office_location: legacyTenant.office_location,
        job_role: legacyTenant.job_role,
        permanent_address: legacyTenant.permanent_address,
        temporary_address: legacyTenant.temporary_address,
        document_verified: legacyTenant.document_verified,
        mobile_verified: legacyTenant.mobile_verified,
        profile_completed: legacyTenant.profile_completed,
        room_number: currentRoom?.room_no || null,
        floor,
        current_room: currentRoom
          ? {
              id: currentRoom.id,
              room_no: currentRoom.room_no,
              floor: currentRoom.floor,
              capacity: currentRoom.capacity,
              base_rent: currentRoom.base_rent,
            }
          : null,
      },
      compliance: {
        profile_completed: Boolean(legacyTenant.profile_completed || legacyTenant.profile?.is_profile_completed),
        rules_accepted: Boolean(latestRuleAcceptance),
        rules_accepted_at: latestRuleAcceptance?.accepted_at ?? null,
        rules_version: latestRuleAcceptance?.rules_version ?? latestRuleAcceptance?.rule_version?.version ?? null,
        rule_version_id: latestRuleAcceptance?.rule_version_id ?? null,
        rules_snapshot: latestRuleAcceptance?.rules_snapshot ?? latestRuleAcceptance?.rule_version?.content ?? latestRuleAcceptance?.rule_version?.content_snapshot ?? null,
        documents_uploaded: activeDocuments.length,
        document_types: activeDocuments.map((doc: any) => doc.doc_type),
        required_document_types: requiredDocumentTypes,
        document_verification_status: legacyTenant.document_verified ? "VERIFIED" : "PENDING",
        activation_progress_percent: Math.round(([
          Boolean(legacyTenant.profile?.password_hash && (legacyTenant.phone_1 || legacyTenant.profile?.phone)),
          Boolean(latestRuleAcceptance),
          Boolean(legacyTenant.profile_completed || legacyTenant.profile?.is_profile_completed),
          legacyTenant.status === "ACTIVE",
        ].filter(Boolean).length / 4) * 100),
        activation_started_at: legacyTenant.activation_started_at ?? null,
        activation_completed_at: legacyTenant.activation_completed_at ?? null,
        onboarding_last_activity_at: legacyTenant.onboarding_last_activity_at ?? null,
        pending: {
          profile: !legacyTenant.profile_completed,
          rules: !latestRuleAcceptance,
          documents: activeDocuments.length < requiredDocumentTypes.length || !legacyTenant.document_verified,
        },
      }
    };
  }

  async createTenant(data: any, ownerId: string) {
    // Note: Profile must be created first or linked.
    return await tenantRepository.create({
      data: {
        ...data,
        owner_id: ownerId,
      },
      include: { profiles: true },
    }).then((tenant: any) => this.withLegacyTenantRelations(tenant));
  }

  async cancelInvitation(tenantId: string, ownerId: string) {
    const tenant = await tenantRepository.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        owner_id: true,
        status: true,
        tenant_invitations: {
          where: { status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED"] as any } },
          select: { id: true },
        },
        room_allocations: { where: { is_active: true, end_date: null }, select: { id: true } },
      },
    });
    const legacyTenant = this.withLegacyTenantRelations(tenant);
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: You can only manage your own tenants");
    if (tenant.status !== "INVITED") {
      throw new Error("VALIDATION: Only INVITED tenants can be cancelled. Use checkout for ACTIVE tenants.");
    }

    const now = new Date();
    const invitationIds = (tenant.tenant_invitations || []).map((invitation: any) => invitation.id);
    let releasedReservationCount = 0;
    await prisma.$transaction(async (tx: any) => {
      if (invitationIds.length > 0) {
        await tx.tenant_invitations.updateMany({
          where: { id: { in: invitationIds }, status: { in: ["PENDING", "OPENED", "ACTIVATION_STARTED"] as any } },
          data: { status: "CANCELLED" as any, cancelled_at: now, updated_at: now },
        });

        const releaseResult = await tx.tenant_invitation_reservations.updateMany({
          where: { invitation_id: { in: invitationIds }, status: "ACTIVE" },
          data: {
            status: "RELEASED" as any,
            released_by: ownerId,
            released_at: now,
            release_reason: "CANCELLED",
            updated_at: now,
          },
        });
        releasedReservationCount = releaseResult.count;
      }

      await tx.tenants.update({
        where: { id: tenantId },
        data: { status: "CANCELLED" as any },
      });
      if (legacyTenant.allocations.length > 0) {
        await tx.roomAllocation.updateMany({
          where: { tenant_id: tenantId, is_active: true, end_date: null },
          data: { is_active: false, end_date: now },
        });
      }
      // Waive all pending obligations — a cancelled invitation means
      // the tenant never moved in; no financial claims should remain.
      // Routed through ObligationEngine so any PARTIAL obligation (real
      // payments on record) gets a proper ledger correction, not just a
      // silent status flip.
      const toWaive = await tx.rent_obligations.findMany({
        where: { tenant_id: tenantId, status: { in: ["PENDING", "PARTIAL"] } },
        select: { id: true },
      });
      if (toWaive.length > 0) {
        await obligationEngine.bulkWaiveInTx(tx, {
          obligationIds: toWaive.map((o: any) => o.id),
          reason: "Invitation cancelled — tenant never moved in",
          actorId: ownerId,
        });
      }
    });

    await allocationReconciliationService.reconcileTenant(tenantId).catch((err: any) => {
      logger.error("reconcile_after_cancel_invitation_failed", {
        tenant_id: tenantId,
        error: String(err?.message || err),
      });
    });

    await eventLog.log("INVITATION_CANCELLED_BY_OWNER", ownerId, {
      tenant_id: tenantId,
      invitation_ids: invitationIds,
      released_reservation_count: releasedReservationCount,
      released_allocations: legacyTenant.allocations.length,
    }, tenantId);
    await eventSystem.trigger("tenant_status_changed", {
      owner_id: ownerId,
      tenant_id: tenantId,
      status: "CANCELLED",
    });

    return { success: true, tenant_id: tenantId, new_status: "CANCELLED" };
  }

  private async applyTenantUpdatesInTx(
    tx: any,
    tenantId: string,
    profileId: string | null | undefined,
    data: Record<string, any>
  ) {
    const profileUpdate: Record<string, any> = {};
    const tenantUpdate: Record<string, any> = {};

    for (const [key, value] of Object.entries(data)) {
      const classification = classifyTenantField(key);
      if (classification?.table === "profile") {
        profileUpdate[key] = value;
      } else if (classification?.table === "tenants") {
        if (key === "date_of_birth" || key === "joined_on" || key === "billing_start_date") {
          tenantUpdate[key] = value ? new Date(value as string) : null;
        } else {
          tenantUpdate[key] = value;
        }
      }
    }

    // Synchronize duplicate fields across profiles and tenants
    const syncedPhone = data.phone_1 || data.phone;
    if (syncedPhone) {
      profileUpdate.phone = syncedPhone;
      tenantUpdate.phone_1 = syncedPhone;
    }
    const syncedEmergency = data.phone_3 || data.emergency_contact;
    if (syncedEmergency) {
      profileUpdate.emergency_contact = syncedEmergency;
      tenantUpdate.phone_3 = syncedEmergency;
    }
    const syncedGuardian = data.phone_2 || data.guardian_phone;
    if (syncedGuardian) {
      tenantUpdate.phone_2 = syncedGuardian;
      tenantUpdate.guardian_phone = syncedGuardian;
    }

    // Apply profile updates if we have any fields and a profile_id
    if (Object.keys(profileUpdate).length > 0 && profileId) {
      await tx.profile.update({
        where: { id: profileId },
        data: profileUpdate,
      });
    }

    // Apply tenant updates
    if (Object.keys(tenantUpdate).length > 0) {
      await tx.tenants.update({
        where: { id: tenantId },
        data: tenantUpdate,
      });
    }
  }

  async updateTenant(id: string, data: any, ownerId: string) {
    const tenant = await prisma.tenants.findFirst({
      where: { id, owner_id: ownerId },
      include: {
        profiles: true,
        payments: { select: { id: true }, take: 1 },
      },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");

    if (data.status === "CANCELLED") {
      // Use dedicated cancelInvitation — it enforces INVITED-only guard
      return this.cancelInvitation(id, ownerId);
    }

    if (data.status === "FORMER_TENANT") {
      // ── GUARD: Direct FORMER_TENANT transitions are no longer allowed. ──
      // The owner MUST use the move-out workflow which enforces:
      //   inspection → settlement → payment → completion → FORMER_TENANT
      // This prevents tenants being marked FORMER_TENANT without owner review.
      throw new Error(
        "VALIDATION: Cannot set status to FORMER_TENANT directly. " +
        "Please use the Move-Out workflow (POST /api/move-out/requests) " +
        "which ensures proper inspection, settlement, and approval."
      );
    }

    const proposedGuardian = data.phone_2 || data.guardian_phone;
    if (proposedGuardian) {
      await assertGuardianPhoneNotTenant(proposedGuardian, id);
    }

    // Extract reason and metadata if provided (e.g. from PUT request or parsed data)
    const { reason, metadata, ...dataFields } = data;

    // Partition input fields by category
    const partitioned = partitionFieldsByCategory(dataFields);
    
    // Throw validation error for any unclassified fields
    const unclassifiedKeys = Object.keys(partitioned.unclassified);
    if (unclassifiedKeys.length > 0) {
      throw new Error(`VALIDATION: Unclassified fields are not allowed: ${unclassifiedKeys.join(", ")}`);
    }

    // Check for correction window
    const hasPayments = tenant.payments.length > 0;
    const correctionWindow = isInCorrectionWindow({ status: tenant.status, hasPayments });

    // Separate immediate changes vs pending changes
    let immediateChanges: Record<string, any> = {};
    let pendingChanges: Record<string, any> = {};

    if (correctionWindow) {
      // Pre-activation tenants with no payments: all fields apply immediately
      immediateChanges = {
        ...partitioned.A,
        ...partitioned.B,
        ...partitioned.C,
        ...partitioned.D,
      };
    } else {
      immediateChanges = { ...partitioned.A };
      pendingChanges = {
        ...partitioned.B,
        ...partitioned.C,
        ...partitioned.D,
      };
    }

    const hasImmediate = Object.keys(immediateChanges).length > 0;
    const hasPending = Object.keys(pendingChanges).length > 0;

    let currentTenantState = tenant;
    let applied = true;
    let crResult: any = null;

    // 1. Process immediate updates (Cat A or correction window) via facade
    if (hasImmediate) {
      const immediateResult = await changeManagementFacade.propose({
        ownerId,
        hostelId: tenant.hostel_id,
        tenantId: id,
        entityType: "tenant_profile",
        entityId: id,
        proposedChanges: immediateChanges,
        reason: reason || (correctionWindow ? "Administrative correction (pre-activation window)" : "Operational update"),
        requestedBy: ownerId,
        metadata,
      });

      // Re-fetch tenant state to get updated values
      const updated = await prisma.tenants.findUnique({
        where: { id },
        include: { profiles: true },
      });
      if (updated) {
        currentTenantState = updated as any;
      }
    }

    // 2. Process pending updates (Cat B/C/D changes outside correction window) via facade
    if (hasPending) {
      const pendingResult = await changeManagementFacade.propose({
        ownerId,
        hostelId: tenant.hostel_id,
        tenantId: id,
        entityType: "tenant_profile",
        entityId: id,
        proposedChanges: pendingChanges,
        reason: reason || "Update requires tenant verification",
        requestedBy: ownerId,
        metadata,
      });

      crResult = {
        id: pendingResult.id,
        status: pendingResult.status,
        changeCategory: pendingResult.changeCategory,
        approvalLevel: pendingResult.approvalLevel,
        message: pendingResult.message,
      };
      applied = false;
    }

    return {
      applied,
      tenant: this.withLegacyTenantRelations(currentTenantState),
      changeRequest: crResult || undefined,
    };
  }

  async deleteTenant(id: string, ownerId: string) {
    const tenant = await tenantRepository.findUnique({
      where: { id },
      select: { id: true, owner_id: true, status: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: You can only delete your own tenants");

    // Lifecycle-correct soft delete:
    // INVITED => CANCELLED (never activated, treat as cancelled invitation)
    if (tenant.status === "INVITED") {
      return this.cancelInvitation(id, ownerId);
    }

    // ACTIVE => must use move-out workflow
    if (tenant.status === "ACTIVE") {
      throw new Error(
        "VALIDATION: Cannot remove an active tenant directly. " +
        "Please use the Move-Out workflow which ensures proper " +
        "inspection, settlement calculation, and owner approval before marking as FORMER_TENANT."
      );
    }

    // FORMER_TENANT / CANCELLED — already terminal, no-op
    throw new Error(`VALIDATION: Tenant is already in terminal status: ${tenant.status}`);
  }

  async reactivateTenant(id: string, rent: number, joinedOn: Date, ownerId: string) {
    const tenant = await tenantRepository.findUnique({
      where: { id },
      select: { id: true, owner_id: true, status: true },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (tenant.owner_id !== ownerId) throw new Error("FORBIDDEN: You can only reactivate your own tenants");
    if (tenant.status !== "FORMER_TENANT") throw new Error("VALIDATION: Only tenants with FORMER_TENANT status can be reactivated");

    const updated = await tenantRepository.update({
      where: { id },
      data: {
        status: "ACTIVE",
        monthly_rent: rent,
        joined_on: joinedOn,
      },
      include: { profiles: true },
    });
    await allocationReconciliationService.reconcileTenant(id).catch((err: any) => {
      logger.error("reconcile_after_tenant_reactivate_failed", {
        tenant_id: id,
        error: String(err?.message || err),
      });
    });
    await eventSystem.trigger("tenant_status_changed", {
      owner_id: ownerId,
      tenant_id: id,
      status: "ACTIVE",
    });
    return this.withLegacyTenantRelations(updated);
  }

  async getIncrementYearPreview(hostelId: string, ownerId: string) {
    const students = await prisma.tenants.findMany({
      where: {
        hostel_id: hostelId,
        owner_id: ownerId,
        status: "ACTIVE",
        profile_type: "STUDENT",
      },
      include: {
        profiles: {
          select: {
            name: true,
          },
        },
        room_allocations: {
          where: { is_active: true, end_date: null },
          include: { room: true },
        },
      },
    });

    const toIncrement: any[] = [];
    const violators: any[] = [];
    const others: any[] = [];

    for (const student of students) {
      const roomNo = student.room_allocations?.[0]?.room?.room_no || "Unassigned";
      const name = student.profiles?.name || "Unknown Tenant";
      const year = student.year_of_study;

      if (year === null || year === undefined) {
        others.push({ id: student.id, name, roomNo, year: null });
      } else if (year >= 1 && year < 4) {
        toIncrement.push({ id: student.id, name, roomNo, currentYear: year, nextYear: year + 1 });
      } else if (year >= 4) {
        violators.push({ id: student.id, name, roomNo, year });
      } else {
        others.push({ id: student.id, name, roomNo, year });
      }
    }

    return {
      toIncrement,
      violators,
      others,
    };
  }

  async executeIncrementYear(hostelId: string, ownerId: string) {
    const preview = await this.getIncrementYearPreview(hostelId, ownerId);

    if (preview.toIncrement.length === 0) {
      return {
        success: true,
        message: "No students eligible for increment.",
        updatedCount: 0,
        skippedCount: preview.violators.length + preview.others.length,
        skippedTenants: preview.violators,
      };
    }

    const idsToIncrement = preview.toIncrement.map((s) => s.id);

    await prisma.$transaction(
      idsToIncrement.map((id) =>
        prisma.tenants.update({
          where: { id },
          data: {
            year_of_study: {
              increment: 1,
            },
          },
        })
      )
    );

    return {
      success: true,
      message: `Successfully incremented the year of study for ${idsToIncrement.length} students.`,
      updatedCount: idsToIncrement.length,
      skippedCount: preview.violators.length + preview.others.length,
      skippedTenants: preview.violators,
    };
  }
}

export const tenantService = new TenantService();
