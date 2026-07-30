export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

const GONE = { ok: false, message: "Decommissioned: legacy subscription plans route removed in single-business migration" };

export async function GET(_req: NextRequest) {
  return NextResponse.json(GONE, { status: 410 });
}
