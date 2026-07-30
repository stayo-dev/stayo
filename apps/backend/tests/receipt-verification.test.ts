import { describe, expect, it } from "vitest";
import crypto from "crypto";
import { generateVerificationToken, verifyToken } from "@/lib/receipt-verify";

describe("Receipt Verification Cryptographic Token Utility", () => {
  it("should generate a valid verification token structure", () => {
    const receiptId = "rec-12345-abcde";
    const issuedAt = new Date();
    
    const token = generateVerificationToken(receiptId, issuedAt);
    expect(token).toBeDefined();
    
    const parts = token.split(".");
    expect(parts.length).toBe(3);
    expect(parts[0]).toBe(receiptId);
    expect(parts[1]).toBe(issuedAt.getTime().toString());
    expect(parts[2].length).toBe(16); // 16 character slice
  });

  it("should successfully verify a valid generated token", () => {
    const receiptId = "receipt-uuid-999";
    const issuedAt = "2026-06-21T10:00:00.000Z";
    
    const token = generateVerificationToken(receiptId, issuedAt);
    const result = verifyToken(token);
    
    expect(result.valid).toBe(true);
    expect(result.receiptId).toBe(receiptId);
  });

  it("should reject tampered signature components", () => {
    const receiptId = "receipt-uuid-999";
    const issuedAt = "2026-06-21T10:00:00.000Z";
    
    const token = generateVerificationToken(receiptId, issuedAt);
    const parts = token.split(".");
    
    // Change signature slightly
    parts[2] = parts[2].substring(0, 15) + (parts[2][15] === "a" ? "b" : "a");
    const tamperedToken = parts.join(".");
    
    const result = verifyToken(tamperedToken);
    expect(result.valid).toBe(false);
    expect(result.receiptId).toBeNull();
  });

  it("should reject tampered receipt IDs", () => {
    const receiptId = "receipt-uuid-999";
    const issuedAt = "2026-06-21T10:00:00.000Z";
    
    const token = generateVerificationToken(receiptId, issuedAt);
    const parts = token.split(".");
    
    // Modify receiptId but keep timestamp and signature
    parts[0] = "receipt-uuid-888";
    const tamperedToken = parts.join(".");
    
    const result = verifyToken(tamperedToken);
    expect(result.valid).toBe(false);
    expect(result.receiptId).toBeNull();
  });

  it("should reject malformed tokens cleanly", () => {
    expect(verifyToken("invalidtoken")).toEqual({ valid: false, receiptId: null });
    expect(verifyToken("part1.part2")).toEqual({ valid: false, receiptId: null });
    expect(verifyToken("")).toEqual({ valid: false, receiptId: null });
  });
});

import { GET } from "@/app/api/verify/receipt/route";
import { prisma } from "@/lib/db";
import { NextRequest } from "next/server";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestTenant, allocateTestRoom } from "./factories/tenant-factory";
import { createTestRoom } from "./factories/room-factory";
import { createTestObligation, createTestPayment } from "./factories/payment-factory";

describe("Receipt Verification API GET Endpoint", () => {
  let owner: any;
  let hostel: any;
  let tenant: any;
  let room: any;

  beforeEach(async () => {
    await prisma.$executeRaw`TRUNCATE TABLE "test"."profiles" CASCADE`;

    owner = await createTestOwner();
    hostel = await createTestHostel(owner.id);
    room = await createTestRoom(hostel.id);
    tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
  });

  it("should reject requests without a token", async () => {
    const req = new NextRequest("http://localhost/api/verify/receipt");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Verification token is required");
  });

  it("should reject requests with an invalid/tampered token", async () => {
    const req = new NextRequest("http://localhost/api/verify/receipt?token=invalid.token.signature");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toBe("Invalid or tampered verification token");
  });

  it("should return verified details for a valid receipt token", async () => {
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id, { amount: 8200, total_amount: 8200 });
    const payment = await createTestPayment(obligation.id, 8200);
    const receiptId = crypto.randomUUID();
    
    const receipt = await prisma.receipts.create({
      data: {
        id: receiptId,
        receipt_number: "REC-SA-2026-0001",
        payment_id: payment.id,
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        amount: 8200,
        payment_method: "UPI",
      },
    });

    const token = generateVerificationToken(receipt.id, receipt.issued_at);
    const req = new NextRequest(`http://localhost/api/verify/receipt?token=${token}`);
    const res = await GET(req);
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.receipt_number).toBe("REC-SA-2026-0001");
    expect(json.data.amount).toBe(8200);
    expect(json.data.tenant_name).toBeDefined();
    expect(json.data.room_no).toBe(room.room_no);
    expect(json.data.outstanding_dues).toBe(0);
  });

  it("should return verified details for a valid ledger credit entry (fallback)", async () => {
    const ledgerId = crypto.randomUUID();
    const referenceId = crypto.randomUUID();
    const ledgerEntry = await prisma.tenant_financial_ledger.create({
      data: {
        id: ledgerId,
        tenant_id: tenant.id,
        owner_id: owner.id,
        hostel_id: hostel.id,
        amount: 5000,
        balance_after: 5000,
        type: "CREDIT",
        reason: "FUTURE_RENT_CREDIT_TOPUP",
        reference_type: "CASH_TRANSACTION",
        reference_id: referenceId,
        created_by: owner.id,
      },
    });

    const token = generateVerificationToken(ledgerEntry.id, ledgerEntry.created_at);
    const req = new NextRequest(`http://localhost/api/verify/receipt?token=${token}`);
    const res = await GET(req);
    
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.amount).toBe(5000);
    expect(json.data.payment_method).toBe("Future rent credit");
    expect(json.data.transaction_id).toBe(referenceId);
    expect(json.data.future_credit).toBe(5000);
  });

  it("should return 404 if receipt or ledger record is not found in database", async () => {
    const fakeReceiptId = crypto.randomUUID();
    const token = generateVerificationToken(fakeReceiptId, new Date());
    const req = new NextRequest(`http://localhost/api/verify/receipt?token=${token}`);
    const res = await GET(req);
    
    expect(res.status).toBe(404);
    const json = await res.json();
    expect(json.error).toBe("Receipt or ledger record not found");
  });
});

