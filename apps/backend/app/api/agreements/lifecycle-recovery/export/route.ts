export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession, apiError } from "@/lib/auth";
import { agreementLifecycleRecoveryService } from "@/src/services/tenants/agreement-lifecycle-recovery-service";

const CSV_HEADERS = [
  "agreement_id",
  "tenant",
  "hostel",
  "recommended_start_date",
  "agreement_start_date",
  "agreement_end_date",
  "agreement_duration_months",
];

function csvDate(value: unknown) {
  if (!value) return "";
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString().slice(0, 10);
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return apiError("Forbidden", "FORBIDDEN", 403);
  }

  try {
    const hostelId = req.nextUrl.searchParams.get("hostelId") || null;
    const ownerId = session.role === "OWNER"
      ? session.owner_id || session.sub
      : req.nextUrl.searchParams.get("ownerId") || null;

    const report = await agreementLifecycleRecoveryService.getRecoveryReport({ ownerId, hostelId });
    const rows = report.agreements.map((agreement: any) => [
      agreement.id,
      agreement.tenant?.name || "",
      agreement.hostel?.name || "",
      csvDate(agreement.recommended_start_date),
      csvDate(agreement.agreement_start_date),
      csvDate(agreement.agreement_end_date),
      agreement.agreement_duration_months || "",
    ]);

    const csv = [
      CSV_HEADERS.join(","),
      ...rows.map((row) => row.map(csvCell).join(",")),
    ].join("\n");

    return new NextResponse(`${csv}\n`, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="agreement-lifecycle-recovery.csv"',
      },
    });
  } catch (error: any) {
    return apiError(error.message || "Failed to export agreement lifecycle recovery report");
  }
}
