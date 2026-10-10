import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `POST /api/tenants/resend-invitation` must hand back the refreshed link when
 * nothing delivered it (2026-10-10). It used to answer with only `{ error }`,
 * so the owner's screen fell back to the link it had cached — whose token the
 * resend had just replaced, so the tenant got "expired".
 */

const { mockInvitationService } = vi.hoisted(() => ({
  mockInvitationService: { resendInvitation: vi.fn() },
}));

vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("@/src/services/tenants/invitation-service", () => ({ invitationService: mockInvitationService }));
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn().mockResolvedValue({ sub: "owner-1", role: "OWNER" }),
  apiResponse: (data: any, status = 200) => new Response(JSON.stringify({ success: true, data }), { status }),
  apiError: (message: string, code: string, status = 400) =>
    new Response(JSON.stringify({ error: { message, code } }), { status }),
}));

import { POST } from "@/app/api/tenants/resend-invitation/route";

const LINK = "https://app.test/activate/new-token";
const call = async () => {
  const res = await POST(new Request("https://api.test/api/tenants/resend-invitation", {
    method: "POST",
    body: JSON.stringify({ identifier: "+918008046952" }),
  }) as any);
  return { status: res.status, body: await res.json() };
};

beforeEach(() => vi.clearAllMocks());

describe("resend route when delivery fails", () => {
  it("202 EMAIL_FALLBACK_REQUIRED carries the refreshed link and its expiry", async () => {
    mockInvitationService.resendInvitation.mockResolvedValue({
      whatsapp_sent: false, email_sent: false, needs_email: true, whatsapp_error: "not in allowed list",
      activation_link: LINK, expires_at: "2026-10-17T00:00:00.000Z",
    });
    const { status, body } = await call();
    expect(status).toBe(202);
    expect(body.error.code).toBe("EMAIL_FALLBACK_REQUIRED");
    expect(body.activation_link).toBe(LINK);
    expect(body.expires_at).toBe("2026-10-17T00:00:00.000Z");
  });

  it("502 DELIVERY_FAILED carries it too, with whether a reopened tenancy got its bed back", async () => {
    mockInvitationService.resendInvitation.mockResolvedValue({
      whatsapp_sent: false, email_sent: false, needs_email: false, email_error: "bounced",
      activation_link: LINK, expires_at: "2026-10-17T00:00:00.000Z", reopened: true, bed_held: false,
    });
    const { status, body } = await call();
    expect(status).toBe(502);
    expect(body).toMatchObject({ error: { code: "DELIVERY_FAILED" }, activation_link: LINK, reopened: true, bed_held: false });
  });

  it("a delivered resend is unchanged", async () => {
    mockInvitationService.resendInvitation.mockResolvedValue({ whatsapp_sent: true, email_sent: false, activation_link: LINK });
    const { status, body } = await call();
    expect(status).toBe(200);
    expect(body.data.activation_link).toBe(LINK);
  });
});
