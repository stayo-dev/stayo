import { beforeEach, describe, expect, it, vi } from "vitest";

/** The owner saw "VALIDATION: Only an unaccepted…" — the routing prefix leaked into the toast. */
const { mockTenantService } = vi.hoisted(() => ({ mockTenantService: { cancelInvitation: vi.fn() } }));
vi.mock("@/lib/db", () => ({ prisma: { owner_dashboard_snapshots: { updateMany: vi.fn(async () => ({})) } } }));
vi.mock("@/src/services/tenants/tenant-service", () => ({ tenantService: mockTenantService }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ sub: "owner-1", role: "OWNER" }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ data }), { status }),
  apiError: (message: string, code: string, status = 400) => new Response(JSON.stringify({ error: { message, code } }), { status }),
}));

import { POST } from "@/app/api/tenants/[id]/cancel-invitation/route";

const call = async () => {
  const res = await POST(new Request("https://api.test/x", { method: "POST" }) as any, { params: { id: "t-1" } });
  return { status: res.status, body: await res.json() };
};

beforeEach(() => vi.clearAllMocks());

describe("cancel-invitation route errors", () => {
  it("shows the rule, not its routing prefix", async () => {
    mockTenantService.cancelInvitation.mockRejectedValue(new Error("VALIDATION: Only an unaccepted invitation can be cancelled."));
    const { status, body } = await call();
    expect(status).toBe(400);
    expect(body.error).toEqual({ message: "Only an unaccepted invitation can be cancelled.", code: "VALIDATION_ERROR" });
  });

  it("same for not-found and forbidden", async () => {
    mockTenantService.cancelInvitation.mockRejectedValueOnce(new Error("NOT_FOUND: Tenant not found"));
    expect((await call()).body.error.message).toBe("Tenant not found");
    mockTenantService.cancelInvitation.mockRejectedValueOnce(new Error("FORBIDDEN: You can only manage your own tenants"));
    expect((await call()).body.error.message).toBe("You can only manage your own tenants");
  });
});
