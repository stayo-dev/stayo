/**
 * Admin -> Direct Owner Onboarding (field/direct marketing channel).
 * Route-handler-level tests against real Postgres, mirroring the pattern in
 * leads-self-serve-duplicate.test.ts. Exercises the new
 * POST /api/platform-admin/owners, PATCH .../onboarding-setup, the
 * DIRECT_ADMIN phone-verified guard on approveLead, and the resend gap fix —
 * without touching or re-verifying the unrelated website lead flow (covered
 * by its own existing tests).
 */
import crypto from "crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as createOwner } from "@/app/api/platform-admin/owners/route";
import { PATCH as onboardingSetup } from "@/app/api/platform-admin/leads/[id]/onboarding-setup/route";
import { POST as approveLead } from "@/app/api/platform-admin/leads/[id]/approve/route";
import { POST as resendInvitation } from "@/app/api/platform-admin/leads/[id]/resend-invitation/route";
import { prisma } from "@/lib/db";

const ADMIN_ID = "99999999-9999-9999-9999-999999999999";
const OTP_PURPOSE = "PHONE_VERIFICATION";

function freshPhone() {
  const suffix = Math.floor(1000000000 + Math.random() * 8999999999).toString().slice(0, 10);
  return suffix;
}

async function markPhoneVerified(normalizedPhone: string) {
  await prisma.phoneVerificationOtp.create({
    data: {
      phone: normalizedPhone,
      otp_hash: "test-hash",
      purpose: OTP_PURPOSE,
      status: "VERIFIED",
      expires_at: new Date(Date.now() + 5 * 60 * 1000),
      verified_at: new Date(),
    },
  });
}

function adminReq(url: string, body?: Record<string, unknown>, method = "POST"): NextRequest {
  return new NextRequest(url, {
    method,
    headers: {
      "x-auth-mode": "legacy",
      "x-user-id": ADMIN_ID,
      "x-user-role": "ADMIN",
      "x-user-email": "admin@test.local",
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  } as any);
}

function ownerReq(url: string, body?: Record<string, unknown>): NextRequest {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "x-auth-mode": "legacy",
      "x-user-id": "11111111-1111-1111-1111-111111111111",
      "x-user-role": "OWNER",
      "content-type": "application/json",
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  } as any);
}

describe("POST /api/platform-admin/owners", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rejects a non-admin caller", async () => {
    const phone = freshPhone();
    const res = await createOwner(
      ownerReq("http://localhost/api/platform-admin/owners", { name: "X", email: `x-${phone}@test.local`, phone }),
    );
    expect(res.status).toBe(403);
  });

  it("rejects when the phone has no fresh OTP verification", async () => {
    const phone = freshPhone();
    const res = await createOwner(
      adminReq("http://localhost/api/platform-admin/owners", {
        name: "Ravi Owner",
        email: `ravi-${phone}@test.local`,
        phone,
      }),
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("PHONE_NOT_VERIFIED");
  });

  it("creates a DIRECT_ADMIN lead once the phone is OTP-verified, and never marks it verified itself", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    await markPhoneVerified(normalizedPhone);

    const res = await createOwner(
      adminReq("http://localhost/api/platform-admin/owners", {
        name: "Asha Owner",
        email: `asha-${phone}@test.local`,
        phone,
      }),
    );
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.data.acquisition_source).toBe("DIRECT_ADMIN");
    expect(json.data.phone_verified).toBe(true);

    const row = await prisma.platform_leads.findUnique({ where: { id: json.data.id } });
    expect(row?.acquisition_source).toBe("DIRECT_ADMIN");
    expect(row?.status).toBe("NEW");
  });

  it("rejects a duplicate phone already used by a non-LOST lead", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    await markPhoneVerified(normalizedPhone);
    const first = await createOwner(
      adminReq("http://localhost/api/platform-admin/owners", { name: "First", email: `first-${phone}@test.local`, phone }),
    );
    expect(first.status).toBe(201);

    await markPhoneVerified(normalizedPhone);
    const second = await createOwner(
      adminReq("http://localhost/api/platform-admin/owners", { name: "Second", email: `second-${phone}@test.local`, phone }),
    );
    expect(second.status).toBe(409);
    const json = await second.json();
    expect(json.error.code).toBe("DUPLICATE_PHONE");
  });

  it("rejects when an existing profile already holds this email", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    const email = `existing-${phone}@test.local`;
    const existing = await prisma.profile.create({
      data: {
        id: crypto.randomUUID(),
        email,
        name: "Existing Owner",
        role: "OWNER",
      },
    });
    await markPhoneVerified(normalizedPhone);

    const res = await createOwner(
      adminReq("http://localhost/api/platform-admin/owners", { name: "New Name", email, phone }),
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("OWNER_EXISTS");

    await prisma.profile.delete({ where: { id: existing.id } });
  });
});

describe("PATCH /api/platform-admin/leads/[id]/onboarding-setup", () => {
  it("stores the admin's plan choice on a DIRECT_ADMIN lead", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    await markPhoneVerified(normalizedPhone);
    const createRes = await createOwner(
      adminReq("http://localhost/api/platform-admin/owners", { name: "Plan Test", email: `plan-${phone}@test.local`, phone }),
    );
    const { id } = (await createRes.json()).data;

    const res = await onboardingSetup(
      adminReq(`http://localhost/api/platform-admin/leads/${id}/onboarding-setup`, { plan_code: "STARTER" }, "PATCH"),
      { params: Promise.resolve({ id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.intended_plan_code).toBe("STARTER");

    const row = await prisma.platform_leads.findUnique({ where: { id } });
    expect(row?.intended_plan_code).toBe("STARTER");
    expect(row?.intended_plan_set_by).toBe(ADMIN_ID);
  });

  it("rejects plan pre-selection on a WEBSITE lead", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    const lead = await prisma.platform_leads.create({
      data: {
        name: "Website Lead",
        hostel_name: "Website Hostel",
        phone: normalizedPhone,
        status: "NEW",
        tracking_token: `${normalizedPhone}-web-token`,
      },
    });

    const res = await onboardingSetup(
      adminReq(`http://localhost/api/platform-admin/leads/${lead.id}/onboarding-setup`, { plan_code: "STARTER" }, "PATCH"),
      { params: Promise.resolve({ id: lead.id }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("NOT_DIRECT_ADMIN_LEAD");
  });
});

describe("approveLead guard for DIRECT_ADMIN leads", () => {
  it("refuses to send an invitation for an unverified DIRECT_ADMIN lead", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    // Created directly (bypassing the route, which would itself refuse this)
    // to exercise the service-level guard in isolation.
    const lead = await prisma.platform_leads.create({
      data: {
        name: "Unverified Direct",
        hostel_name: "Unverified Direct",
        phone: normalizedPhone,
        phone_verified: false,
        acquisition_source: "DIRECT_ADMIN",
        status: "NEW",
        tracking_token: `${normalizedPhone}-direct-unverified`,
      },
    });

    const res = await approveLead(
      adminReq(`http://localhost/api/platform-admin/leads/${lead.id}/approve`, undefined, "POST"),
      { params: Promise.resolve({ id: lead.id }) },
    );
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("PHONE_NOT_VERIFIED");

    const row = await prisma.platform_leads.findUnique({ where: { id: lead.id } });
    expect(row?.status).toBe("NEW");
  });
});

describe("POST /api/platform-admin/leads/[id]/resend-invitation", () => {
  it("allows resending after a lead has already reached INVITE_SENT (previously impossible via approve)", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    const lead = await prisma.platform_leads.create({
      data: {
        name: "Resend Me",
        hostel_name: "Resend Hostel",
        phone: normalizedPhone,
        status: "INVITE_SENT",
        tracking_token: `${normalizedPhone}-resend-token`,
      },
    });
    const originalInvitation = await prisma.platform_lead_invitations.create({
      data: { lead_id: lead.id, token: `${normalizedPhone}-orig`, status: "PENDING", expires_at: new Date(Date.now() + 86400000) },
    });

    // approveLead itself must still refuse — this is the documented gap.
    const approveAttempt = await approveLead(
      adminReq(`http://localhost/api/platform-admin/leads/${lead.id}/approve`, undefined, "POST"),
      { params: Promise.resolve({ id: lead.id }) },
    );
    expect(approveAttempt.status).toBe(409);

    const res = await resendInvitation(
      adminReq(`http://localhost/api/platform-admin/leads/${lead.id}/resend-invitation`, undefined, "POST"),
      { params: Promise.resolve({ id: lead.id }) },
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.lead.status).toBe("INVITE_SENT");

    const invitations = await prisma.platform_lead_invitations.findMany({ where: { lead_id: lead.id } });
    expect(invitations.length).toBe(2);
    expect(invitations.some((i: any) => i.id !== originalInvitation.id)).toBe(true);
  });
});
