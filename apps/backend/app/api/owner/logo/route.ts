export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { apiError } from "@/lib/auth";

/**
 * Legacy logo endpoint intentionally refuses ambiguous owner-global updates.
 * Use /api/hostels/:id/logo so branding is always hostel-scoped.
 */
export async function POST(req: NextRequest) {
  const hostelId = req.nextUrl.searchParams.get("hostelId");
  if (!hostelId) return apiError("hostelId is required for logo upload", "HOSTEL_CONTEXT_REQUIRED", 400);
  return apiError("Use /api/hostels/:id/logo for hostel-scoped logo upload", "MOVED_TO_HOSTEL_SCOPED_ROUTE", 410);
}

export async function DELETE(req: NextRequest) {
  const hostelId = req.nextUrl.searchParams.get("hostelId");
  if (!hostelId) return apiError("hostelId is required for logo removal", "HOSTEL_CONTEXT_REQUIRED", 400);
  return apiError("Use /api/hostels/:id/logo for hostel-scoped logo removal", "MOVED_TO_HOSTEL_SCOPED_ROUTE", 410);
}
