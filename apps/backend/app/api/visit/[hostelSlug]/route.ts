export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { admissionsService } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";

export async function GET(_req: NextRequest, { params }: { params: { hostelSlug: string } }) {
  try {
    const data = await admissionsService.getPublicHostel(params.hostelSlug);
    return ApiResponse.success(data);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
