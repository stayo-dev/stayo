/**
 * ════════════════════════════════════════════════════════════
 * Diff Engine — Snapshot Comparison & Change Visualization
 * ════════════════════════════════════════════════════════════
 *
 * Generates structured diffs between before/after states.
 * Used for:
 *   - Creating change request snapshots
 *   - Rendering diff views in the UI
 *   - Computing financial impact previews
 */

import { classifyTenantField, type FieldClassification } from "./field-classification";

// ─── Types ───────────────────────────────────────────────────

export interface FieldDiff {
  /** Database field name */
  field: string;
  /** Human-readable label */
  label: string;
  /** Value before change */
  oldValue: unknown;
  /** Proposed new value */
  newValue: unknown;
  /** Change category */
  category: string;
  /** Whether this field has financial implications */
  hasFinancialImpact: boolean;
}

export interface ChangeSnapshot {
  /** Complete state of the entity before change */
  currentSnapshot: Record<string, unknown>;
  /** Only the changed fields with new values */
  proposedChanges: Record<string, unknown>;
  /** Structured diff for UI rendering */
  diffs: FieldDiff[];
  /** Whether any changed field has financial impact */
  hasFinancialImpact: boolean;
}

// ─── Snapshot Creation ───────────────────────────────────────

/**
 * Create a snapshot of the current tenant state for comparison.
 * Extracts only the classified fields to avoid storing unnecessary data.
 */
export function createTenantSnapshot(
  tenant: Record<string, unknown>,
  profile?: Record<string, unknown> | null
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {};

  // Tenant fields
  const tenantFields = [
    "monthly_rent", "security_deposit", "maintenance_charge", "maintenance_type",
    "payment_frequency", "joined_on", "billing_start_date", "year_of_study",
    "section", "branch", "course", "college_name", "roll_number", "profile_type",
    "office_name", "office_location", "job_role", "photo_url", "gender",
    "date_of_birth", "document_verified", "profile_completed", "mobile_verified",
    "phone_1", "phone_2", "phone_3", "guardian_name", "guardian_phone",
    "guardian_relation", "personal_email", "permanent_address", "temporary_address",
  ];

  for (const field of tenantFields) {
    if (field in tenant) {
      snapshot[field] = serializeValue(tenant[field]);
    }
  }

  // Profile fields
  if (profile) {
    const profileFields = ["name", "email", "phone", "emergency_contact"];
    for (const field of profileFields) {
      if (field in profile) {
        snapshot[field] = serializeValue(profile[field]);
      }
    }
  }

  return snapshot;
}

/**
 * Compute a structured diff between current state and proposed changes.
 * Only includes fields that actually differ.
 */
export function computeDiff(
  currentSnapshot: Record<string, unknown>,
  proposedData: Record<string, unknown>
): ChangeSnapshot {
  const diffs: FieldDiff[] = [];
  const actualChanges: Record<string, unknown> = {};

  for (const [field, newValue] of Object.entries(proposedData)) {
    const oldValue = currentSnapshot[field];
    const serializedNew = serializeValue(newValue);
    const serializedOld = serializeValue(oldValue);

    // Skip if values are identical
    if (serializedOld === serializedNew) continue;

    const classification = classifyTenantField(field);
    const label = classification?.label ?? humanizeFieldName(field);
    const category = classification?.category ?? "A";
    const hasFinancialImpact = classification?.hasFinancialImpact ?? false;

    diffs.push({
      field,
      label,
      oldValue: serializedOld,
      newValue: serializedNew,
      category,
      hasFinancialImpact,
    });

    actualChanges[field] = serializedNew;
  }

  return {
    currentSnapshot,
    proposedChanges: actualChanges,
    diffs,
    hasFinancialImpact: diffs.some(d => d.hasFinancialImpact),
  };
}

/**
 * Generate a human-readable summary of changes.
 * Used in notifications and audit logs.
 */
export function summarizeDiff(diffs: FieldDiff[]): string {
  if (diffs.length === 0) return "No changes";
  if (diffs.length === 1) {
    const d = diffs[0];
    return `${d.label}: ${formatValue(d.oldValue)} → ${formatValue(d.newValue)}`;
  }
  return `${diffs.length} fields changed: ${diffs.map(d => d.label).join(", ")}`;
}

// ─── Utilities ───────────────────────────────────────────────

/**
 * Serialize a value for consistent comparison.
 * Handles Decimal, Date, BigInt, and null/undefined normalization.
 */
function serializeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;

  // Prisma Decimal → number
  if (typeof value === "object" && value !== null && "toNumber" in value && typeof (value as any).toNumber === "function") {
    return (value as any).toNumber();
  }

  // Date → ISO string
  if (value instanceof Date) {
    return value.toISOString();
  }

  // BigInt → number
  if (typeof value === "bigint") {
    return Number(value);
  }

  // String numbers → number for financial fields
  if (typeof value === "string" && !isNaN(Number(value)) && value.trim() !== "") {
    // Keep as string — don't auto-convert
  }

  return value;
}

/**
 * Format a value for human-readable display.
 */
function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "(empty)";
  if (typeof value === "number") {
    // Format as currency if it looks like a money value
    if (value >= 100) {
      return `₹${value.toLocaleString("en-IN")}`;
    }
    return String(value);
  }
  if (typeof value === "string") {
    // ISO date → readable
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      try {
        return new Date(value).toLocaleDateString("en-IN", {
          day: "2-digit",
          month: "short",
          year: "numeric",
        });
      } catch {
        return value;
      }
    }
    return value;
  }
  return String(value);
}

/**
 * Convert a snake_case field name to a human-readable label.
 */
function humanizeFieldName(field: string): string {
  return field
    .replace(/_/g, " ")
    .replace(/\b\w/g, c => c.toUpperCase());
}
