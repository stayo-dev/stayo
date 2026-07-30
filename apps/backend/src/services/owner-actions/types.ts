export type OwnerActionCategory = "EDIT" | "WORKFLOW" | "CORRECTION" | "VIEW";

export interface OwnerActionContext {
  tenantStatus: string; // matches prisma TenantStatus enum values: INVITED | ACTIVE | FORMER_TENANT | EXPIRED | CANCELLED
  actorRole: string;    // session.role, e.g. "OWNER"
}

export interface OwnerAction {
  actionId: string;             // unique, e.g. "TENANT_EDIT_PERSONAL_INFO"
  entity: string;                // "tenant" | "room" | "payment" | ... (open-ended, no enum — new domains add new strings)
  category: OwnerActionCategory;
  label: string;                 // owner-facing button text
  allowedRoles: string[];        // permission seam; Phase 1 always ["OWNER"], not enforced beyond session.role check
  isAvailable(ctx: OwnerActionContext): boolean; // cheap, synchronous, pure predicate
}

// What the API route returns to the frontend — isAvailable is already evaluated server-side
export interface OwnerActionSummary {
  actionId: string;
  entity: string;
  category: OwnerActionCategory;
  label: string;
  available: boolean;
}
