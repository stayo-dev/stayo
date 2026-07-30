export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const TEMPLATE_ROWS = [
  ["Name", "Email", "Phone", "Room", "Monthly Rent", "Joining Date", "Deposit", "Notes"],
  [
    "Example Student",
    "student@example.com",
    "9876543210",
    "G1",
    "8500",
    "2026-07-01",
    "25500",
    "Use YYYY-MM-DD dates. Do not use spreadsheet formulas.",
  ],
];

function csvEscape(value: string) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  if (!session || !["OWNER", "ADMIN"].includes(session.role)) {
    return NextResponse.json({ error: { message: "Only owners/admins can download import templates" } }, { status: 403 });
  }

  const csv = TEMPLATE_ROWS.map((row) => row.map(csvEscape).join(",")).join("\n");
  return new NextResponse(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="tenant-invitation-import-template.csv"',
    },
  });
}
