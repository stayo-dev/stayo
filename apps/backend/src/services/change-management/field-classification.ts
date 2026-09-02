/**
 * ════════════════════════════════════════════════════════════
 * Field Classification Registry — Single Source of Truth
 * ════════════════════════════════════════════════════════════
 *
 * Classifies every editable field in the HMS domain into one of
 * four change categories that determine the approval workflow:
 *
 *   Category A — Owner Controlled (immediate apply, audit log only)
 *   Category B — Shared Profile (tenant approval required)
 *   Category C — Contractual (agreement amendment, financial recalc)
 *   Category D — Financial (immutable — reversal entries only)
 *
 * This registry is consumed by:
 *   - change-request-service.ts (to classify incoming mutations)
 *   - PUT /api/tenants/[id]     (to route fields through the correct path)
 *   - diff-engine.ts            (to generate human-readable diffs)
 */

import type { ChangeCategory, ChangeApprovalLevel } from "@prisma/client";

// ─── Field Metadata ──────────────────────────────────────────

export interface FieldClassification {
  /** The database column name */
  field: string;
  /**
   * Which table this field lives in.
   *
   * `profile_identity` (added by phase B) is the person-level identity record —
   * shared across every tenancy, which is why everything in it is Category B.
   */
  table:
    | "tenants"
    | "profile"
    | "profile_identity"
    | "agreement"
    | "rent_obligations"
    | "tenant_financial_ledger"
    | "payments";
  /** Change category: A, B, C, D */
  category: ChangeCategory;
  /** Approval level: L0, L1, L2, L3 */
  approvalLevel: ChangeApprovalLevel;
  /** Human-readable label for UI display */
  label: string;
  /** Whether this field has financial side-effects */
  hasFinancialImpact: boolean;
}

// ─── Category A — Owner Controlled ──────────────────────────
// These fields can be edited immediately by the owner.
// No tenant approval required. Audit log only.

// Since phase B (2026-08-15) this category holds ONLY fields that describe
// *this tenancy*. The academic, professional and personal-metadata fields that
// used to live here are person-level now (`profile_identity`) and moved to
// Category B — see the note above CATEGORY_B_FIELDS.
const CATEGORY_A_FIELDS: FieldClassification[] = [
  // Operational (owner internal) — genuinely per-tenancy: "has *this* owner
  // checked *this* tenant's documents", not a fact about the person.
  { field: "document_verified", table: "tenants", category: "A", approvalLevel: "L1", label: "Document Verified",  hasFinancialImpact: false },
  { field: "profile_completed", table: "tenants", category: "A", approvalLevel: "L1", label: "Profile Completed",  hasFinancialImpact: false },
  { field: "mobile_verified",   table: "tenants", category: "A", approvalLevel: "L1", label: "Mobile Verified",    hasFinancialImpact: false },
];

// ─── Category B — Shared Profile Data ───────────────────────
// Owner proposes change → Tenant must approve.
// Both values visible until resolution.

//
// **Phase B (2026-08-15) widened this category considerably.** Identity moved
// off `tenants` (one row per tenancy) to `profile_identity` (one row per
// person), so these fields are now shared across every hostel someone has ever
// stayed in. An owner editing `college_name` under the old Category A rules
// would have silently rewritten the person's record at a hostel that owner has
// no relationship with — so every person-level field is a *proposal* now, which
// is exactly what this category, already named "Shared Profile Data", does.
//
// The cost is real and was accepted at design time: owners lose immediate edit
// on academic and personal fields. The test for whether a field belongs here is
// not "is it sensitive" but "does one hostel changing it affect another".
const CATEGORY_B_FIELDS: FieldClassification[] = [
  // Profile table fields
  { field: "name",              table: "profile", category: "B", approvalLevel: "L2", label: "Full Name",          hasFinancialImpact: false },

  // ── Person-level identity (moved from Category A by phase B) ─────────────
  { field: "date_of_birth",     table: "profile_identity", category: "B", approvalLevel: "L2", label: "Date of Birth",   hasFinancialImpact: false },
  { field: "gender",            table: "profile_identity", category: "B", approvalLevel: "L2", label: "Gender",          hasFinancialImpact: false },
  { field: "photo_url",         table: "profile_identity", category: "B", approvalLevel: "L2", label: "Photo",           hasFinancialImpact: false },
  { field: "nationality",       table: "profile_identity", category: "B", approvalLevel: "L2", label: "Nationality",     hasFinancialImpact: false },
  { field: "pan_number",        table: "profile_identity", category: "B", approvalLevel: "L2", label: "PAN Number",      hasFinancialImpact: false },
  { field: "profile_type",      table: "profile_identity", category: "B", approvalLevel: "L2", label: "Profile Type",    hasFinancialImpact: false },
  { field: "college_name",      table: "profile_identity", category: "B", approvalLevel: "L2", label: "College Name",    hasFinancialImpact: false },
  { field: "roll_number",       table: "profile_identity", category: "B", approvalLevel: "L2", label: "Roll Number",     hasFinancialImpact: false },
  { field: "course",            table: "profile_identity", category: "B", approvalLevel: "L2", label: "Course",          hasFinancialImpact: false },
  { field: "year_of_study",     table: "profile_identity", category: "B", approvalLevel: "L2", label: "Year of Study",   hasFinancialImpact: false },
  { field: "branch",            table: "profile_identity", category: "B", approvalLevel: "L2", label: "Branch",          hasFinancialImpact: false },
  { field: "section",           table: "profile_identity", category: "B", approvalLevel: "L2", label: "Section",         hasFinancialImpact: false },
  { field: "office_name",       table: "profile_identity", category: "B", approvalLevel: "L2", label: "Office Name",     hasFinancialImpact: false },
  { field: "office_location",   table: "profile_identity", category: "B", approvalLevel: "L2", label: "Office Location", hasFinancialImpact: false },
  { field: "job_role",          table: "profile_identity", category: "B", approvalLevel: "L2", label: "Job Role",        hasFinancialImpact: false },
  { field: "email",             table: "profile", category: "B", approvalLevel: "L2", label: "Email",              hasFinancialImpact: false },
  { field: "phone",             table: "profile", category: "B", approvalLevel: "L2", label: "Phone",              hasFinancialImpact: false },
  { field: "emergency_contact", table: "profile", category: "B", approvalLevel: "L2", label: "Emergency Contact",  hasFinancialImpact: false },

  // Tenant table phone fields (synced with profile)
  { field: "phone_1",           table: "tenants", category: "B", approvalLevel: "L2", label: "Primary Phone",      hasFinancialImpact: false },
  { field: "phone_2",           table: "tenants", category: "B", approvalLevel: "L2", label: "Guardian Phone",     hasFinancialImpact: false },
  { field: "phone_3",           table: "tenants", category: "B", approvalLevel: "L2", label: "Emergency Phone",    hasFinancialImpact: false },
  // Guardian is person-level since phase B — fields on the tenant's own
  // profile, not a second account. Parent logins are out of scope.
  { field: "guardian_name",     table: "profile_identity", category: "B", approvalLevel: "L2", label: "Guardian Name",      hasFinancialImpact: false },
  { field: "guardian_phone",    table: "profile_identity", category: "B", approvalLevel: "L2", label: "Guardian Phone",     hasFinancialImpact: false },
  { field: "guardian_relation", table: "profile_identity", category: "B", approvalLevel: "L2", label: "Guardian Relation",  hasFinancialImpact: false },
  { field: "personal_email",    table: "profile_identity", category: "B", approvalLevel: "L2", label: "Personal Email",     hasFinancialImpact: false },

  // Address fields. `permanent_address` follows the person; `temporary_address`
  // is where they live *for this tenancy* — usually the hostel itself — so it
  // stays on `tenants` deliberately rather than by omission.
  { field: "permanent_address", table: "profile_identity", category: "B", approvalLevel: "L2", label: "Permanent Address",  hasFinancialImpact: false },
  { field: "temporary_address", table: "tenants", category: "B", approvalLevel: "L2", label: "Temporary Address",  hasFinancialImpact: false },
  { field: "address",           table: "tenants", category: "B", approvalLevel: "L2", label: "Address",            hasFinancialImpact: false },
];

// ─── Category C — Contractual Data ──────────────────────────
// Never directly editable. Creates agreement amendment (V(n+1)).
// Requires tenant approval + financial recalculation.

const CATEGORY_C_FIELDS: FieldClassification[] = [
  // Tenant table (derived from agreement)
  { field: "monthly_rent",      table: "tenants", category: "C", approvalLevel: "L3", label: "Monthly Rent",       hasFinancialImpact: true },
  { field: "security_deposit",  table: "tenants", category: "C", approvalLevel: "L3", label: "Security Deposit",   hasFinancialImpact: true },
  { field: "maintenance_charge",table: "tenants", category: "C", approvalLevel: "L3", label: "Maintenance Charge", hasFinancialImpact: true },
  { field: "maintenance_type",  table: "tenants", category: "C", approvalLevel: "L3", label: "Maintenance Type",   hasFinancialImpact: true },
  { field: "payment_frequency", table: "tenants", category: "C", approvalLevel: "L3", label: "Payment Frequency",  hasFinancialImpact: true },
  { field: "joined_on",         table: "tenants", category: "C", approvalLevel: "L3", label: "Joining Date",       hasFinancialImpact: true },
  { field: "billing_start_date",table: "tenants", category: "C", approvalLevel: "L3", label: "Billing Start Date", hasFinancialImpact: true },

  // Agreement table
  { field: "agreement_start_date",      table: "agreement", category: "C", approvalLevel: "L3", label: "Agreement Start", hasFinancialImpact: true },
  { field: "agreement_end_date",        table: "agreement", category: "C", approvalLevel: "L3", label: "Agreement End",   hasFinancialImpact: true },
  { field: "agreement_duration_months", table: "agreement", category: "C", approvalLevel: "L3", label: "Agreement Duration", hasFinancialImpact: true },
  { field: "contract_rent",             table: "agreement", category: "C", approvalLevel: "L3", label: "Contract Rent",    hasFinancialImpact: true },
  { field: "contract_security_deposit", table: "agreement", category: "C", approvalLevel: "L3", label: "Contract Deposit", hasFinancialImpact: true },
  { field: "contract_maintenance",      table: "agreement", category: "C", approvalLevel: "L3", label: "Contract Maintenance", hasFinancialImpact: true },
  { field: "contract_maintenance_type", table: "agreement", category: "C", approvalLevel: "L3", label: "Contract Maint. Type", hasFinancialImpact: true },
  { field: "contract_payment_frequency",table: "agreement", category: "C", approvalLevel: "L3", label: "Contract Pay Freq.",   hasFinancialImpact: true },
];

// ─── Category D — Financial (Immutable) ─────────────────────
// Never editable. Correction = Reversal + New Entry.

const CATEGORY_D_FIELDS: FieldClassification[] = [
  { field: "amount_paid",       table: "payments",              category: "D", approvalLevel: "L3", label: "Payment Amount",    hasFinancialImpact: true },
  { field: "amount",            table: "rent_obligations",      category: "D", approvalLevel: "L3", label: "Obligation Amount", hasFinancialImpact: true },
  { field: "amount",            table: "tenant_financial_ledger",category: "D", approvalLevel: "L3", label: "Ledger Amount",     hasFinancialImpact: true },
];

// ─── Registry ────────────────────────────────────────────────

/** All classified fields in the system */
export const FIELD_REGISTRY: ReadonlyArray<FieldClassification> = [
  ...CATEGORY_A_FIELDS,
  ...CATEGORY_B_FIELDS,
  ...CATEGORY_C_FIELDS,
  ...CATEGORY_D_FIELDS,
];

/** Lookup map: "table.field" → classification */
const FIELD_LOOKUP = new Map<string, FieldClassification>();
for (const f of FIELD_REGISTRY) {
  FIELD_LOOKUP.set(`${f.table}.${f.field}`, f);
}

// Separate tenant-field-only lookup for the PUT /api/tenants/[id] route
const TENANT_FIELD_LOOKUP = new Map<string, FieldClassification>();
for (const f of FIELD_REGISTRY) {
  if (f.table === "tenants" || f.table === "profile") {
    // Use bare field name for tenant updates
    if (!TENANT_FIELD_LOOKUP.has(f.field)) {
      TENANT_FIELD_LOOKUP.set(f.field, f);
    }
  }
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Classify a field by its table and column name.
 * Returns undefined if the field is not governed by Change Management.
 */
export function classifyField(table: string, field: string): FieldClassification | undefined {
  return FIELD_LOOKUP.get(`${table}.${field}`);
}

/**
 * Classify a tenant-update field (used by PUT /api/tenants/[id]).
 * This resolves fields from both the `tenants` and `profile` tables
 * using bare field names as they appear in the update payload.
 */
export function classifyTenantField(field: string): FieldClassification | undefined {
  return TENANT_FIELD_LOOKUP.get(field);
}

/**
 * Given a bag of update fields, split them by category.
 * Returns a map of category → { field: value } pairs.
 *
 * Fields not in the registry are returned under the `unclassified` key.
 * Callers must decide what to do with unclassified fields (typically reject).
 */
export function partitionFieldsByCategory(
  data: Record<string, unknown>
): {
  A: Record<string, unknown>;
  B: Record<string, unknown>;
  C: Record<string, unknown>;
  D: Record<string, unknown>;
  unclassified: Record<string, unknown>;
} {
  const result = {
    A: {} as Record<string, unknown>,
    B: {} as Record<string, unknown>,
    C: {} as Record<string, unknown>,
    D: {} as Record<string, unknown>,
    unclassified: {} as Record<string, unknown>,
  };

  for (const [field, value] of Object.entries(data)) {
    // Skip control fields that are not actual data
    if (field === "invitation_edit" || field === "status") continue;

    const classification = classifyTenantField(field);
    if (classification) {
      result[classification.category][field] = value;
    } else {
      result.unclassified[field] = value;
    }
  }

  return result;
}

/**
 * Fields only the tenant may fill, and only after they personally accept their
 * invitation (`acceptance_status = ACCEPTED`). While acceptance is `PENDING`
 * the owner is standing in for a person who has not consented to anything, so
 * these are hard-rejected rather than turned into (un-approvable) change
 * requests. See ADR-165. Names are as they appear in the `PUT /api/tenants/[id]`
 * payload / `classifyTenantField`.
 */
export const TENANT_ONLY_FIELDS: ReadonlySet<string> = new Set([
  // Guardian
  "guardian_name", "guardian_phone", "guardian_relation", "phone_2", "phone_3",
  // College / education
  "college_name", "course", "roll_number", "year_of_study", "branch", "section",
  // Personal identity
  "date_of_birth", "gender", "photo_url", "permanent_address", "pan_number", "nationality",
  "emergency_contact",
  // ID / document verification — the owner cannot verify documents a tenant
  // who has not accepted has had no way to upload.
  "document_verified",
]);

/** The subset of `data`'s keys that are tenant-only. */
export function partitionTenantOnlyFields(data: Record<string, unknown>): string[] {
  return Object.keys(data).filter((k) => TENANT_ONLY_FIELDS.has(k));
}

/**
 * Check if a tenant is in the Administrative Correction Window.
 *
 * When a tenant is INVITED (pre-activation) and has no payment history,
 * the owner can freely edit all fields as Category A — no approval needed.
 *
 * A live-but-unaccepted tenancy (`acceptance_status = PENDING`) is deliberately
 * NOT in the window: it is `ACTIVE`, not `INVITED`, so this already returned
 * false for it, but the explicit guard keeps that true if the status model
 * ever changes. Tenant-only fields are blocked outright for it (see
 * `TENANT_ONLY_FIELDS`); the rest go through the ordinary category routing.
 */
export function isInCorrectionWindow(tenant: {
  status: string;
  hasPayments: boolean;
  acceptanceStatus?: string | null;
}): boolean {
  if (tenant.acceptanceStatus === "PENDING") return false;
  return tenant.status === "INVITED" && !tenant.hasPayments;
}

/**
 * Get the effective category for a field, considering the correction window.
 * If the tenant is in the correction window, all fields downgrade to Cat A.
 */
export function getEffectiveCategory(
  field: string,
  tenant: { status: string; hasPayments: boolean }
): ChangeCategory {
  if (isInCorrectionWindow(tenant)) {
    return "A";
  }
  const classification = classifyTenantField(field);
  return classification?.category ?? "A";
}

/**
 * Get all fields for a specific category.
 */
export function getFieldsByCategory(category: ChangeCategory): FieldClassification[] {
  return FIELD_REGISTRY.filter(f => f.category === category);
}

/**
 * Human-readable label for a change category.
 */
export const CATEGORY_LABELS: Record<ChangeCategory, string> = {
  A: "Owner Controlled",
  B: "Shared Profile",
  C: "Contractual Amendment",
  D: "Financial Correction",
};

/**
 * Default expiration days for each approval level.
 * L0/L1 never expire (owner-only). L2/L3 expire after 30 days.
 */
export const EXPIRATION_DAYS: Record<ChangeApprovalLevel, number | null> = {
  L0: null,
  L1: null,
  L2: 30,
  L3: 30,
};
