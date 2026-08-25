import { prisma } from "../../../lib/db";
import { hashPassword } from "../../../lib/auth";
import { normalizeIndianPhone, assertGuardianPhoneNotTenant } from "../../../lib/utils/phone-utils";
import { normalizeWhatsAppPhone } from "../../../lib/services/notifications/providers/whatsapp/meta-provider";

function safeNormalizeWhatsApp(val: string | null | undefined): string {
  if (!val) return "";
  try {
    return normalizeWhatsAppPhone(val);
  } catch {
    return "";
  }
}
import { getTenantOperationalContext } from "../../../lib/hostel-context";
import { allocationReconciliationService } from "../../../lib/services/allocation-reconciliation-service";
import { eventLog } from "../../../lib/services/event-log-service";
import { eventSystem } from "../../../lib/events";
import { tenantInvitationLifecycleService } from "./tenant-invitation-lifecycle-service";
import { AgreementGenerationService } from "./agreement-generation-service";
import { currentAgreementWhere, isCurrentAgreementStatus, isSignedAgreementStatus } from "./agreement-status";
import { agreementRentScheduleService } from "../payments/agreement-rent-schedule-service";
import { financialLifecycleService } from "../payments/financial-lifecycle-service";
import { authOtpService } from "../../../lib/services/auth/auth-otp-service";
import { getActivationFinancialStatus } from "./activation-financial-status-service";
import {
  assertAgreementLifecycleComplete,
  buildOnboardingAgreementLifecycle,
} from "./agreement-lifecycle-completeness";

type ActivationStep = "ACCOUNT" | "RULES" | "AGREEMENT" | "PROFILE" | "ACTIVATE";
type ResolvedInvitation = {
  profile: any | null;
  tenant: any;
  invitation?: any | null;
  token: string;
  source?: string;
  /** How `profile` was found — see invited-profile-resolver. */
  profile_source?: string;
  /** An account owns the invitation's email but could not be safely adopted. */
  email_conflict?: { email: string } | null;
  /** When the link was delivered over WhatsApp; null means we cannot vouch. */
  whatsapp_delivered_at?: Date | null;
};

const REQUIRED_ACKNOWLEDGEMENTS = [
  "fee_refund_rules",
  "discipline_policies",
  "late_fee_obligations",
  "damage_liabilities",
  "hostel_rules",
] as const;

import { getActiveTenancy, selectCurrentTenancy } from "@/lib/tenancy/active-tenancy";
import { isPhoneAlreadyProven } from "./invitation-phone-trust";
import { resolveActivationEmail } from "./invited-profile-resolver";
import { resolveGenderRequirement } from "./identity-field-policy";
import { buildCommitmentRecord } from "./agreement-commitment";
import { isAccountSetupComplete } from "./activation-account-state";
import {
  completedApplicableSteps,
  isAgreementRequired,
  nextActivationStep,
  requiredActivationSteps,
} from "./agreement-requirement";
import {
  DEFAULT_AGREEMENT_TEMPLATE,
  DEFAULT_TERMS_AND_CONDITIONS,
  getActiveTemplateAndSyncRuleVersion,
  interpolateRulesContent
} from "../../utils/default-rules";

const DEFAULT_RULE_CONTENT = DEFAULT_AGREEMENT_TEMPLATE;


function dateOnly(value?: Date | string | null) {
  if (!value) return null;
  return new Date(value).toISOString().slice(0, 10);
}

function numberValue(value: unknown) {
  if (value == null) return 0;
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function nextRentDate(autoRentDay = 1) {
  const now = new Date();
  const day = Math.min(Math.max(Number(autoRentDay || 1), 1), 28);
  const candidate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), day));
  if (candidate <= now) return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, day));
  return candidate;
}

function parsePrefsFacilities(prefs: any) {
  const candidates = [
    prefs?.facilities,
    prefs?.included_facilities,
    prefs?.amenities,
    prefs?.hostel_facilities,
  ];
  for (const value of candidates) {
    if (Array.isArray(value)) return value.map(String).filter(Boolean);
  }
  return [];
}

function validDateOfBirth(value: unknown) {
  if (!value) return null;
  const dob = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  if (dob >= now) return null;
  if (dob.getUTCFullYear() < 1900) return null;
  return dob;
}

function compactObject<T extends Record<string, any>>(input: T) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined)) as Partial<T>;
}

function assertUniqueActivationPhones(input: {
  primary?: string | null;
  guardian?: string | null;
  emergency?: string | null;
}) {
  const phones = [
    ["Primary mobile", input.primary],
    ["Guardian mobile", input.guardian],
    ["Emergency mobile", input.emergency],
  ].filter(([, value]) => Boolean(value));

  const seen = new Map<string, string>();
  for (const [label, value] of phones) {
    const phone = String(value);
    const existing = seen.get(phone);
    if (existing) {
      throw new Error(`VALIDATION_ERROR: ${existing} and ${label} must be different numbers`);
    }
    seen.set(phone, String(label));
  }
}

async function assertUniqueRollNumberForTenant(tenant: any, rollNumber: string) {
  const normalizedRollNumber = rollNumber.trim();
  if (!normalizedRollNumber) return;

  const duplicateTenant = await prisma.tenants.findFirst({
    where: {
      id: { not: tenant.id },
      ...(tenant.owner_id ? { owner_id: tenant.owner_id } : { hostel_id: tenant.hostel_id }),
      roll_number: { equals: normalizedRollNumber, mode: "insensitive" },
      status: { not: "CANCELLED" },
    },
    select: { id: true },
  });

  if (duplicateTenant) {
    throw new Error("VALIDATION_ERROR: This roll number is already used by another tenant. Enter a unique roll number.");
  }
}

export class ActivationWorkflowService {
  private async resolveInvitation(token: string, options: { markOpened?: boolean } = {}): Promise<ResolvedInvitation> {
    const normalizedToken = String(token || "").trim();
    if (!normalizedToken) throw new Error("VALIDATION_ERROR: Activation token is required");
    const resolved = await tenantInvitationLifecycleService.resolveByToken(normalizedToken, options);
    if (resolved.tenant.status === "ACTIVE") throw new Error("ALREADY_ACTIVE: Account already active");
    if (resolved.tenant.status === "CANCELLED") throw new Error("CANCELLED: Invitation was cancelled");
    if (resolved.tenant.status === "EXPIRED") throw new Error("EXPIRED: Invitation expired");
    if (resolved.tenant.status !== "INVITED") {
      throw new Error("INVALID: Activation is not available for this tenant");
    }
    return resolved;
  }

  private async markActivity(tenant: any, eventType: string, metadata: Record<string, any> = {}) {
    const isFirstStart = !tenant.activation_started_at;
    await prisma.tenants.update({
      where: { id: tenant.id },
      data: {
        onboarding_last_activity_at: new Date(),
        ...(tenant.activation_started_at ? {} : { activation_started_at: new Date() }),
      },
    }).catch(() => undefined);

    if (eventType === "activation_started" && !isFirstStart) return;

    await eventLog.log(eventType, tenant.owner_id || null, {
      tenant_id: tenant.id,
      hostel_id: tenant.hostel_id,
      ...metadata,
    }, tenant.id);
  }

  private async getActiveRuleVersion(hostelId: string) {
    const template = await getActiveTemplateAndSyncRuleVersion(prisma, hostelId, "RESIDENCY");
    const ruleVersion = await prisma.ruleVersion.findUnique({
      where: { id: template.id },
    });
    return ruleVersion || {
      id: template.id,
      hostel_id: hostelId,
      version: `v${template.version_number}`,
      title: template.title,
      content: template.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
      content_snapshot: template.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
      is_active: true,
      active: true,
    };
  }

  private async getInterpolationVariables(profile: any, tenant: any, invitation: any) {
    const activeAllocation = tenant.room_allocations?.[0] || null;
    const room = activeAllocation?.room || invitation?.reservations?.[0]?.room || invitation?.room || null;
    const template = await getActiveTemplateAndSyncRuleVersion(prisma, tenant.hostel_id, "RESIDENCY");
    const lifecycle = buildOnboardingAgreementLifecycle({
      joiningDate: invitation?.agreement_start_date || tenant.joined_on,
      billingStartDate: tenant.billing_start_date,
      monthlyRent: tenant.monthly_rent,
      roomBaseRent: room?.base_rent,
      advanceDeposit: tenant.security_deposit,
      maintenanceCharge: tenant.maintenance_charge,
      maintenanceType: tenant.maintenance_type,
      paymentFrequency: tenant.payment_frequency,
      durationMonths: invitation?.agreement_duration_months || 12,
    });

    return {
      TENANT_NAME: profile?.name || tenant.name || invitation?.name || "Tenant",
      ROOM_NUMBER: room?.room_no ?? "N/A",
      MONTHLY_RENT: Number(lifecycle.contract_rent ?? 0),
      SECURITY_DEPOSIT_AMOUNT: Number(lifecycle.contract_security_deposit ?? 0),
      MAINTENANCE_CHARGE_AMOUNT: Number(lifecycle.contract_maintenance ?? 0),
      HOSTEL_NAME: tenant.hostels?.name || "Hostel",
      OWNER_NAME: template.owner_name,
      JOINING_DATE: dateOnly(lifecycle.agreement_start_date) || "",
    };
  }

  private rulePayload(ruleVersion: any, variables?: Record<string, any>) {
    const content = ruleVersion.content ?? ruleVersion.content_snapshot ?? DEFAULT_RULE_CONTENT;
    const interpolated = variables ? interpolateRulesContent(content, variables) : content;
    return {
      id: ruleVersion.id,
      version: ruleVersion.version,
      title: ruleVersion.title ?? "Standard Hostel Rules",
      content: interpolated,
      required_acknowledgements: REQUIRED_ACKNOWLEDGEMENTS,
    };
  }

  /**
   * `agreementRequired` is passed in rather than read off `tenant.hostels`,
   * because not every caller's query includes the hostel relation — an implicit
   * read would silently fall back to "required" and make the setting look broken
   * on some paths but not others.
   */
  private computeState(profile: any, tenant: any, ruleVersion: any, agreementRequired: boolean) {
    const latestAcceptance = (tenant.rule_acceptances || []).find((a: any) => a.rule_version_id === ruleVersion.id);
    // See activation-account-state for why this tests `profile_id` and not
    // merely a verified number — it is the 2026-08-25 regression in one line.
    const accountSetupCompleted = isAccountSetupComplete({ tenant, profile });
    const missingTier1: string[] = [];
    if (!(tenant.phone_1 || profile?.phone)) missingTier1.push("phone");
    if (!tenant.gender) missingTier1.push("gender");
    if (!tenant.date_of_birth) missingTier1.push("date_of_birth");
    // emergency_phone (phone_3) intentionally NOT tier-1: removed from the
    // Identity screen's collected fields (ADR-070 amendment), so it is never
    // populated by the current flow — treating it as required here made
    // profile_completed permanently unreachable for every tenant. It remains
    // tracked in optionalMissingFields() below (tier 3).
    if (!tenant.photo_url) missingTier1.push("photo_url");

    const profileCompleted = missingTier1.length === 0;
    const rulesAccepted = Boolean(latestAcceptance);
    const agreementSigned = (tenant.agreements || []).some((a: any) => isSignedAgreementStatus(a.status));
    const requiredDocumentTypes = this.requiredDocumentTypes(tenant.profile_type);
    const requiredDocuments = (tenant.identification_documents || []).filter((doc: any) =>
      requiredDocumentTypes.includes(doc.doc_type)
    );
    const documentsUploaded = requiredDocuments.length > 0;
    const activationCompleted = tenant.status === "ACTIVE";
    const startedAt = tenant.activation_started_at || tenant.created_at || null;
    const completedAt = tenant.activation_completed_at || null;
    const durationSeconds = startedAt && completedAt
      ? Math.max(0, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 1000))
      : null;

    // Progression skips the steps this hostel does not ask for. The raw
    // `rules_accepted` / `agreement_signed` booleans below stay truthful — a
    // skipped ceremony is reported as not done, not faked as complete — while
    // the sequence and progress only count applicable steps.
    const completion = { accountSetupCompleted, rulesAccepted, agreementSigned, profileCompleted, activationCompleted };
    const applicableSteps = requiredActivationSteps(agreementRequired);
    const completedSteps = completedApplicableSteps(completion, agreementRequired);
    const currentStep = nextActivationStep(completion, agreementRequired);

    return {
      account_setup_completed: accountSetupCompleted,
      rules_accepted: rulesAccepted,
      agreement_signed: agreementSigned,
      profile_completed: profileCompleted,
      documents_uploaded: documentsUploaded,
      activation_completed: activationCompleted,
      current_step: currentStep,
      completed_steps: completedSteps,
      agreement_required: agreementRequired,
      blocked_steps: this.blockedSteps({ accountSetupCompleted, rulesAccepted, agreementSigned, profileCompleted }, agreementRequired),
      missing_fields: {
        tier_1_required: missingTier1,
        tier_2_recommended: this.recommendedMissingFields(tenant),
        tier_3_optional: this.optionalMissingFields(tenant),
      },
      acceptance: latestAcceptance
        ? {
          accepted_at: latestAcceptance.accepted_at,
          rules_version: latestAcceptance.rules_version,
          rule_version_id: latestAcceptance.rule_version_id,
        }
        : null,
      // Out of the steps this hostel actually requires, not a fixed 5 — a
      // skipped-agreement tenant would otherwise cap at 60%.
      progress_percent: Math.round((completedSteps.length / applicableSteps.length) * 100),
      activation_started_at: startedAt,
      activation_completed_at: completedAt,
      onboarding_last_activity_at: tenant.onboarding_last_activity_at || null,
      activation_duration_seconds: durationSeconds,
    };
  }

  private blockedSteps(
    flags: { accountSetupCompleted: boolean; rulesAccepted: boolean; agreementSigned: boolean; profileCompleted: boolean },
    agreementRequired: boolean,
  ) {
    const blocked: ActivationStep[] = [];
    if (!flags.accountSetupCompleted) blocked.push("RULES", "PROFILE", "AGREEMENT", "ACTIVATE");
    else if (agreementRequired && !flags.rulesAccepted) blocked.push("PROFILE", "AGREEMENT", "ACTIVATE");
    else if (!flags.profileCompleted) blocked.push("AGREEMENT", "ACTIVATE");
    else if (agreementRequired && !flags.agreementSigned) blocked.push("ACTIVATE");
    // The ceremony steps themselves are unreachable when not required, so they
    // are reported blocked rather than presented as available.
    if (!agreementRequired) blocked.push("RULES", "AGREEMENT");
    return Array.from(new Set(blocked));
  }

  private recommendedMissingFields(tenant: any) {
    const missing: string[] = [];
    if (!tenant.permanent_address) missing.push("permanent_address");
    const profileType = String(tenant.profile_type || "STUDENT").toUpperCase();
    if (profileType === "STUDENT") {
      if (!tenant.college_name) missing.push("college_name");
      if (!tenant.course) missing.push("course");
      if (!tenant.roll_number) missing.push("roll_number");
    } else {
      if (!tenant.office_name) missing.push("office_name");
      if (!tenant.office_location) missing.push("office_location");
      if (!tenant.job_role) missing.push("job_role");
    }
    return missing;
  }

  private optionalMissingFields(tenant: any) {
    return [
      !tenant.photo_url && "photo_url",
      !tenant.phone_2 && "guardian_phone",
      !tenant.phone_3 && "emergency_phone",
      !tenant.guardian_name && "guardian_name",
      !tenant.guardian_relation && "guardian_relation",
    ].filter(Boolean);
  }

  /**
   * The owner's read-only view of where an invited tenant is stuck.
   *
   * Reuses `computeState()` — the activation state machine itself — rather
   * than re-deriving any of it, so the owner's screen and the tenant's wizard
   * can never disagree about which step is current.
   *
   * Deliberately NOT built on `getContext(token)`, for two reasons:
   *
   *  1. `getContext` is keyed by the tenant's activation token, which is the
   *     tenant's secret; an owner does not have it and must not need it.
   *  2. `getContext` mutates. It resolves with `markOpened: true` (marking the
   *     invitation OPENED) and **auto-accepts the hostel rules** on the
   *     tenant's behalf when they haven't been accepted yet. An owner opening
   *     a progress screen would silently complete a step for the tenant and
   *     corrupt the very state they were trying to look at.
   *
   * This method therefore loads the same records, owner-scoped, and calls the
   * same state machine — with no writes on any path.
   *
   * KYC is intentionally absent from the step logic: `document_verified` is a
   * separate state machine and never gates activation. `documents_uploaded` is
   * reported for display only.
   */
  async getOwnerActivationState(tenantId: string, ownerId: string) {
    const tenant = await prisma.tenants.findFirst({
      where: { id: tenantId, owner_id: ownerId },
      include: {
        profiles: true,
        hostels: true,
        rule_acceptances: { orderBy: { accepted_at: "desc" }, take: 5 },
        agreements: { orderBy: { generated_at: "desc" }, take: 5 },
        identification_documents: { where: { is_active: true }, orderBy: { created_at: "desc" } },
      },
    });
    if (!tenant) throw new Error("NOT_FOUND: Tenant not found");
    if (!tenant.hostel_id) throw new Error("INTERNAL_ERROR: Tenant hostel context unavailable");

    const ruleVersion = await this.getActiveRuleVersion(tenant.hostel_id);

    return this.computeState(
      (tenant as any).profiles,
      tenant,
      ruleVersion,
      await this.resolveAgreementRequired(tenant.hostel_id),
    );
  }

  async getContext(token: string) {
    const resolvedContext = await this.resolveInvitation(token, { markOpened: true });
    const { profile, tenant, invitation } = resolvedContext;
    const hostel = tenant.hostels;
    if (!tenant.hostel_id || !hostel) throw new Error("INTERNAL_ERROR: Tenant hostel context unavailable");
    const ruleVersion = await this.getActiveRuleVersion(tenant.hostel_id);

    // Auto-accept rules if not accepted
    if (ruleVersion) {
      const latestAcceptance = (tenant.rule_acceptances || []).find((a: any) => a.rule_version_id === ruleVersion.id);
      if (!latestAcceptance) {
        const variables = await this.getInterpolationVariables(profile, tenant, invitation);
        const rulesSnapshot = this.rulePayload(ruleVersion, variables);
        try {
          if (prisma.tenantPolicyAcceptance) {
            await prisma.tenantPolicyAcceptance.create({
              data: {
                tenant_id: tenant.id,
                hostel_id: tenant.hostel_id,
                rule_version_id: ruleVersion.id,
                rules_version: ruleVersion.version,
                rules_snapshot: rulesSnapshot,
                accepted_ip: "127.0.0.1",
                accepted_user_agent: "System Auto-Accept",
                typed_signature_name: profile?.name || invitation?.name || "Tenant",
              },
            });
          }
          tenant.rule_acceptances = [
            { rule_version_id: ruleVersion.id, accepted_at: new Date(), rules_version: ruleVersion.version },
            ...(tenant.rule_acceptances || [])
          ];
        } catch (error: any) {
          if (error?.code !== "P2002") console.error("Auto-accept rules failed in getContext:", error);
        }
      }
    }

    let prefs: any = {};
    try {
      prefs = (await getTenantOperationalContext(tenant.id, tenant.owner_id, tenant.hostel_id)).prefs || {};
    } catch {
      prefs = {};
    }

    const activeAllocation = tenant.room_allocations?.[0] || null;
    const activeReservation = invitation?.reservations?.[0] || null;
    const room = activeAllocation?.room || activeReservation?.room || invitation?.room || null;
    const roommateCount = room
      ? await prisma.roomAllocation.count({
        where: { room_id: room.id, is_active: true, end_date: null, tenant_id: { not: tenant.id } },
      })
      : 0;

    // Ensure we have an active template for this hostel.
    // If not, create a default template.
    let activeTemplate = await prisma.agreementTemplate.findFirst({
      where: { hostel_id: tenant.hostel_id, is_active: true },
      orderBy: { created_at: "desc" },
    });
    if (!activeTemplate) {
      activeTemplate = await prisma.agreementTemplate.create({
        data: {
          id: crypto.randomUUID(),
          hostel_id: tenant.hostel_id,
          version: "v1-default",
          title: "Standard Tenant Agreement",
          owner_name: hostel.profiles?.name || "Hostel Owner",
          custom_rules: "",
          is_active: true,
        }
      });
    }

    // Ensure we have an active agreement (either DRAFT or SIGNED)
    let activeAgreement = (tenant.agreements || []).find((a: any) => a.status === "DRAFT" || isCurrentAgreementStatus(a.status));
    if (!activeAgreement) {
      const lifecycle = buildOnboardingAgreementLifecycle({
        joiningDate: invitation?.agreement_start_date || tenant.joined_on,
        billingStartDate: tenant.billing_start_date,
        monthlyRent: tenant.monthly_rent,
        roomBaseRent: room?.base_rent,
        advanceDeposit: tenant.security_deposit,
        maintenanceCharge: tenant.maintenance_charge,
        maintenanceType: tenant.maintenance_type,
        paymentFrequency: tenant.payment_frequency,
        durationMonths: invitation?.agreement_duration_months || 12,
      });

      const variables = {
        TENANT_NAME: profile?.name || invitation?.name || "Tenant",
        ROOM_NUMBER: room?.room_no ?? "N/A",
        MONTHLY_RENT: Number(lifecycle.contract_rent ?? 0),
        SECURITY_DEPOSIT_AMOUNT: Number(lifecycle.contract_security_deposit ?? 0),
        MAINTENANCE_CHARGE_AMOUNT: Number(lifecycle.contract_maintenance ?? 0),
        HOSTEL_NAME: hostel.name,
        OWNER_NAME: activeTemplate.owner_name,
        JOINING_DATE: dateOnly(lifecycle.agreement_start_date) || "",
      };

      activeAgreement = await prisma.agreement.create({
        data: {
          id: crypto.randomUUID(),
          tenant_id: tenant.id,
          hostel_id: tenant.hostel_id,
          template_id: activeTemplate.id,
          status: "DRAFT",
          ...lifecycle,
          rules_snapshot: ruleVersion ? (ruleVersion.content || ruleVersion.content_snapshot || DEFAULT_RULE_CONTENT) : DEFAULT_RULE_CONTENT,
          rule_version_id: ruleVersion?.id || null,
          rule_version_number: ruleVersion?.version || null,
          content_snapshot: {
            template_id: activeTemplate.id,
            template_version_number: activeTemplate.version_number,
            template_published_at: activeTemplate.published_at,
            template_name: activeTemplate.title,
            template_type: activeTemplate.type,
            hostel_name: hostel.name,
            room_number: room?.room_no ?? "N/A",
            monthly_rent: variables.MONTHLY_RENT,
            advance_deposit: variables.SECURITY_DEPOSIT_AMOUNT,
            maintenance_charge: variables.MAINTENANCE_CHARGE_AMOUNT,
            maintenance_type: lifecycle.contract_maintenance_type,
            joining_date: variables.JOINING_DATE,
            agreement_start_date: dateOnly(lifecycle.agreement_start_date),
            agreement_end_date: dateOnly(lifecycle.agreement_end_date),
            agreement_duration_months: lifecycle.agreement_duration_months,
            payment_frequency: lifecycle.contract_payment_frequency,
            tenant_name: variables.TENANT_NAME,
            // Frozen here rather than read live at render time. Phase B made
            // identity person-level and editable from a profile screen, so
            // without this an old agreement's regenerated PDF would print
            // whatever address the tenant last saved — not what they signed.
            permanent_address: tenant.permanent_address ?? null,
            tenant_email: tenant.personal_email ?? null,
            tenant_phone: tenant.phone_1 ?? null,
            owner_name: activeTemplate.owner_name,
            custom_rules: activeTemplate.custom_rules || "",
            terms_and_conditions: (activeTemplate.rules_content as any)?.terms_and_conditions || DEFAULT_TERMS_AND_CONDITIONS,
            raw_rules: activeTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
            interpolated_rules: interpolateRulesContent(activeTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE, variables),
            hostel_rules: interpolateRulesContent(activeTemplate.rules_content || DEFAULT_AGREEMENT_TEMPLATE, variables),
          }
        },
      });
      // Inject the newly created draft agreement so computeState reads it correctly
      tenant.agreements = [activeAgreement, ...(tenant.agreements || [])];
    }

    const state = this.computeState(profile, tenant, ruleVersion, await this.resolveAgreementRequired(tenant.hostel_id));
    const activationFinancialStatus = await getActivationFinancialStatus(tenant.id);
    const requiredDocumentTypes = this.requiredDocumentTypes(tenant.profile_type);
    const requiredDocuments = (tenant.identification_documents || []).filter((doc: any) =>
      requiredDocumentTypes.includes(doc.doc_type)
    );

    const gPhone = safeNormalizeWhatsApp(tenant.phone_2 || tenant.guardian_phone);
    const ePhone = safeNormalizeWhatsApp(tenant.phone_3 || tenant.emergency_contact);

    const guardianVerifiedRecord = gPhone
      ? await prisma.phoneVerificationOtp.findFirst({
        where: {
          phone: gPhone,
          purpose: "ParentVerify",
          status: "VERIFIED",
        },
      })
      : null;

    const emergencyVerifiedRecord = ePhone
      ? await prisma.phoneVerificationOtp.findFirst({
        where: {
          phone: ePhone,
          purpose: "EmergencyVerification",
          status: "VERIFIED",
        },
      })
      : null;

    return {
      token_status: "VALID",
      verification_status: {
        guardian_verified: guardianVerifiedRecord ? true : false,
        emergency_verified: emergencyVerifiedRecord ? true : false,
      },
      activation_state: state,
      activation_financial_status: activationFinancialStatus,
      current_step: state.current_step,
      completed_steps: state.completed_steps,
      blocked_steps: state.blocked_steps,
      missing_fields: state.missing_fields,
      profile: {
        id: profile?.id || null,
        name: profile?.name || invitation?.name || null,
        email: profile?.email || invitation?.email || null,
        phone: profile?.phone || invitation?.phone || tenant.phone_1 || null,
      },
      /**
       * The number the invitation was addressed to, and whether we can already
       * vouch for it. The Identity screen uses these to decide whether to ask
       * for an OTP at all: it does not, unless the invitee edits the number
       * away from `phone` below. Computed here so one rule serves both the
       * screen and the mutation that validates it.
       */
      /**
       * Which identity fields the screen still has to render. Gender is not
       * asked when the hostel's own type already establishes it — see
       * identity-field-policy. Computed server-side so the form and the
       * validation that accepts it cannot drift apart.
       */
      /**
       * When this link stops working, so the tenant can see it rather than
       * discover it. `held` is the important half: `resolveByToken` skips the
       * expiry check once the status is ACTIVATION_STARTED, so someone who has
       * begun is not on a clock at all — showing them one would be a deadline
       * that does not exist.
       */
      link_expiry: {
        expires_at: invitation?.expires_at ? new Date(invitation.expires_at).toISOString() : null,
        held: invitation?.status === "ACTIVATION_STARTED",
      },
      identity_fields: resolveGenderRequirement({
        tenantGender: tenant.gender,
        hostelType: hostel?.hostel_type,
      }),
      phone_trust: {
        phone: invitation?.phone ? normalizeIndianPhone(invitation.phone) : (tenant.phone_1 || null),
        trusted: isPhoneAlreadyProven({
          submittedPhone: (invitation?.phone ? normalizeIndianPhone(invitation.phone) : tenant.phone_1) || "",
          profile,
          tenant,
          invitationPhone: invitation?.phone ? normalizeIndianPhone(invitation.phone) : null,
          whatsappDeliveredAt: resolvedContext?.whatsapp_delivered_at ?? null,
        }),
      },
      tenant: {
        id: tenant.id,
        profile_type: tenant.profile_type,
        status: tenant.status,
        photo_url: tenant.photo_url,
        phone_1: tenant.phone_1,
        phone_2: tenant.phone_2,
        phone_3: tenant.phone_3,
        guardian_name: tenant.guardian_name,
        guardian_phone: tenant.guardian_phone,
        guardian_relation: tenant.guardian_relation,
        gender: tenant.gender,
        date_of_birth: dateOnly(tenant.date_of_birth),
        permanent_address: tenant.permanent_address,
        temporary_address: tenant.temporary_address,
        college_name: tenant.college_name,
        course: tenant.course,
        year_of_study: tenant.year_of_study,
        branch: tenant.branch,
        roll_number: tenant.roll_number,
        office_name: tenant.office_name,
        office_location: tenant.office_location,
        job_role: tenant.job_role,
      },
      hostel: {
        id: hostel.id,
        name: hostel.name,
        logo_url: hostel.logo_url,
        address: [hostel.address, hostel.city, hostel.state, hostel.pincode].filter(Boolean).join(", "),
        phone: hostel.phone,
      },
      room_summary: {
        hostel_name: hostel.name,
        room_number: room?.room_no ?? null,
        floor: room?.floor ?? null,
        capacity: room?.capacity ?? null,
        current_occupancy: room ? roommateCount + 1 : null,
        roommates_count: roommateCount,
        monthly_rent: numberValue(tenant.monthly_rent ?? room?.base_rent),
        maintenance_charge: numberValue(tenant.maintenance_charge),
        maintenance_type: tenant.maintenance_type,
        advance_deposit: numberValue(tenant.security_deposit),
        billing_start_date: dateOnly(tenant.billing_start_date),
        joining_date: dateOnly(tenant.joined_on),
        payment_due_cycle: hostel.rent_cycle || prefs.rent_cycle || "MONTHLY",
        next_rent_generation_date: dateOnly(nextRentDate(hostel.auto_rent_day || prefs.auto_rent_day || 1)),
        included_facilities: parsePrefsFacilities(prefs),
        wifi_available: Boolean(room?.wifi_name),
      },
      rules: this.rulePayload(ruleVersion),
      documents: {
        uploaded_count: requiredDocuments.length,
        uploaded_types: requiredDocuments.map((d: any) => d.doc_type),
        verification_status: tenant.document_verified ? "VERIFIED" : "PENDING",
        required_after_activation: requiredDocumentTypes,
      },
      agreement: activeAgreement ? {
        id: activeAgreement.id,
        status: activeAgreement.status,
        pdf_url: activeAgreement.pdf_url,
        content_snapshot: activeAgreement.content_snapshot,
        tenant_signature_url: activeAgreement.tenant_signature_url,
        tenant_signature_name: activeAgreement.tenant_signature_name,
        tenant_signed_at: activeAgreement.tenant_signed_at,
        guardian_signature_url: activeAgreement.guardian_signature_url,
        guardian_signature_name: activeAgreement.guardian_signature_name,
        guardian_relation: activeAgreement.guardian_relation,
        guardian_signed_at: activeAgreement.guardian_signed_at,
        owner_signature_url: activeAgreement.owner_signature_url,
        owner_signature_name: activeAgreement.owner_signature_name,
        owner_signed_at: activeAgreement.owner_signed_at,
        /**
         * The term the owner set. Stored since the agreement was drafted but
         * never sent to the tenant, so the Agreement screen asked people to
         * sign an 11-month commitment without the words "11 months" appearing
         * anywhere on it. Both sides of the deal ride here: what the tenant
         * commits to (the term) and what the hostel commits to (a held bed at
         * a rent that does not move, and a refundable deposit).
         */
        term: {
          duration_months: activeAgreement.agreement_duration_months ?? null,
          start_date: dateOnly(activeAgreement.agreement_start_date),
          end_date: dateOnly(activeAgreement.agreement_end_date),
          monthly_rent: activeAgreement.contract_rent != null ? Number(activeAgreement.contract_rent) : null,
          security_deposit:
            activeAgreement.contract_security_deposit != null
              ? Number(activeAgreement.contract_security_deposit)
              : null,
        },
        /** Present once the tenant has given their word — see signAgreement. */
        commitment: (activeAgreement.content_snapshot as any)?.commitment ?? null,
      } : null,
      template: {
        id: activeTemplate.id,
        title: activeTemplate.title,
        custom_rules: activeTemplate.custom_rules,
        owner_name: activeTemplate.owner_name,
        owner_signature_url: activeTemplate.owner_signature_url,
      },
    };
  }

  private requiredDocumentTypes(profileType?: string | null) {
    return String(profileType || "STUDENT").toUpperCase() === "WORKING_PROFESSIONAL"
      ? ["AADHAAR", "WORK_ID"]
      : ["AADHAAR", "COLLEGE_ID"];
  }

  async mutate(token: string, step: ActivationStep, data: any, context: { ip: string; userAgent: string }) {
    if (!["ACCOUNT", "RULES", "AGREEMENT", "PROFILE", "ACTIVATE"].includes(step)) {
      throw new Error("VALIDATION_ERROR: Unsupported activation step");
    }
    const resolved = await this.resolveInvitation(token);
    const { profile, tenant, invitation } = resolved;
    if (!tenant.hostel_id) throw new Error("INTERNAL_ERROR: Tenant hostel context unavailable");
    const ruleVersion = await this.getActiveRuleVersion(tenant.hostel_id);

    // Auto-accept rules if not accepted
    if (ruleVersion) {
      const latestAcceptance = (tenant.rule_acceptances || []).find((a: any) => a.rule_version_id === ruleVersion.id);
      if (!latestAcceptance) {
        const variables = await this.getInterpolationVariables(profile, tenant, invitation);
        const rulesSnapshot = this.rulePayload(ruleVersion, variables);
        try {
          if (prisma.tenantPolicyAcceptance) {
            await prisma.tenantPolicyAcceptance.create({
              data: {
                tenant_id: tenant.id,
                hostel_id: tenant.hostel_id,
                rule_version_id: ruleVersion.id,
                rules_version: ruleVersion.version,
                rules_snapshot: rulesSnapshot,
                accepted_ip: context.ip || "127.0.0.1",
                accepted_user_agent: context.userAgent || "System Auto-Accept",
                typed_signature_name: profile?.name || invitation?.name || "Tenant",
              },
            });
          }
          tenant.rule_acceptances = [
            { rule_version_id: ruleVersion.id, accepted_at: new Date(), rules_version: ruleVersion.version },
            ...(tenant.rule_acceptances || [])
          ];
        } catch (error: any) {
          if (error?.code !== "P2002") console.error("Auto-accept rules failed in mutate:", error);
        }
      }
    }

    const state = this.computeState(profile, tenant, ruleVersion, await this.resolveAgreementRequired(tenant.hostel_id));
    this.assertTransition(step, state);

    if (step === "ACCOUNT") {
      await this.saveAccount(profile, tenant, data, token, invitation, resolved);
    }
    if (step === "RULES") {
      await this.acceptRules(profile, tenant, data, context, invitation);
    }
    if (step === "AGREEMENT") {
      await this.signAgreement(profile, tenant, data, context, invitation);
    }
    if (step === "PROFILE") {
      await this.saveProfile(profile, tenant, data);
    }
    if (step === "ACTIVATE") {
      await this.activate(profile, tenant, data, invitation);
      const requiredDocumentTypes = this.requiredDocumentTypes(tenant.profile_type);

      // Auto-login: generate session & tokens for the newly activated tenant
      const { authService } = await import("../../../lib/services/auth-service");
      const updatedProfile = await prisma.profile.findUnique({
        where: { id: profile.id },
      });
      // ADR-031: createSessionAndTokens now provisions/links the tenant's
      // Supabase identity, which needs the plaintext password they just
      // set — available here (ACTIVATE step's own data), never persisted
      // beyond this call. A newly activated tenant is therefore born
      // linked, same as owner self-signup.
      const activationPassword = typeof data.password === "string" ? data.password : undefined;
      const activatedTenancy: any = updatedProfile ? await getActiveTenancy(updatedProfile.id) : null;
      const sessionResult = updatedProfile && activationPassword ? await authService.createSessionAndTokens(
        updatedProfile,
        activatedTenancy?.id || null,
        activatedTenancy?.profile_completed || false,
        { ipAddress: context.ip, userAgent: context.userAgent },
        activationPassword,
        activatedTenancy?.status || null
      ) : null;

      return {
        activation_state: {
          account_setup_completed: true,
          rules_accepted: true,
          agreement_signed: true,
          profile_completed: true,
          documents_uploaded: (tenant.identification_documents || []).some((doc: any) =>
            requiredDocumentTypes.includes(doc.doc_type)
          ),
          activation_completed: true,
        },
        redirect_to: "/tenant/dashboard",
        session: sessionResult,
      };
    }

    return this.getContext(token);
  }

  private assertTransition(step: ActivationStep, state: any) {
    // A hostel that does not require an agreement has no rules/agreement steps
    // to gate on, and attempting them is itself invalid.
    const agreementRequired = state.agreement_required !== false;

    if (!agreementRequired && (step === "RULES" || step === "AGREEMENT")) {
      throw new Error("INVALID_TRANSITION: This hostel does not require a tenant agreement");
    }

    if (step === "RULES" && !state.account_setup_completed) {
      throw new Error("INVALID_TRANSITION: Complete account setup before accepting rules");
    }
    if (step === "PROFILE" && !state.account_setup_completed) {
      throw new Error("INVALID_TRANSITION: Complete account setup before profile completion");
    }
    if (agreementRequired && step === "PROFILE" && !state.rules_accepted) {
      throw new Error("INVALID_TRANSITION: Accept hostel rules before profile completion");
    }
    if (step === "AGREEMENT" && !state.rules_accepted) {
      throw new Error("INVALID_TRANSITION: Accept rules before signing agreement");
    }
    // ADR-070: profile precedes agreement — a tenant completes their identity
    // profile before reviewing and signing the residency agreement.
    if (agreementRequired && step === "AGREEMENT" && !state.profile_completed) {
      throw new Error("INVALID_TRANSITION: Complete your profile before signing agreement");
    }
    if (step === "ACTIVATE") {
      if (!state.account_setup_completed) throw new Error("INVALID_TRANSITION: Account setup is incomplete");
      if (agreementRequired && !state.rules_accepted) throw new Error("INVALID_TRANSITION: Rules must be accepted before activation");
      if (!state.profile_completed) throw new Error("INVALID_TRANSITION: Required profile fields are incomplete");
      if (agreementRequired && !state.agreement_signed) throw new Error("INVALID_TRANSITION: Agreement must be signed before activation");
    }
  }

  /**
   * Whether this hostel requires the agreement ceremony.
   *
   * Read by id with a narrow select rather than from an included relation, so
   * every call site gets the same answer regardless of how it loaded the tenant.
   */
  private async resolveAgreementRequired(hostelId: string): Promise<boolean> {
    const hostel = await prisma.hostels.findUnique({
      where: { id: hostelId },
      select: { preferences_config: true },
    });
    return isAgreementRequired(hostel?.preferences_config);
  }

  private async signAgreement(profile: any, tenant: any, data: any, context: { ip: string; userAgent: string }, invitation?: any) {
    const tenantSigUrl = String(data?.tenant_signature_url || "").trim();
    const tenantSigName = String(data?.tenant_signature_name || "").trim();

    const guardianSigUrl = data?.guardian_signature_url ? String(data.guardian_signature_url).trim() : "";
    const guardianSigName = data?.guardian_signature_name ? String(data.guardian_signature_name).trim() : "";
    const guardianRelation = data?.guardian_relation ? String(data.guardian_relation).trim() : null;

    const hasTenantSignature = Boolean(tenantSigUrl && tenantSigName);
    const hasGuardianSignature = Boolean(guardianSigUrl && guardianSigName && guardianRelation);
    const tenantSignatureStarted = Boolean(tenantSigUrl || tenantSigName);
    const guardianSignatureStarted = Boolean(guardianSigUrl || guardianSigName);

    if (tenantSignatureStarted && !tenantSigUrl) {
      throw new Error("VALIDATION_ERROR: Tenant signature is required");
    }
    if (tenantSignatureStarted && !tenantSigName) {
      throw new Error("VALIDATION_ERROR: Tenant typed signature name is required");
    }

    if (guardianSignatureStarted) {
      if (!guardianSigUrl) throw new Error("VALIDATION_ERROR: Parent/Guardian signature is required");
      if (!guardianSigName) throw new Error("VALIDATION_ERROR: Parent/Guardian typed signature name is required");
      if (!guardianRelation) throw new Error("VALIDATION_ERROR: Parent/Guardian relationship is required");
    }

    if (!hasTenantSignature && !hasGuardianSignature) {
      throw new Error("VALIDATION_ERROR: At least one signature is required. Add tenant or parent/guardian signature.");
    }

    const template = await getActiveTemplateAndSyncRuleVersion(prisma, tenant.hostel_id, "RESIDENCY");

    let draft = await prisma.agreement.findFirst({
      where: { tenant_id: tenant.id, status: "DRAFT" },
      orderBy: { generated_at: "desc" },
    });
    if (!draft) {
      draft = await prisma.agreement.findFirst({
        where: { tenant_id: tenant.id, status: currentAgreementWhere() },
        orderBy: { generated_at: "desc" },
      });
    }
    if (!draft) throw new Error("INTERNAL_ERROR: Draft agreement not found");

    const ruleVersion = await this.getActiveRuleVersion(tenant.hostel_id);
    const now = new Date();
    const activeAllocation = tenant.room_allocations?.[0] || null;
    const room = activeAllocation?.room || null;
    const lifecycle = buildOnboardingAgreementLifecycle({
      joiningDate: invitation?.agreement_start_date || tenant.joined_on,
      billingStartDate: tenant.billing_start_date,
      monthlyRent: tenant.monthly_rent,
      roomBaseRent: room?.base_rent,
      advanceDeposit: tenant.security_deposit,
      maintenanceCharge: tenant.maintenance_charge,
      maintenanceType: tenant.maintenance_type,
      paymentFrequency: tenant.payment_frequency,
      durationMonths: invitation?.agreement_duration_months || 12,
    });
    assertAgreementLifecycleComplete({ ...draft, ...lifecycle }, { agreementId: draft.id });

    // The tenant's explicit word on the term. Validated against the lifecycle
    // just computed rather than anything the client sent, so the commitment is
    // recorded against the real dates and not a length the browser proposed.
    // Null when the agreement has no stateable duration — that hostel signs
    // exactly as it did before. See agreement-commitment.
    const commitment = buildCommitmentRecord({
      hostelName: tenant.hostels?.name || "",
      term: {
        durationMonths: (lifecycle as any).agreement_duration_months ?? null,
        startDate: dateOnly((lifecycle as any).agreement_start_date),
        endDate: dateOnly((lifecycle as any).agreement_end_date),
      },
      acknowledgement: data?.commitment,
      now,
      ip: context.ip,
      userAgent: context.userAgent,
    });

    const variables = {
      TENANT_NAME: profile?.name || tenant.name || "Tenant",
      ROOM_NUMBER: room?.room_no ?? "N/A",
      MONTHLY_RENT: Number(lifecycle.contract_rent ?? 0),
      SECURITY_DEPOSIT_AMOUNT: Number(lifecycle.contract_security_deposit ?? 0),
      MAINTENANCE_CHARGE_AMOUNT: Number(lifecycle.contract_maintenance ?? 0),
      HOSTEL_NAME: tenant.hostels?.name || "Hostel",
      OWNER_NAME: template.owner_name,
      JOINING_DATE: dateOnly(lifecycle.agreement_start_date) || "",
    };

    const signedAgreement = await prisma.$transaction(async (tx: any) => {
      const agreement = await tx.agreement.update({
        where: { id: draft.id },
        data: {
          status: "SIGNED",
          ...lifecycle,
          signed_at: now,
          tenant_signature_url: hasTenantSignature ? tenantSigUrl : null,
          tenant_signature_name: hasTenantSignature ? tenantSigName : null,
          tenant_signed_at: hasTenantSignature ? now : null,
          tenant_ip: hasTenantSignature ? context.ip : null,
          tenant_user_agent: hasTenantSignature ? context.userAgent : null,

          guardian_signature_url: hasGuardianSignature ? guardianSigUrl : null,
          guardian_signature_name: hasGuardianSignature ? guardianSigName : null,
          guardian_relation: hasGuardianSignature ? guardianRelation : null,
          guardian_signed_at: hasGuardianSignature ? now : null,
          guardian_ip: hasGuardianSignature ? context.ip : null,
          guardian_user_agent: hasGuardianSignature ? context.userAgent : null,

          owner_signature_url: template.owner_signature_url,
          owner_signature_name: template.owner_name,
          owner_signed_at: now,

          rules_snapshot: ruleVersion
            ? interpolateRulesContent(ruleVersion.content || ruleVersion.content_snapshot || DEFAULT_RULE_CONTENT, variables, true)
            : interpolateRulesContent(DEFAULT_RULE_CONTENT, variables, true),
          rule_version_id: ruleVersion?.id || null,
          rule_version_number: ruleVersion?.version || null,

          content_snapshot: {
            ...(draft.content_snapshot as any || {}),
            // The tenant's word on the term, with the exact sentence they were
            // shown. Lives in the snapshot rather than a new column: this Json
            // is already "the resolved snapshot of everything", and migrations
            // here are applied by hand.
            ...(commitment ? { commitment } : {}),
            template_id: template.id,
            template_version_number: template.version_number,
            template_published_at: template.published_at,
            template_name: template.title,
            template_type: template.type,
            monthly_rent: variables.MONTHLY_RENT,
            advance_deposit: variables.SECURITY_DEPOSIT_AMOUNT,
            maintenance_charge: variables.MAINTENANCE_CHARGE_AMOUNT,
            maintenance_type: lifecycle.contract_maintenance_type,
            joining_date: variables.JOINING_DATE,
            agreement_start_date: dateOnly(lifecycle.agreement_start_date),
            agreement_end_date: dateOnly(lifecycle.agreement_end_date),
            agreement_duration_months: lifecycle.agreement_duration_months,
            payment_frequency: lifecycle.contract_payment_frequency,
            tenant_name: variables.TENANT_NAME,
            owner_name: template.owner_name,
            custom_rules: template.custom_rules || "",
            terms_and_conditions: (template.rules_content as any)?.terms_and_conditions || DEFAULT_TERMS_AND_CONDITIONS,
            raw_rules: template.rules_content || DEFAULT_AGREEMENT_TEMPLATE,
            interpolated_rules: interpolateRulesContent(template.rules_content || DEFAULT_AGREEMENT_TEMPLATE, variables, true),
            hostel_rules: interpolateRulesContent(template.rules_content || DEFAULT_AGREEMENT_TEMPLATE, variables, true),
          },
        },
      });

      if (hasGuardianSignature) {
        await tx.tenants.update({
          where: { id: tenant.id },
          data: compactObject({
            guardian_name: guardianSigName,
            guardian_relation: guardianRelation,
          }),
        });
      }

      await agreementRentScheduleService.generateForAgreementInTx(tx, agreement.id);
      return agreement;
    });

    // Post-commit: notify (cache invalidation + SSE). Activation itself
    // (credit sweep for obligations created by rent schedule) already
    // happened synchronously inside generateForAgreementInTx above.
    if (tenant.id && tenant.hostel_id && tenant.owner_id) {
      financialLifecycleService.notifyActivated({
        tenantId: tenant.id,
        ownerId: tenant.owner_id,
        hostelId: tenant.hostel_id,
        source: "agreement_signing",
      });
    }

    try {
      const pdfUrl = await AgreementGenerationService.generateAndUploadPdf(signedAgreement.id);
      console.log(`Generated agreement PDF: ${pdfUrl}`);
    } catch (pdfError) {
      console.error("Failed to generate and upload agreement PDF:", pdfError);
    }

    await this.markActivity(tenant, "agreement_signed", {
      agreement_id: signedAgreement.id,
      pdf_url: signedAgreement.pdf_url,
    });
  }

  private async saveAccount(profile: any | null, tenant: any, data: any, token: string, invitation?: any | null, resolved?: any) {
    const password = String(data?.password || "");
    const confirmPassword = String(data?.confirm_password || data?.confirmPassword || "");

    const primaryPhone = normalizeIndianPhone(
      data?.phone ||
      data?.primary_phone ||
      tenant?.phone_1 ||
      profile?.phone ||
      invitation?.phone
    );
    if (!primaryPhone) throw new Error("VALIDATION_ERROR: Valid primary phone is required");

    // Two independent proofs, either sufficient: the linked account already
    // verified this exact number (every Discover seeker, who OTP'd it at
    // enquiry time), or the invitation link was delivered to it over WhatsApp.
    // Editing the number on the Identity screen drops both, which is what makes
    // a changed number cost an OTP. See invitation-phone-trust.
    const isAlreadyVerified = isPhoneAlreadyProven({
      submittedPhone: primaryPhone,
      profile,
      tenant,
      invitationPhone: invitation?.phone ? normalizeIndianPhone(invitation.phone) : null,
      whatsappDeliveredAt: resolved?.whatsapp_delivered_at ?? null,
    });

    if (!isAlreadyVerified) {
      const otp = String(data?.otp || "").trim();
      if (!otp) {
        throw new Error("VALIDATION_ERROR: Verification code is required to verify your mobile number");
      }

      try {
        await authOtpService.verifyPhoneOtp({
          phone: primaryPhone,
          otp,
          purpose: "Registration",
          requestIp: null,
        });
      } catch (otpErr: any) {
        throw new Error(`VALIDATION_ERROR: Mobile verification failed: ${otpErr.message || "Invalid or expired code"}`);
      }
    }

    // Keyed on whether the tenancy is *bound*, not on whether we found an
    // account. Those used to be the same question; they are not any more, since
    // the resolver now hands back the invitee's existing account before
    // anything has been bound to this tenancy.
    //
    // `startActivation` is the only path that binds `tenants.profile_id`, and
    // binding is what runs `assertCanStartNewTenancy` — the "one live tenancy
    // per person" rule. Short-circuiting past it because a profile was found
    // would leave the tenancy unbound and that rule unchecked. It updates an
    // existing account in place rather than creating a second one, which is
    // exactly what an invitee with an account needs.
    if (!tenant.profile_id && invitation) {
      await tenantInvitationLifecycleService.startActivation(token, {
        ...data,
        phone: primaryPhone,
      });
      return;
    }
    if (!profile) throw new Error("INVALID_TRANSITION: Complete account setup from a valid invitation");

    // No longer collected on the Identity screen. `profiles.email` is this
    // person's login, and a form that rewrites it mid-onboarding could only do
    // harm: leaving it unchanged used to be rejected as "already registered",
    // and changing it would silently alter how they sign in.
    const normalizedEmail = resolveActivationEmail({ profile, invitation, phone: primaryPhone });
    if (!normalizedEmail) {
      throw new Error("VALIDATION_ERROR: This invitation is missing both an email address and a phone number");
    }

    // Kept, because this still writes an email onto a profile: it must never
    // take an address another account already owns (`profiles.email` is unique,
    // so an unchecked write is an opaque P2002).
    const existingWithEmail = await prisma.profile.findUnique({
      where: { email: normalizedEmail },
    });
    if (existingWithEmail && existingWithEmail.id !== profile.id) {
      throw new Error("VALIDATION_ERROR: An account with this email address already exists. Please use a different email address.");
    }

    const profileUpdate: any = {
      phone: primaryPhone,
      email: normalizedEmail,
      mobile_verified: true,
      phone_verified: true,
    };
    if (password || confirmPassword) {
      if (password.length < 8) throw new Error("VALIDATION_ERROR: Password must be at least 8 characters");
      if (password !== confirmPassword) throw new Error("VALIDATION_ERROR: Passwords do not match");
      profileUpdate.password_hash = await hashPassword(password);
    }

    await prisma.$transaction(async (tx: any) => {
      await tx.profile.update({ where: { id: profile.id }, data: profileUpdate });
      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          phone_1: primaryPhone,
          personal_email: normalizedEmail,
          mobile_verified: true,
          onboarding_last_activity_at: new Date(),
          ...(tenant.activation_started_at ? {} : { activation_started_at: new Date() }),
          ...(data?.photo_url ? { photo_url: String(data.photo_url) } : {}),
        },
      });
      if (invitation) {
        await tx.tenant_invitations.update({
          where: { id: invitation.id },
          data: {
            email: normalizedEmail,
          },
        });
      }
    });
    await eventLog.log("account_setup_completed", tenant.owner_id || null, { tenant_id: tenant.id, hostel_id: tenant.hostel_id }, tenant.id);
  }

  private async saveProfile(profile: any, tenant: any, data: any) {
    if (!profile) throw new Error("INVALID_TRANSITION: Complete account setup before profile completion");
    const phone = normalizeIndianPhone(data?.phone || data?.primary_phone || tenant.phone_1 || profile.phone);
    // A boys'/girls' hostel has already answered this by admitting the person,
    // so the Identity screen does not render the field and sends nothing. Any
    // other hostel type — including one whose type was never set — still asks,
    // and this falls through to the submitted value. See identity-field-policy.
    const gender =
      (data?.gender ? String(data.gender) : "") ||
      resolveGenderRequirement({
        tenantGender: tenant.gender,
        hostelType: tenant.hostels?.hostel_type,
      }).value ||
      tenant.gender;
    const dob = validDateOfBirth(data?.date_of_birth || tenant.date_of_birth);
    const guardianPhone = data?.guardian_phone || data?.phone_2
      ? normalizeIndianPhone(data?.guardian_phone || data?.phone_2)
      : null;
    const emergencyPhone = data?.phone_3 || data?.emergency_phone || data?.emergency_contact
      ? normalizeIndianPhone(data?.phone_3 || data?.emergency_phone || data?.emergency_contact)
      : null;
    if (!phone) throw new Error("VALIDATION_ERROR: Valid primary phone is required");
    if (guardianPhone === null && (data?.guardian_phone || data?.phone_2)) throw new Error("VALIDATION_ERROR: Valid guardian phone is required");
    // Emergency contact is no longer collected on the Identity screen (ADR-070
    // amendment) — optional here, same as guardian phone: only validated for
    // format if one was actually provided, never required.
    if (emergencyPhone === null && (data?.phone_3 || data?.emergency_phone || data?.emergency_contact)) {
      throw new Error("VALIDATION_ERROR: Valid emergency contact phone is required");
    }
    assertUniqueActivationPhones({ primary: phone, guardian: guardianPhone, emergency: emergencyPhone });
    await assertGuardianPhoneNotTenant(guardianPhone, tenant.id);
    if (!["Male", "Female", "Other", "Prefer not to say"].includes(gender)) throw new Error("VALIDATION_ERROR: Gender is required");
    if (!dob) throw new Error("VALIDATION_ERROR: Valid date of birth is required");
    if (!tenant.photo_url && !data?.photo_url) throw new Error("VALIDATION_ERROR: Profile photo is required");

    const profileType = data?.profile_type ? String(data.profile_type).toUpperCase() : tenant.profile_type || "STUDENT";

    if (profileType === "STUDENT") {
      if (!data?.guardian_name?.trim()) throw new Error("VALIDATION_ERROR: Parent/Guardian name is required for students");
      if (!guardianPhone) throw new Error("VALIDATION_ERROR: Parent/Guardian phone number is required for students");
      // guardian_relation is intentionally not required here (ADR-070's Identity
      // screen collects name+phone only, matching the design source) — it's
      // filled in later if a guardian co-signs the residency agreement
      // (`signAgreement()` writes it back), and stays null otherwise.
    }

    const currentGuardianPhone = tenant.phone_2 || tenant.guardian_phone;
    const isGuardianVerified = guardianPhone
      ? await prisma.phoneVerificationOtp.findFirst({
        where: {
          phone: safeNormalizeWhatsApp(guardianPhone),
          purpose: "ParentVerify",
          status: "VERIFIED",
        },
      })
      : null;

    if (guardianPhone && !isGuardianVerified) {
      const guardianOtp = data?.guardian_otp ? String(data.guardian_otp).trim() : "";
      if (!guardianOtp) {
        throw new Error("VALIDATION_ERROR: Verification code is required to verify the parent/guardian mobile number");
      }
      try {
        await authOtpService.verifyPhoneOtp({
          phone: guardianPhone,
          otp: guardianOtp,
          purpose: "ParentVerify",
          requestIp: null,
        });
      } catch (otpErr: any) {
        throw new Error(`VALIDATION_ERROR: Parent/Guardian mobile verification failed: ${otpErr.message || "Invalid or expired code"}`);
      }
    }

    // Emergency phone is collected but OTP verification is not required during onboarding.
    // This removes friction without reducing operational safety — emergency contacts are informational.

    const rollNumber = profileType === "STUDENT" ? String(data?.roll_number || "").trim().toUpperCase() : "";
    const yearOfStudy = data?.year_of_study ? Number(data.year_of_study) : undefined;
    if (yearOfStudy !== undefined && (!Number.isInteger(yearOfStudy) || yearOfStudy < 1 || yearOfStudy > 6)) {
      throw new Error("VALIDATION_ERROR: Year of study must be between 1 and 6");
    }
    if (rollNumber) {
      await assertUniqueRollNumberForTenant(tenant, rollNumber);
    }
    await prisma.$transaction(async (tx: any) => {
      await tx.profile.update({
        where: { id: profile.id },
        data: compactObject({ phone, emergency_contact: emergencyPhone || undefined }),
      });
      await tx.tenants.update({
        where: { id: tenant.id },
        data: compactObject({
          phone_1: phone,
          phone_2: guardianPhone || undefined,
          phone_3: emergencyPhone || undefined,
          guardian_name: data?.guardian_name || undefined,
          guardian_phone: guardianPhone || undefined,
          guardian_relation: data?.guardian_relation || undefined,
          gender,
          date_of_birth: dob,
          profile_type: ["STUDENT", "WORKING_PROFESSIONAL"].includes(profileType) ? profileType : "STUDENT",
          permanent_address: data?.permanent_address || undefined,
          temporary_address: data?.temporary_address || data?.permanent_address || undefined,
          personal_email: data?.personal_email || undefined,
          college_name: profileType === "STUDENT" ? data?.college_name || undefined : null,
          course: profileType === "STUDENT" ? data?.course || undefined : null,
          year_of_study: profileType === "STUDENT" ? yearOfStudy : undefined,
          branch: profileType === "STUDENT" ? data?.branch || undefined : null,
          roll_number: profileType === "STUDENT" ? rollNumber || undefined : null,
          office_name: profileType === "WORKING_PROFESSIONAL" ? data?.office_name || undefined : null,
          office_location: profileType === "WORKING_PROFESSIONAL" ? data?.office_location || undefined : null,
          job_role: profileType === "WORKING_PROFESSIONAL" ? data?.job_role || undefined : null,
          photo_url: data?.photo_url || undefined,
          onboarding_last_activity_at: new Date(),
        }),
      });
      await tx.agreement.updateMany({
        where: { tenant_id: tenant.id },
        data: compactObject({
          guardian_signature_name: data?.guardian_name || undefined,
          guardian_relation: data?.guardian_relation || undefined,
        }),
      });
    });
    await eventLog.log("profile_completed", tenant.owner_id || null, { tenant_id: tenant.id, hostel_id: tenant.hostel_id }, tenant.id);
  }

  private async acceptRules(profile: any, tenant: any, data: any, context: { ip: string; userAgent: string }, invitation?: any | null) {
    if (!profile) throw new Error("INVALID_TRANSITION: Complete account setup before accepting rules");
    await eventLog.log("rules_viewed", tenant.owner_id || null, { tenant_id: tenant.id, hostel_id: tenant.hostel_id }, tenant.id);
    const acknowledgements = data?.acknowledgements || {};
    const missing = REQUIRED_ACKNOWLEDGEMENTS.filter((key) => acknowledgements[key] !== true);
    if (missing.length > 0) {
      throw new Error(`VALIDATION_ERROR: Missing required rule acknowledgements: ${missing.join(", ")}`);
    }
    const ruleVersion = await this.getActiveRuleVersion(tenant.hostel_id);
    const variables = await this.getInterpolationVariables(profile, tenant, invitation);
    const rulesSnapshot = this.rulePayload(ruleVersion, variables);
    const existing = await prisma.tenantPolicyAcceptance.findUnique({
      where: {
        tenant_id_rule_version_id: {
          tenant_id: tenant.id,
          rule_version_id: ruleVersion.id,
        },
      },
    });
    if (!existing) {
      try {
        await prisma.tenantPolicyAcceptance.create({
          data: {
            tenant_id: tenant.id,
            hostel_id: tenant.hostel_id,
            rule_version_id: ruleVersion.id,
            rules_version: ruleVersion.version,
            rules_snapshot: rulesSnapshot,
            accepted_ip: context.ip,
            accepted_user_agent: context.userAgent,
            typed_signature_name: data?.typed_signature_name || profile?.name,
          },
        });
      } catch (error: any) {
        if (error?.code !== "P2002") throw error;
      }
    }
    await prisma.tenants.update({
      where: { id: tenant.id },
      data: { onboarding_last_activity_at: new Date() },
    });
    await eventLog.log("rules_accepted", tenant.owner_id || null, { tenant_id: tenant.id, hostel_id: tenant.hostel_id, rule_version_id: ruleVersion.id }, tenant.id);
  }

  private async activate(profile: any, tenant: any, data: any, invitation?: any | null) {
    if (!profile) throw new Error("INVALID_TRANSITION: Complete account setup before activation");
    if (data?.payment_frequency && !["MONTHLY", "QUARTERLY", "HALF_YEARLY", "ACADEMIC_YEARLY"].includes(data.payment_frequency)) {
      throw new Error("VALIDATION_ERROR: Invalid payment frequency cycle selection");
    }

    const ruleVersion = await this.getActiveRuleVersion(tenant.hostel_id);
    const current = await prisma.profile.findUnique({
      where: { id: profile.id },
      include: {
        tenants: {
          include: {
            rule_acceptances: { where: { rule_version_id: ruleVersion.id } },
            identification_documents: true,
          },
        },
      },
    });
    const tenantNow: any = selectCurrentTenancy(current?.tenants);
    if (!current || !tenantNow) throw new Error("INVALID: Activation link expired or already used");
    if (tenantNow.status !== "INVITED") throw new Error("INVALID_TRANSITION: Tenant is not invited");

    // Recompute and check required onboarding steps
    const state = this.computeState(current, tenantNow, ruleVersion, await this.resolveAgreementRequired(tenantNow.hostel_id));
    // `rules_accepted` is only a requirement where the hostel asks for the
    // agreement ceremony — this is a second, independent gate to the one in
    // assertTransition, and missing it here would block activation for
    // agreement-free hostels.
    if (
      !state.account_setup_completed ||
      (state.agreement_required !== false && !state.rules_accepted) ||
      !state.profile_completed
    ) {
      throw new Error("VALIDATION_ERROR: Required activation steps are incomplete");
    }

    // Explicitly enforce OTP verification on the backend before finalizing activation
    const isStudent = String(tenantNow.profile_type || "STUDENT").toUpperCase() === "STUDENT";
    const hasGuardian = Boolean(tenantNow.phone_2 || tenantNow.guardian_phone);
    if (isStudent || hasGuardian) {
      const gPhone = safeNormalizeWhatsApp(tenantNow.phone_2 || tenantNow.guardian_phone);
      if (!gPhone) {
        throw new Error("VALIDATION_ERROR: Parent/Guardian phone number is required");
      }
      const gVerified = await prisma.phoneVerificationOtp.findFirst({
        where: {
          phone: gPhone,
          purpose: "ParentVerify",
          status: "VERIFIED",
        },
      });
      if (!gVerified) {
        throw new Error("VALIDATION_ERROR: Parent/Guardian phone number must be verified via OTP");
      }
    }

    // Emergency contact is no longer collected on the Identity screen
    // (ADR-070 amendment) — informational only, never required to activate.

    const password = String(data?.password || "");
    const confirmPassword = String(data?.confirm_password || data?.confirmPassword || "");
    let passwordHash: string | undefined;
    if (password || confirmPassword) {
      if (password.length < 8) throw new Error("VALIDATION_ERROR: Password must be at least 8 characters");
      if (password !== confirmPassword) throw new Error("VALIDATION_ERROR: Passwords do not match");
      passwordHash = await hashPassword(password);
    } else if (!profile.password_hash) {
      throw new Error("VALIDATION_ERROR: Password is required to activate your account");
    }

    if (invitation) {
      await tenantInvitationLifecycleService.completeActivation(
        invitation,
        tenant,
        profile,
        data?.payment_frequency,
        password
      );
    } else {
      // Legacy profile-token activation path
      if (current.invitation_token !== profile.invitation_token || !current.invitation_token) {
        throw new Error("INVALID: Activation token has already been used");
      }

      this.validateOperationalInviteData(tenantNow);

      const completedAt = new Date();
      await prisma.$transaction(async (tx: any) => {
        const profileUpdate = await tx.profile.updateMany({
          where: {
            id: current.id,
            invitation_token: current.invitation_token,
            invitation_expires_at: { gte: completedAt },
            role: "TENANT",
          },
          data: {
            is_active: true,
            is_profile_completed: true,
            invitation_token: null,
            invitation_expires_at: null,
            ...(passwordHash ? { password_hash: passwordHash } : {}),
          },
        });
        if (profileUpdate.count !== 1) {
          throw new Error("INVALID: Activation token has already been used");
        }

        const tenantUpdate = await tx.tenants.updateMany({
          where: {
            id: tenantNow.id,
            profile_id: current.id,
            status: "INVITED",
            activation_completed_at: null,
          },
          data: {
            status: "ACTIVE",
            profile_completed: true,
            activation_completed_at: completedAt,
            onboarding_last_activity_at: completedAt,
            payment_frequency_effective_from: tenantNow.billing_start_date || tenantNow.joined_on || completedAt,
            ...(data?.payment_frequency ? { payment_frequency: data.payment_frequency } : {}),
          },
        });
        if (tenantUpdate.count !== 1) {
          throw new Error("INVALID_TRANSITION: Tenant activation was already completed or cancelled");
        }
      });

      await eventLog.log("activation_completed", tenantNow.owner_id || null, {
        tenant_id: tenantNow.id,
        hostel_id: tenantNow.hostel_id,
        completed_at: completedAt.toISOString(),
        duration_seconds: tenantNow.activation_started_at
          ? Math.max(0, Math.round((completedAt.getTime() - new Date(tenantNow.activation_started_at).getTime()) / 1000))
          : null,
      }, tenantNow.id);

      await allocationReconciliationService.reconcileTenant(tenantNow.id).catch(() => undefined);
    }

    // Single emission point for ALL activation paths through activate()
    // Covers both invitation flow (Path A) and legacy profile flow (Path B)
    await eventSystem.trigger("tenant_onboarding_completed", {
      tenantId: tenantNow.id,
    }).catch(() => undefined);
  }

  private validateOperationalInviteData(tenant: any) {
    const rent = numberValue(tenant.monthly_rent);
    const advance = numberValue(tenant.security_deposit);
    const maintenance = numberValue(tenant.maintenance_charge);
    if (rent <= 0) throw new Error("VALIDATION_ERROR: Monthly rent must be greater than zero");
    if (advance < 0) throw new Error("VALIDATION_ERROR: Advance deposit cannot be negative");
    if (maintenance < 0) throw new Error("VALIDATION_ERROR: Maintenance charge cannot be negative");

    for (const [label, value] of Object.entries({
      joined_on: tenant.joined_on,
      billing_start_date: tenant.billing_start_date,
    })) {
      if (!value) continue;
      const parsed = new Date(value as any);
      if (Number.isNaN(parsed.getTime())) throw new Error(`VALIDATION_ERROR: Invalid ${label}`);
    }
  }
}

export const activationWorkflowService = new ActivationWorkflowService();
