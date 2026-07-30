export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return ApiResponse.error(new Error("FORBIDDEN: Invalid cron secret"));
  }
  try {
    return ApiResponse.success(await admissionsService.expireReservations());
  } catch (error) {
    return ApiResponse.error(error);
  }
}
