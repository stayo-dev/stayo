import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invitationService: {
    activateTenant: vi.fn(),
    validateActivationToken: vi.fn(),
  },
  activationWorkflowService: {
    mutate: vi.fn(),
    getContext: vi.fn(),
  },
}));

vi.mock("@/src/services/tenants/invitation-service", () => ({
  invitationService: mocks.invitationService,
}));

vi.mock("@/src/services/tenants/activation-workflow-service", () => ({
  activationWorkflowService: mocks.activationWorkflowService,
}));

vi.mock("@/lib/onboarding-metrics", () => ({
  withOnboardingMetrics: (response: any) => response,
}));

describe("activation route financial enforcement errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 409 DEPOSIT_OUTSTANDING with structured details from legacy activation", async () => {
    mocks.invitationService.activateTenant.mockRejectedValue({
      code: "DEPOSIT_OUTSTANDING",
      status: 409,
      message: "Security deposit must be cleared before activation",
      details: {
        requiredDeposit: 10000,
        paidDeposit: 4000,
        outstandingDeposit: 6000,
      },
    });
    const { POST } = await import("@/app/api/tenants/activate/route");

    const response = await POST(new Request("http://localhost/api/tenants/activate", {
      method: "POST",
      body: JSON.stringify({
        token: "activation-token",
        password: "password123",
        confirm_password: "password123",
      }),
    }) as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toEqual({
      code: "DEPOSIT_OUTSTANDING",
      message: "Security deposit must be cleared before activation",
      details: {
        requiredDeposit: 10000,
        paidDeposit: 4000,
        outstandingDeposit: 6000,
      },
    });
  });

  it("returns 409 ONBOARDING_FINANCIALS_INCOMPLETE with complete readiness payload from workflow activation", async () => {
    const details = {
      requiredDeposit: 10000,
      paidDeposit: 0,
      depositOutstanding: 10000,
      requiredMaintenance: 1000,
      paidMaintenance: 0,
      maintenanceOutstanding: 1000,
      isDepositCleared: false,
      isMaintenanceCleared: false,
      isFinanciallyReady: false,
    };
    mocks.activationWorkflowService.mutate.mockRejectedValue({
      code: "ONBOARDING_FINANCIALS_INCOMPLETE",
      status: 409,
      message: "Security deposit and maintenance must be cleared before activation",
      details,
    });
    const { PATCH } = await import("@/app/api/tenants/activate/route");

    const response = await PATCH(new Request("http://localhost/api/tenants/activate", {
      method: "PATCH",
      body: JSON.stringify({
        token: "activation-token",
        step: "ACTIVATE",
        data: {},
      }),
    }) as any);
    const payload = await response.json();

    expect(response.status).toBe(409);
    expect(payload.error).toEqual({
      code: "ONBOARDING_FINANCIALS_INCOMPLETE",
      message: "Security deposit and maintenance must be cleared before activation",
      details,
    });
  });
});
