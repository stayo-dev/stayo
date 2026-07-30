import { ChangeCategory, ChangeApprovalLevel } from "@prisma/client";

export interface PolicyContext {
  ownerId: string;
  hostelId: string;
  tenantId?: string;
  entityType: string;
  entityId: string;
  before: Record<string, any>;
  diff: Record<string, any>;
  correctionWindow: boolean;
}

export type PolicyRule = (context: PolicyContext) => Promise<{
  overrideCategory?: ChangeCategory;
  overrideApprovalLevel?: ChangeApprovalLevel;
  requiresSimulation?: boolean;
  requiresTenantApproval?: boolean;
  error?: string;
} | null>;

export const Rules = {
  // Check if it's within the Correction Window (all fields downgrade to Cat A / Level 1)
  correctionWindowDowngrade: async (context: PolicyContext) => {
    if (context.correctionWindow) {
      return {
        overrideCategory: "A" as ChangeCategory,
        overrideApprovalLevel: "L1" as ChangeApprovalLevel,
        requiresTenantApproval: false,
      };
    }
    return null;
  },

  // Level 3 requirement for contractual changes
  requiresContractualApproval: async (context: PolicyContext) => {
    const cFields = [
      "monthly_rent", "security_deposit", "maintenance_charge", "maintenance_type",
      "payment_frequency", "joined_on", "billing_start_date",
      "agreement_start_date", "agreement_end_date", "agreement_duration_months",
      "contract_rent", "contract_security_deposit", "contract_maintenance",
      "contract_maintenance_type", "contract_payment_frequency"
    ];
    const hasContractual = Object.keys(context.diff).some(f => cFields.includes(f));
    if (hasContractual && !context.correctionWindow) {
      return {
        overrideCategory: "C" as ChangeCategory,
        overrideApprovalLevel: "L3" as ChangeApprovalLevel,
        requiresTenantApproval: true,
        requiresSimulation: true,
      };
    }
    return null;
  },

  // Level 2 requirement for shared profile changes (Category B)
  requiresSharedProfileApproval: async (context: PolicyContext) => {
    const bFields = [
      "name", "email", "phone", "emergency_contact", "phone_1", "phone_2", "phone_3",
      "guardian_name", "guardian_phone", "guardian_relation", "personal_email",
      "permanent_address", "temporary_address"
    ];
    const hasSharedProfile = Object.keys(context.diff).some(f => bFields.includes(f));
    if (hasSharedProfile && !context.correctionWindow) {
      return {
        overrideCategory: "B" as ChangeCategory,
        overrideApprovalLevel: "L2" as ChangeApprovalLevel,
        requiresTenantApproval: true,
      };
    }
    return null;
  },
};

export class PolicyEngine {
  private rules: PolicyRule[] = [
    Rules.correctionWindowDowngrade,
    Rules.requiresContractualApproval,
    Rules.requiresSharedProfileApproval,
  ];

  async evaluate(context: PolicyContext) {
    let category: ChangeCategory = "A";
    let approvalLevel: ChangeApprovalLevel = "L1";
    let requiresSimulation = false;
    let requiresTenantApproval = false;

    // Run rules to compute final workflow routing
    for (const rule of this.rules) {
      const result = await rule(context);
      if (result) {
        if (result.error) {
          throw new Error(`POLICY_ERROR: ${result.error}`);
        }
        if (result.overrideCategory) {
          category = result.overrideCategory;
        }
        if (result.overrideApprovalLevel) {
          approvalLevel = result.overrideApprovalLevel;
        }
        if (result.requiresSimulation !== undefined) {
          requiresSimulation = requiresSimulation || result.requiresSimulation;
        }
        if (result.requiresTenantApproval !== undefined) {
          requiresTenantApproval = requiresTenantApproval || result.requiresTenantApproval;
        }
      }
    }

    return {
      category,
      approvalLevel,
      requiresSimulation,
      requiresTenantApproval,
    };
  }
}

export const policyEngine = new PolicyEngine();
