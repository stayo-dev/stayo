import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST as confirmIdentity } from "@/app/api/auth/confirm-identity/route";
import { prisma } from "@/lib/db";
import { createTestOwner } from "./factories/owner-factory";
import { authService } from "@/lib/services/auth-service";

function postConfirmIdentity(body: Record<string, unknown>) {
  return confirmIdentity(
    new NextRequest("http://localhost/api/auth/confirm-identity", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/auth/confirm-identity — purpose generalization", () => {
  let owner: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;
    owner = await createTestOwner();
    vi.spyOn(authService, "getCurrentUser").mockResolvedValue({ id: owner.id, role: "OWNER" } as any);
  });

  it("issues an OFFLINE_PAYMENT token by default when no purpose is given", async () => {
    const res = await postConfirmIdentity({ password: "Password123!" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.purpose).toBe("OFFLINE_PAYMENT");

    const stored = await prisma.identity_tokens.findFirst({ where: { user_id: owner.id } });
    expect(stored?.purpose).toBe("OFFLINE_PAYMENT");
    expect(stored?.action).toBe("record_offline_payment");
  });

  it("issues a WAIVE_OBLIGATION token when purpose=WAIVE_OBLIGATION is requested", async () => {
    const res = await postConfirmIdentity({ password: "Password123!", purpose: "WAIVE_OBLIGATION" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.purpose).toBe("WAIVE_OBLIGATION");

    const stored = await prisma.identity_tokens.findFirst({ where: { user_id: owner.id } });
    expect(stored?.purpose).toBe("WAIVE_OBLIGATION");
    expect(stored?.action).toBe("waive_obligation");
  });

  it("issues a CANCEL_OBLIGATION token when purpose=CANCEL_OBLIGATION is requested", async () => {
    const res = await postConfirmIdentity({ password: "Password123!", purpose: "CANCEL_OBLIGATION" });
    const json = await res.json();
    expect(res.status).toBe(200);
    expect(json.purpose).toBe("CANCEL_OBLIGATION");
  });

  it("rejects an unrecognized purpose", async () => {
    const res = await postConfirmIdentity({ password: "Password123!", purpose: "DELETE_TENANT" });
    expect(res.status).toBe(400);
  });

  it("rejects an invalid password regardless of purpose", async () => {
    const res = await postConfirmIdentity({ password: "wrong-password", purpose: "WAIVE_OBLIGATION" });
    expect(res.status).toBe(401);
  });
});
