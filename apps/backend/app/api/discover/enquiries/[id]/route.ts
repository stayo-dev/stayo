export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { discoveryService } from "@/src/services/discovery/discovery-service";
import { requireSeeker } from "@/src/services/discovery/seeker-session";
import { ApiResponse } from "@/src/lib/api-response";

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const seeker = await requireSeeker(req);
    const enquiry = await discoveryService.getEnquiry(seeker.id, params.id);
    return ApiResponse.success(enquiry);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
