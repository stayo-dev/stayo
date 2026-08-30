import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/leads/self-serve/route";
import { prisma } from "@/lib/db";

const OTP_PURPOSE = "LEAD_CAPTURE";

/** A fresh, unique 10-digit local number per test — normalizes to 91-prefixed 12 digits. */
function freshPhone() {
  const suffix = Math.floor(1000000000 + Math.random() * 8999999999)
    .toString()
    .slice(0, 10);
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

function buildRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/leads/self-serve", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/leads/self-serve — duplicate-phone prevention", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("blocks a resubmission when a non-LOST lead already exists for the phone", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    await markPhoneVerified(normalizedPhone);

    const first = await POST(
      buildRequest({ name: "Asha", hostel_name: "Green Nest", phone }),
    );
    expect(first.status).toBe(201);
    const firstJson = await first.json();
    expect(firstJson.data.duplicate).toBe(false);

    // A second OTP round for the same number, then resubmit.
    await markPhoneVerified(normalizedPhone);
    const second = await POST(
      buildRequest({ name: "Asha", hostel_name: "Green Nest", phone }),
    );
    expect(second.status).toBe(200);
    const secondJson = await second.json();
    expect(secondJson.data.duplicate).toBe(true);
    expect(secondJson.data.id).toBe(firstJson.data.id);
    expect(secondJson.data.tracking_token).toBe(firstJson.data.tracking_token);

    const rows = await prisma.platform_leads.findMany({ where: { phone: normalizedPhone } });
    expect(rows.length).toBe(1);
  });

  it("allows a reapplication once the prior lead for that phone is LOST", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    await markPhoneVerified(normalizedPhone);

    const first = await POST(
      buildRequest({ name: "Ravi", hostel_name: "Blue Hostel", phone }),
    );
    const firstJson = await first.json();
    await prisma.platform_leads.update({
      where: { id: firstJson.data.id },
      data: { status: "LOST" },
    });

    await markPhoneVerified(normalizedPhone);
    const second = await POST(
      buildRequest({ name: "Ravi", hostel_name: "Blue Hostel", phone }),
    );
    expect(second.status).toBe(201);
    const secondJson = await second.json();
    expect(secondJson.data.duplicate).toBe(false);
    expect(secondJson.data.id).not.toBe(firstJson.data.id);

    const rows = await prisma.platform_leads.findMany({ where: { phone: normalizedPhone } });
    expect(rows.length).toBe(2);
  });

  it("rejects submission before any duplicate check when the phone has no fresh OTP verification", async () => {
    const phone = freshPhone();
    const res = await POST(buildRequest({ name: "No Otp", hostel_name: "No Otp Hostel", phone }));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error.code).toBe("PHONE_NOT_VERIFIED");
  });

  it("falls back to the duplicate response instead of a 500 when create loses a race", async () => {
    const phone = freshPhone();
    const normalizedPhone = `91${phone}`;
    await markPhoneVerified(normalizedPhone);

    // Simulate another concurrent request having already created the row:
    // seed it for real, but make the route's own pre-check findFirst miss it
    // exactly once, so the flow reaches the create call and collides.
    const racedWinner = await prisma.platform_leads.create({
      data: {
        name: "Concurrent Winner",
        hostel_name: "Race Hostel",
        phone: normalizedPhone,
        status: "NEW",
        tracking_token: `${normalizedPhone}-race-token`,
      },
    });

    vi.spyOn(prisma.platform_leads, "findFirst").mockImplementationOnce(async () => null);
    vi.spyOn(prisma.platform_leads, "create").mockImplementationOnce(async () => {
      throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
    });

    const res = await POST(buildRequest({ name: "Late Arrival", hostel_name: "Race Hostel", phone }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.duplicate).toBe(true);
    expect(json.data.id).toBe(racedWinner.id);

    const rows = await prisma.platform_leads.findMany({ where: { phone: normalizedPhone } });
    expect(rows.length).toBe(1);
  });
});
