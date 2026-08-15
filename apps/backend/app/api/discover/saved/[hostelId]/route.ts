export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { discoveryService } from "@/src/services/discovery/discovery-service";
import { requireSeeker } from "@/src/services/discovery/seeker-session";
import { ApiResponse } from "@/src/lib/api-response";

export async function DELETE(req: NextRequest, { params }: { params: { hostelId: string } }) {
  try {
    const seeker = await requireSeeker(req);
    const result = await discoveryService.unsave(seeker.id, params.hostelId);
    return ApiResponse.success(result);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
