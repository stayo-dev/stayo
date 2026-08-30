import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { verifyToken } from "@/lib/receipt-verify";
import { financialService } from "@/src/services/payments/financial-service";
import { tenantFinancialLedgerService } from "@/src/services/payments/tenant-financial-ledger-service";

export const dynamic = "force-dynamic";


export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const token = searchParams.get("token");

    if (!token) {
      return NextResponse.json(
        { error: "Verification token is required" },
        { status: 400 }
      );
    }

    const { valid, receiptId } = verifyToken(token);
    if (!valid || !receiptId) {
      return NextResponse.json(
        { error: "Invalid or tampered verification token" },
        { status: 400 }
      );
    }

    // 1. Try finding standard receipt
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receiptId);

    const receipt = isUuid
      ? await prisma.receipts.findFirst({
          where: {
            OR: [
              { id: receiptId },
              { payment_id: receiptId },
            ],
          },
          include: {
            payments: true,
            tenants: { include: { profiles: true } },
            hostels: true,
          },
        })
      : await prisma.receipts.findFirst({
          where: { receipt_number: receiptId },
          include: {
            payments: true,
            tenants: { include: { profiles: true } },
            hostels: true,
          },
        });

    if (receipt) {
      const tenantId = receipt.tenant_id;
      const hostelId = receipt.hostel_id;
      const ownerId = receipt.owner_id || receipt.tenants?.owner_id || "";

      // Fetch active room allocation details
      const activeAllocation = await prisma.roomAllocation.findFirst({
        where: { tenant_id: tenantId, is_active: true },
        include: { room: true },
      });

      // Calculate dues and credits
      const dues = await financialService.getTenantDues(tenantId, undefined, hostelId);
      const outstanding_dues = Number(dues.total_payable_now || 0);

      const ledgerBalance = await tenantFinancialLedgerService.getBalance(tenantId, ownerId);
      const future_credit = Number(ledgerBalance.future_rent_credit || 0);

      return NextResponse.json({
        success: true,
        data: {
          id: receipt.id,
          receipt_number: receipt.receipt_number,
          amount: Number(receipt.amount),
          payment_method: receipt.payment_method,
          transaction_id: receipt.payments?.gateway_txn_id || receipt.payments?.merchant_txn_id || null,
          issued_at: receipt.issued_at.toISOString(),
          tenant_name: receipt.tenants?.profiles?.name || receipt.tenant_name || "Resident",
          room_no: activeAllocation?.room?.room_no || null,
          room_floor: activeAllocation?.room?.floor || null,
          hostel_name: receipt.hostels?.name || receipt.hostel_name || "Sunrise Residency",
          outstanding_dues,
          future_credit,
        },
      });
    }

    // 2. Try fallback to tenant_financial_ledger (e.g. for advances/ledger credits)
    if (isUuid) {
      const ledgerEntry = await prisma.tenant_financial_ledger.findUnique({
        where: { id: receiptId },
        include: {
          tenants: { include: { profiles: true } },
        },
      });

      if (ledgerEntry) {
        const tenantId = ledgerEntry.tenant_id;
        const hostelId = ledgerEntry.hostel_id;
        const ownerId = ledgerEntry.owner_id || ledgerEntry.tenants?.owner_id || "";

        // Fetch active room allocation details
        const activeAllocation = await prisma.roomAllocation.findFirst({
          where: { tenant_id: tenantId, is_active: true },
          include: { room: true },
        });

        // Fetch hostel
        const hostel = await prisma.hostels.findUnique({
          where: { id: hostelId },
        });

        // Calculate dues and credits
        const dues = await financialService.getTenantDues(tenantId, undefined, hostelId);
        const outstanding_dues = Number(dues.total_payable_now || 0);

        const ledgerBalance = await tenantFinancialLedgerService.getBalance(tenantId, ownerId);
        const future_credit = Number(ledgerBalance.future_rent_credit || 0);

        const year = new Date(ledgerEntry.created_at).getFullYear();
        const prefix = hostel?.preferences_config
          ? (hostel.preferences_config as any)?.receipt_prefix || "HMS"
          : "HMS";
        const receiptNumber = `ADV-${prefix}-${year}-${ledgerEntry.id.substring(0, 8).toUpperCase()}`;

        return NextResponse.json({
          success: true,
          data: {
            id: ledgerEntry.id,
            receipt_number: receiptNumber,
            amount: Number(ledgerEntry.amount),
            payment_method: ledgerEntry.reference_type === "PAYMENT_ATTEMPT" ? "ONLINE" : "Future rent credit",
            transaction_id: ledgerEntry.reference_id || null,
            issued_at: ledgerEntry.created_at.toISOString(),
            tenant_name: ledgerEntry.tenants?.profiles?.name || "Resident",
            room_no: activeAllocation?.room?.room_no || null,
            room_floor: activeAllocation?.room?.floor || null,
            hostel_name: hostel?.name || "Sunrise Residency",
            outstanding_dues,
            future_credit,
          },
        });
      }
    }

    return NextResponse.json(
      { error: "Receipt or ledger record not found" },
      { status: 404 }
    );
  } catch (error: any) {
    console.error("Receipt verification API error:", error);
    return NextResponse.json(
      { error: "Internal server error during verification" },
      { status: 500 }
    );
  }
}
