import { describe, expect, it, vi, beforeEach } from "vitest";
import { ActivationWorkflowService } from "@/src/services/tenants/activation-workflow-service";
import { AgreementRenewalSigningService } from "@/src/services/tenants/agreement-renewal-signing-service";
import { 
  AgreementGenerationService,
  formatAgreementDate,
  formatAgreementDateTime,
  sanitizeIp,
  parseUserAgent
} from "@/src/services/tenants/agreement-generation-service";
import { prisma } from "@/lib/db";

// Mock the database client
vi.mock("@/lib/db", () => {
  const mockPrisma = {
    tenants: {
      update: vi.fn().mockResolvedValue({}),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
    profile: {
      update: vi.fn(),
      findUnique: vi.fn(),
    },
    tenant_invitations: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    ruleVersion: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
    },
    agreementTemplate: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
    agreement: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    move_out_requests: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    rent_obligations: {
      findFirst: vi.fn().mockResolvedValue(null),
    },
    renewalTimelineEvent: {
      create: vi.fn().mockResolvedValue({ id: "timeline-event-1" }),
    },
    roomAllocation: {
      count: vi.fn().mockResolvedValue(0),
    },
    $transaction: vi.fn((cb) => cb(mockPrisma)),
    $queryRaw: vi.fn(),
    $connect: vi.fn(),
    $disconnect: vi.fn(),
  };
  return { prisma: mockPrisma };
});

vi.mock("@/lib/services/event-log-service", () => ({
  eventLog: {
    log: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("axios", () => ({
  default: {
    get: vi.fn().mockRejectedValue(new Error("Network disabled in tests")),
  },
}));

vi.mock("@/src/services/tenants/activation-financial-status-service", () => ({
  getActivationFinancialStatus: vi.fn().mockResolvedValue({
    isReady: true,
    totalPaid: 10000,
    totalRequired: 10000,
    payments: [],
  }),
}));

describe("Residency Agreement Rules Snapshot Mechanism", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("ActivationWorkflowService - signAgreement", () => {
    it("should store the rules_snapshot, rule_version_id, and rule_version_number during agreement signing", async () => {
      const service = new ActivationWorkflowService();

      const mockRuleVersion = {
        id: "rule-v2-uuid",
        version: "v2.0",
        content: {
          categories: [
            {
              title: "Category 1",
              highlights: ["hl1"],
              rules: ["rule1"],
            },
          ],
        },
      };

      const mockTemplate = {
        id: "template-1",
        owner_name: "Hostel Owner",
        owner_signature_url: "https://sig.com",
        custom_rules: "Custom rule 1",
      };

      const mockAgreement = {
        id: "agreement-1",
        hostel_id: "hostel-1",
        status: "DRAFT",
        content_snapshot: {},
        contract_rent: 5000,
        contract_security_deposit: 10000,
        contract_maintenance: 1000,
        contract_maintenance_type: "ONE_TIME",
        contract_payment_frequency: "MONTHLY",
        agreement_start_date: new Date(),
        agreement_end_date: new Date(),
        agreement_duration_months: 12,
        tenant: null as any,
        hostel: { name: "Test Hostel" },
        template: mockTemplate,
      };

      const mockTenant: any = {
        id: "tenant-1",
        hostel_id: "hostel-1",
        status: "INVITED",
        phone_1: "1234567890",
        rule_acceptances: [{ rule_version_id: "rule-v2-uuid" }],
        agreements: [mockAgreement],
        hostels: { name: "Test Hostel", rent_cycle: "MONTHLY", auto_rent_day: 1, preferences: {} },
        joined_on: new Date(),
        billing_start_date: new Date(),
        monthly_rent: 5000,
        security_deposit: 10000,
        maintenance_charge: 1000,
        maintenance_type: "ONE_TIME",
        payment_frequency: "MONTHLY",
        room_allocations: [],
      };

      mockAgreement.tenant = mockTenant;

      const mockProfile = { id: "profile-1", name: "Tenant User", phone: "1234567890" };
      const mockInvitation = { id: "invite-1", email: "tenant@example.com", phone: "1234567890", name: "Tenant User" };

      // Setup resolve invitation mocks
      vi.spyOn(service as any, "resolveInvitation").mockResolvedValue({
        profile: mockProfile,
        tenant: mockTenant,
        invitation: mockInvitation,
      });

      vi.mocked(prisma.tenants.findUnique).mockResolvedValue(mockTenant as any);
      vi.mocked(prisma.ruleVersion.findFirst).mockResolvedValue(mockRuleVersion as any);
      vi.mocked(prisma.ruleVersion.findUnique).mockResolvedValue(mockRuleVersion as any);
      vi.mocked(prisma.agreementTemplate.findFirst).mockResolvedValue(mockTemplate as any);
      vi.mocked(prisma.agreement.findFirst).mockResolvedValue(mockAgreement as any);
      vi.mocked(prisma.agreement.findUnique).mockResolvedValue(mockAgreement as any);
      vi.mocked(prisma.agreement.update).mockResolvedValue({ id: "agreement-1" } as any);

      // Mutate step AGREEMENT
      await service.mutate(
        "test-token",
        "AGREEMENT",
        {
          tenant_signature_name: "Tenant User",
          tenant_signature_url: "https://sig-url.com",
        },
        { ip: "127.0.0.1", userAgent: "Mozilla" }
      );

      // Verify that prisma.agreement.update was called with the rule snapshot fields
      expect(prisma.agreement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "agreement-1" },
          data: expect.objectContaining({
            rules_snapshot: mockRuleVersion.content,
            rule_version_id: mockRuleVersion.id,
            rule_version_number: mockRuleVersion.version,
          }),
        })
      );
    });
  });

  describe("AgreementRenewalSigningService - signRenewalAgreement", () => {
    it("should store the rules_snapshot and update content_snapshot on renewal agreement signing", async () => {
      const mockRuleVersion = {
        id: "rule-renewal-uuid",
        version: "v3.0",
        content: {
          categories: [{ title: "Renewal Rules", highlights: [], rules: ["rule-renew"] }],
        },
      };

      const mockPredecessor = {
        id: "predecessor-1",
        status: "SIGNED",
        renewed_to_agreement_id: "renewal-1",
      };

      const mockTemplate = {
        id: "template-1",
        owner_name: "Owner Name",
        owner_signature_url: "https://sig.com",
        hostel_id: "hostel-1",
        status: "PUBLISHED",
        type: "RESIDENCY",
        rules_content: mockRuleVersion.content,
        version_number: 3,
        version: "v3.0",
      };

      const mockRenewalAgreement = {
        id: "renewal-1",
        tenant_id: "tenant-1",
        hostel_id: "hostel-1",
        status: "DRAFT",
        renewed_from_agreement_id: "predecessor-1",
        renewed_from_agreement: mockPredecessor,
        agreement_start_date: new Date(),
        agreement_end_date: new Date(),
        agreement_duration_months: 12,
        contract_rent: 6000,
        contract_security_deposit: 12000,
        contract_maintenance: 2000,
        contract_maintenance_type: "ONE_TIME",
        contract_payment_frequency: "MONTHLY",
        template: mockTemplate,
        tenant: {
          id: "tenant-1",
          owner_id: "owner-1",
          hostel_id: "hostel-1",
        },
      };

      vi.mocked(prisma.agreement.findUnique).mockResolvedValue(mockRenewalAgreement as any);
      vi.mocked(prisma.agreementTemplate.findFirst).mockResolvedValue(mockTemplate as any);
      vi.mocked(prisma.ruleVersion.findFirst).mockResolvedValue(mockRuleVersion as any);
      vi.mocked(prisma.ruleVersion.findUnique).mockResolvedValue(mockRuleVersion as any);
      vi.mocked(prisma.agreement.updateMany).mockResolvedValue({ count: 1 });

      const pdfGenerator = { generateAndUploadPdf: vi.fn().mockResolvedValue("https://cdn.example.com/renewal.pdf") };
      const renewalService = new AgreementRenewalSigningService(prisma, pdfGenerator as any, { log: vi.fn() } as any);

      await renewalService.signRenewalAgreement({
        renewalAgreementId: "renewal-1",
        tenantSignature: { signature_url: "sig-url", signature_name: "Tenant Name" },
        signedBy: "TENANT",
      });

      // Verify updateMany was called to update status to SIGNED with the rule fields
      expect(prisma.agreement.updateMany).toHaveBeenLastCalledWith(
        expect.objectContaining({
          where: { id: "renewal-1", status: "DRAFT", renewed_from_agreement_id: "predecessor-1" },
          data: expect.objectContaining({
            rules_snapshot: mockRuleVersion.content,
            rule_version_id: mockRuleVersion.id,
            rule_version_number: mockRuleVersion.version,
            content_snapshot: expect.objectContaining({
              hostel_rules: mockRuleVersion.content,
            }),
          }),
        })
      );
    });
  });

  describe("AgreementGenerationService - getAgreementRenderData", () => {
    it("should prioritize agreement.rules_snapshot over content_snapshot.hostel_rules", async () => {
      const rulesSnapshot = { categories: [{ title: "Snapshot Rules", highlights: [], rules: [] }] };
      const fallbackRules = { categories: [{ title: "Fallback Rules", highlights: [], rules: [] }] };

      const mockAgreement = {
        id: "agreement-1",
        hostel_id: "hostel-1",
        rules_snapshot: rulesSnapshot,
        content_snapshot: {
          hostel_rules: fallbackRules,
          tenant_name: "John Doe",
        },
        tenant: {
          joined_on: new Date(),
          room_allocations: [],
        },
        hostel: {
          name: "Test Hostel",
        },
        template: {
          owner_name: "Owner",
        },
      };

      vi.mocked(prisma.agreement.findUnique).mockResolvedValue(mockAgreement as any);

      const renderData = await AgreementGenerationService.getAgreementRenderData("agreement-1");
      expect(renderData.hostelRules).toEqual(rulesSnapshot);
    });

    it("should fall back to content_snapshot.hostel_rules when rules_snapshot is missing", async () => {
      const fallbackRules = { categories: [{ title: "Fallback Rules", highlights: [], rules: [] }] };

      const mockAgreement = {
        id: "agreement-1",
        hostel_id: "hostel-1",
        rules_snapshot: null,
        content_snapshot: {
          hostel_rules: fallbackRules,
          tenant_name: "John Doe",
        },
        tenant: {
          joined_on: new Date(),
          room_allocations: [],
        },
        hostel: {
          name: "Test Hostel",
        },
        template: {
          owner_name: "Owner",
        },
      };

      vi.mocked(prisma.agreement.findUnique).mockResolvedValue(mockAgreement as any);

      const renderData = await AgreementGenerationService.getAgreementRenderData("agreement-1");
      expect(renderData.hostelRules).toEqual(fallbackRules);
    });

    it("regression: should preserve snapshot integrity and ignore subsequent template updates", async () => {
      // Mock an existing signed agreement containing a frozen rules snapshot
      const historicalRules = { categories: [{ title: "Historical Rules Version 1", highlights: [], rules: ["rule-old"] }] };
      const updatedTemplateRules = { categories: [{ title: "Updated Rules Version 2", highlights: [], rules: ["rule-new"] }] };

      const mockAgreement = {
        id: "agreement-1",
        hostel_id: "hostel-1",
        rules_snapshot: historicalRules,
        content_snapshot: {
          hostel_rules: historicalRules,
          tenant_name: "Jane Doe",
        },
        tenant: {
          joined_on: new Date(),
          room_allocations: [],
        },
        hostel: {
          name: "Test Hostel",
        },
        template: {
          id: "template-1",
          owner_name: "Owner",
          // The template in database has been updated to Version 2
          rules_content: updatedTemplateRules,
        },
      };

      vi.mocked(prisma.agreement.findUnique).mockResolvedValue(mockAgreement as any);

      // Render data must yield the historical snapshot rules, NOT the updated database template rules
      const renderData = await AgreementGenerationService.getAgreementRenderData("agreement-1");
      expect(renderData.hostelRules).toEqual(historicalRules);
      expect(renderData.hostelRules).not.toEqual(updatedTemplateRules);
    });
  });

  describe("Onboarding Version Race Conditions", () => {
    it("should gracefully handle version race conditions by auto-accepting and signing the latest version", async () => {
      const service = new ActivationWorkflowService();

      const oldRuleVersion = { id: "rule-v1-uuid", version: "v1.0" };
      const newRuleVersion = {
        id: "rule-v2-uuid",
        version: "v2.0",
        content: { categories: [{ title: "New Version 2 Rules", highlights: [], rules: [] }] },
      };

      const mockTemplate = {
        id: "template-1",
        owner_name: "Hostel Owner",
        owner_signature_url: "https://sig.com",
        custom_rules: "Custom rule 1",
      };

      const mockAgreement = {
        id: "agreement-1",
        hostel_id: "hostel-1",
        status: "DRAFT",
        content_snapshot: {},
        contract_rent: 5000,
        contract_security_deposit: 10000,
        contract_maintenance: 1000,
        contract_maintenance_type: "ONE_TIME",
        contract_payment_frequency: "MONTHLY",
        agreement_start_date: new Date(),
        agreement_end_date: new Date(),
        agreement_duration_months: 12,
        tenant: null as any,
        hostel: { name: "Test Hostel" },
        template: mockTemplate,
      };

      const mockTenant: any = {
        id: "tenant-1",
        hostel_id: "hostel-1",
        status: "INVITED",
        phone_1: "1234567890",
        // Tenant accepted Version 1 rules originally
        rule_acceptances: [{ rule_version_id: "rule-v1-uuid" }],
        agreements: [mockAgreement],
        hostels: { name: "Test Hostel", rent_cycle: "MONTHLY", auto_rent_day: 1, preferences: {} },
        joined_on: new Date(),
        billing_start_date: new Date(),
        monthly_rent: 5000,
        security_deposit: 10000,
        maintenance_charge: 1000,
        maintenance_type: "ONE_TIME",
        payment_frequency: "MONTHLY",
        room_allocations: [],
      };

      mockAgreement.tenant = mockTenant;

      const mockProfile = { id: "profile-1", name: "Tenant User", phone: "1234567890", mobile_verified: true };
      const mockInvitation = { id: "invite-1", email: "tenant@example.com", phone: "1234567890", name: "Tenant User" };

      vi.spyOn(service as any, "resolveInvitation").mockResolvedValue({
        profile: mockProfile,
        tenant: mockTenant,
        invitation: mockInvitation,
      });

      vi.mocked(prisma.tenants.findUnique).mockResolvedValue(mockTenant as any);
      vi.mocked(prisma.agreementTemplate.findFirst).mockResolvedValue(mockTemplate as any);
      vi.mocked(prisma.agreement.findFirst).mockResolvedValue(mockAgreement as any);
      vi.mocked(prisma.agreement.update).mockResolvedValue({ id: "agreement-1" } as any);
      
      // Simulate that the active rule version is now Version 2 (published after tenant accepted Version 1)
      vi.spyOn(service as any, "getActiveRuleVersion").mockResolvedValue(newRuleVersion);

      // Call mutate to sign the agreement
      await service.mutate(
        "test-token",
        "AGREEMENT",
        {
          tenant_signature_name: "Tenant User",
          tenant_signature_url: "https://sig-url.com",
        },
        { ip: "127.0.0.1", userAgent: "Mozilla" }
      );

      // Verify that the agreement was updated with the latest rules version (v2.0)
      expect(prisma.agreement.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "agreement-1" },
          data: expect.objectContaining({
            rule_version_id: newRuleVersion.id,
            rule_version_number: newRuleVersion.version,
            rules_snapshot: newRuleVersion.content,
          }),
        })
      );
    });
  });

  describe("Audit Logs & Formatting Helpers", () => {
    it("should sanitize proxied IP lists to client IP", () => {
      expect(sanitizeIp("103.43.12.33, 172.68.22.45")).toBe("103.43.12.33");
      expect(sanitizeIp("  192.168.1.1  ")).toBe("192.168.1.1");
      expect(sanitizeIp(null)).toBe("N/A");
      expect(sanitizeIp("unknown")).toBe("N/A");
    });

    it("should parse browser user agent strings into human-readable device info", () => {
      const mobileUA = "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Mobile Safari/537.36";
      const desktopUA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/114.0.0.0 Safari/537.36";
      const tabletUA = "Mozilla/5.0 (iPad; CPU OS 15_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/15.6 Mobile/15E148 Safari/604.1";

      expect(parseUserAgent(mobileUA)).toEqual({
        device: "Mobile",
        os: "Android 10",
        browser: "Chrome",
      });

      expect(parseUserAgent(desktopUA)).toEqual({
        device: "Desktop",
        os: "Windows",
        browser: "Chrome",
      });

      expect(parseUserAgent(tabletUA)).toEqual({
        device: "Tablet",
        os: "iOS 15.6",
        browser: "Safari",
      });

      expect(parseUserAgent(null)).toEqual({
        device: "Unknown Device",
        os: "Unknown OS",
        browser: "Unknown Browser",
      });
    });

    it("should format dates and times to Indian locale standards (IST)", () => {
      const date = new Date("2026-06-19T13:10:00.000Z");

      expect(formatAgreementDate(date)).toBe("19-06-2026");
      expect(formatAgreementDateTime(date)).toBe("19-06-2026, 18:40:00 IST");
      expect(formatAgreementDate(null)).toBe("N/A");
      expect(formatAgreementDateTime(null)).toBe("N/A");
    });
  });
});
