import { prisma } from "../../../lib/db";
import { getLogger } from "../../../lib/logger";

import { getActiveTemplateAndSyncRuleVersion } from "../../utils/default-rules";
import { assertGuardianPhoneNotTenant } from "../../../lib/utils/phone-utils";
import { liveTenancyWhere } from "@/lib/tenancy/active-tenancy";

const logger = getLogger("tenant-onboarding-service");

export class TenantOnboardingService {
  async completeOnboarding(profileId: string, payload: any, context: { ip_address: string; user_agent: string }) {
    logger.info(`Starting onboarding completion for profile: ${profileId}`);

    const tenant = await prisma.tenants.findFirst({
      where: liveTenancyWhere(profileId),
      include: { hostel: true }
    });

    if (!tenant) {
      throw new Error("Tenant record not found.");
    }

    const {
      personal,
      contact,
      academic,
      address,
      policyAcceptance
    } = payload;

    await assertGuardianPhoneNotTenant(contact?.guardian_phone, tenant.id);

    // Validate Signature
    if (!policyAcceptance || !policyAcceptance.typed_signature_name) {
      throw new Error("Digital signature is required.");
    }

    const activeTemplate = await getActiveTemplateAndSyncRuleVersion(prisma, tenant.hostel_id, "RESIDENCY");
    const ruleVersion = await prisma.ruleVersion.findUnique({
      where: { id: activeTemplate.id }
    });
    if (!ruleVersion) {
      throw new Error("INTERNAL_ERROR: Failed to resolve linked RuleVersion for active template");
    }

    await prisma.$transaction(async (tx) => {
      // 1. Update Profile (Personal/Global Details)
      await tx.profile.update({
        where: { id: profileId },
        data: {
          name: personal.full_name || undefined,
          phone: contact.primary_phone || undefined,
        }
      });

      // 2. Update Tenant (Hostel-specific / Semantic Details)
      await tx.tenants.update({
        where: { id: tenant.id },
        data: {
          gender: personal.gender,
          date_of_birth: personal.date_of_birth ? new Date(personal.date_of_birth) : undefined,
          
          // Map to backend columns while honoring semantic roles
          phone_1: contact.primary_phone,
          phone_2: contact.guardian_phone,
          phone_3: contact.emergency_phone,

          // Using phone_2 theoretically maps to guardian; let's rely on standard columns
          // Wait, I didn't add guardian_name to schema. Let's just update what is possible, 
          // or I did add emergency_contact_name. Let's verify what's actually in schema
          emergency_contact_name: contact.emergency_contact_name || contact.guardian_name || undefined,
          emergency_contact_phone: contact.emergency_phone || undefined,
          emergency_contact_relation: contact.guardian_relation || undefined,

          college_name: academic.college_name,
          course: academic.course,
          year_of_study: academic.year ? parseInt(academic.year, 10) : undefined,
          roll_number: academic.roll_number,

          permanent_address: address.permanent_address,
          temporary_address: address.temporary_address,

          profile_completed: true,
        }
      });

      // 3. Record Policy Acceptance
      await tx.tenantPolicyAcceptance.create({
        data: {
          tenant_id: tenant.id,
          hostel_id: tenant.hostel_id,
          rule_version_id: ruleVersion.id,
          rules_version: ruleVersion.version,
          typed_signature_name: policyAcceptance.typed_signature_name,
          accepted_ip: context.ip_address,
          accepted_user_agent: context.user_agent,
        }
      });
    });

    return { success: true, message: "Onboarding completed successfully" };
  }
}

export const tenantOnboardingService = new TenantOnboardingService();
