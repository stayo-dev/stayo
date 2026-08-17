export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { settlementRunService } from "@/src/services/settlements/settlement-run-service";
import { settlementError, requireSettlementAdmin } from "@/src/services/settlements/settlement-http";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession(req);
  const { id } = await params;
  try {
    requireSettlementAdmin(session);
    const body = await req.json().catch(() => ({}));
    return apiResponse({
      item: await settlementRunService.markFailed(id, session.sub, String(body?.reason ?? "")),
    });
  } catch (error: any) {
    return settlementError(error, apiError);
  }
}
