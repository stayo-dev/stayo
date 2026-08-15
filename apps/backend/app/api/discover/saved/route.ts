export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { discoveryService } from "@/src/services/discovery/discovery-service";
import { requireSeeker } from "@/src/services/discovery/seeker-session";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";

const SaveSchema = z.object({ hostel_id: z.string().uuid() });

export async function GET(req: NextRequest) {
  try {
    const seeker = await requireSeeker(req);
    const saved = await discoveryService.listSaved(seeker.id);
    return ApiResponse.success(saved);
  } catch (error) {
    return ApiResponse.error(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const seeker = await requireSeeker(req);
    const body = await req.json().catch(() => ({}));
    const parsed = SaveSchema.safeParse(body);
    if (!parsed.success) throw ApiError.validationError("A hostel id is required");

    const result = await discoveryService.save(seeker.id, parsed.data.hostel_id);
    return ApiResponse.success(result);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
