import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * Owner activation visibility (audit Task 4).
 *
 * The owner had no way to see where an invited tenant was stuck — Tenant
 * Detail showed only "Invited", and Home's "Activate Tenants" card opened the
 * *Invite* wizard, asking the owner to invite someone else.
 *
 * The activation state machine already exists and is the source of truth.
 * These tests pin that the owner-facing read **reuses** it rather than
 * re-deriving it, and — critically — that it does so without the side effects
 * `getContext()` carries.
 */

const { mockPrisma, mockTemplate } = vi.hoisted(() => ({
  mockPrisma: {
    tenants: { findFirst: vi.fn(), findMany: vi.fn() },
    ruleVersion: { findUnique: vi.fn() },
    tenantPolicyAcceptance: { create: vi.fn() },
    tenant_invitations: { update: vi.fn(), updateMany: vi.fn() },
  },
  mockTemplate: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../lib/db", () => ({ prisma: mockPrisma }));
vi.mock("../src/utils/default-rules", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveTemplateAndSyncRuleVersion: mockTemplate,
}));
vi.mock("@/src/utils/default-rules", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getActiveTemplateAndSyncRuleVersion: mockTemplate,
}));

import { activationWorkflowService } from "../src/services/tenants/activation-workflow-service";

const OWNER_A = "owner-aaa";
const OWNER_B = "owner-bbb";
const TENANT_ID = "tenant-1";
const RULE_VERSION_ID = "rule-1";

function tenantRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: TENANT_ID,
    owner_id: OWNER_A,
    hostel_id: "hostel-1",
    status: "INVITED",
    profile_type: "STUDENT",
    phone_1: "9000000000",
    gender: "MALE",
    date_of_birth: new Date("2003-01-01"),
    phone_3: "9111111111",
    photo_url: "https://img/p.jpg",
    created_at: new Date("2026-07-28T09:00:00Z"),
    activation_started_at: new Date("2026-07-28T09:00:00Z"),
    activation_completed_at: null,
    onboarding_last_activity_at: null,
    profiles: { id: "profile-1", name: "Arjun Mehta", phone: "9000000000", mobile_verified: true },
    hostels: { id: "hostel-1", name: "MG Road" },
    rule_acceptances: [],
    agreements: [],
    identification_documents: [],
    ...overrides,
  };
}

describe("activationWorkflowService.getOwnerActivationState", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.tenants.findFirst.mockResolvedValue(tenantRecord());
    mockTemplate.mockResolvedValue({ id: RULE_VERSION_ID, version_number: 1, title: "Rules", rules_content: null });
    mockPrisma.ruleVersion.findUnique.mockResolvedValue({ id: RULE_VERSION_ID, version: "v1" });
  });

  describe("reuses the existing state machine", () => {
    it("reports RULES as the current step when only account setup is done", async () => {
      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.current_step).toBe("RULES");
      expect(state.completed_steps).toEqual(["ACCOUNT", "PROFILE"]);
    });

    it("advances to AGREEMENT once rules are accepted", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(
        tenantRecord({ rule_acceptances: [{ rule_version_id: RULE_VERSION_ID, accepted_at: new Date(), rules_version: "v1" }] }),
      );

      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.current_step).toBe("AGREEMENT");
    });

    it("reaches ACTIVATE once the agreement is signed and the profile is complete", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(
        tenantRecord({
          rule_acceptances: [{ rule_version_id: RULE_VERSION_ID, accepted_at: new Date(), rules_version: "v1" }],
          agreements: [{ status: "SIGNED" }],
        }),
      );

      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.current_step).toBe("ACTIVATE");
      expect(state.activation_completed).toBe(false);
    });

    it("reports an activated tenant as complete", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(
        tenantRecord({
          status: "ACTIVE",
          rule_acceptances: [{ rule_version_id: RULE_VERSION_ID, accepted_at: new Date(), rules_version: "v1" }],
          agreements: [{ status: "SIGNED" }],
        }),
      );

      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.activation_completed).toBe(true);
      expect(state.completed_steps).toContain("ACTIVATE");
      expect(state.progress_percent).toBe(100);
    });

    it("surfaces which profile fields are still missing, rather than just 'incomplete'", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(tenantRecord({ photo_url: null, gender: null }));

      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.missing_fields.tier_1_required).toEqual(expect.arrayContaining(["gender", "photo_url"]));
    });

    it("reports blocked steps so the owner can see what is unreachable", async () => {
      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.blocked_steps).toContain("AGREEMENT");
      expect(state.blocked_steps).toContain("ACTIVATE");
    });
  });

  describe("is read-only — unlike getContext()", () => {
    // getContext(token) marks the invitation OPENED and AUTO-ACCEPTS the
    // hostel rules on the tenant's behalf. An owner looking at a progress
    // screen must never complete a step for the tenant.
    it("does not auto-accept rules on the tenant's behalf", async () => {
      await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(mockPrisma.tenantPolicyAcceptance.create).not.toHaveBeenCalled();
    });

    it("does not mark the invitation as opened", async () => {
      await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(mockPrisma.tenant_invitations.update).not.toHaveBeenCalled();
      expect(mockPrisma.tenant_invitations.updateMany).not.toHaveBeenCalled();
    });

    it("leaves rules unaccepted in the reported state when the tenant has not accepted them", async () => {
      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.rules_accepted).toBe(false);
    });
  });

  describe("owner isolation", () => {
    it("scopes the lookup to the calling owner", async () => {
      await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(mockPrisma.tenants.findFirst.mock.calls[0][0].where).toMatchObject({
        id: TENANT_ID,
        owner_id: OWNER_A,
      });
    });

    it("refuses a tenant belonging to another owner", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(null);

      await expect(activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_B)).rejects.toThrow(
        /NOT_FOUND/,
      );
    });
  });

  describe("KYC stays an independent state machine", () => {
    it("reports document upload without letting it affect the activation step", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(
        tenantRecord({
          document_verified: false,
          identification_documents: [{ doc_type: "AADHAAR", document_status: "PENDING" }],
          rule_acceptances: [{ rule_version_id: RULE_VERSION_ID, accepted_at: new Date(), rules_version: "v1" }],
          agreements: [{ status: "SIGNED" }],
        }),
      );

      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      // Unverified KYC must not hold activation back.
      expect(state.current_step).toBe("ACTIVATE");
      expect(state.blocked_steps).not.toContain("ACTIVATE");
      expect(state.documents_uploaded).toBe(true);
    });

    it("still reaches ACTIVATE with no documents uploaded at all", async () => {
      mockPrisma.tenants.findFirst.mockResolvedValue(
        tenantRecord({
          identification_documents: [],
          rule_acceptances: [{ rule_version_id: RULE_VERSION_ID, accepted_at: new Date(), rules_version: "v1" }],
          agreements: [{ status: "SIGNED" }],
        }),
      );

      const state = await activationWorkflowService.getOwnerActivationState(TENANT_ID, OWNER_A);

      expect(state.current_step).toBe("ACTIVATE");
      expect(state.documents_uploaded).toBe(false);
    });
  });
});
