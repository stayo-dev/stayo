export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";

function requireAdmin(session: any) {
  if (!session || session.role !== "ADMIN") throw new Error("FORBIDDEN: Admin access only");
}

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/**
 * GET /api/platform-admin/revenue/export?report=revenue|subscriptions|outstanding
 * CSV exports for the Revenue tab's export panel.
 *
 * There is deliberately no GST report. Trishul Solutions is a sole
 * proprietorship that is not GST-registered, so a report back-computing 18%
 * GST on its subscription revenue asserted tax it never collected.
 */
export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const { searchParams } = new URL(req.url);
    const report = searchParams.get("report") || "revenue";

    let rows: string[][] = [];
    let filename = "revenue-report.csv";

    if (report === "subscriptions") {
      filename = "subscription-report.csv";
      const subs = await prisma.hostel_subscriptions.findMany({
        include: { hostels: { select: { name: true } }, subscription_plans: { select: { name: true } } },
      });
      rows = [
        ["Hostel", "Plan", "Billing Cycle", "Amount", "Status", "AutoPay", "Next Renewal"],
        ...subs.map((s: any) => [
          s.hostels.name,
          s.subscription_plans.name,
          s.billing_cycle,
          String(s.amount),
          s.status,
          s.autopay_enabled ? "Yes" : "No",
          s.next_renewal_at ? new Date(s.next_renewal_at).toISOString().slice(0, 10) : "",
        ]),
      ];
    } else if (report === "outstanding") {
      filename = "outstanding-payments.csv";
      const invoices = await prisma.platform_invoices.findMany({
        where: { status: { in: ["PENDING", "FAILED"] } },
        include: { hostels: { select: { name: true } } },
      });
      rows = [
        ["Invoice #", "Hostel", "Amount", "Status", "Created"],
        ...invoices.map((i: any) => [i.invoice_number, i.hostels.name, String(i.amount), i.status, new Date(i.created_at).toISOString().slice(0, 10)]),
      ];
    } else {
      const paid = await prisma.platform_invoices.findMany({
        where: { status: "PAID" },
        include: { hostels: { select: { name: true } } },
      });
      rows = [
        ["Invoice #", "Hostel", "Amount", "Paid At"],
        ...paid.map((i: any) => [i.invoice_number, i.hostels.name, String(i.amount), i.paid_at ? new Date(i.paid_at).toISOString().slice(0, 10) : ""]),
      ];
    }

    return new NextResponse(toCsv(rows), {
      status: 200,
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error: any) {
    const msg = String(error?.message || "Failed to export report");
    if (msg.startsWith("FORBIDDEN")) return apiError(msg.split(": ")[1] ?? msg, "FORBIDDEN", 403);
    return apiError(msg);
  }
}
