export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { z } from "zod";
import { admissionsService, ACTIVITY_SCORES } from "@/src/services/admissions/admissions-service";
import { ApiResponse } from "@/src/lib/api-response";
import { ApiError } from "@/src/lib/api-error";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";

const ActivitySchema = z.object({
  lead_id: z.string().uuid(),
  activity_type: z.enum(Object.keys(ACTIVITY_SCORES) as [string, ...string[]]),
  metadata: z.record(z.unknown()).optional(),
});

export async function POST(req: NextRequest, { params }: { params: { hostelSlug: string } }) {
  try {
    const body = await req.json().catch(() => ({}));
    const parsed = ActivitySchema.safeParse(body);
    if (!parsed.success) return ApiResponse.error(ApiError.validationError("Invalid activity"));

    const limit = await checkFixedWindowLimit({
      scope: "visit-activity",
      identifier: `${parsed.data.lead_id}:${req.headers.get("x-forwarded-for") || req.ip || "unknown"}`,
      maxAttempts: 120,
      windowSeconds: 60 * 60,
    });
    if (!limit.allowed) {
      return ApiResponse.error(new ApiError("Too many activity updates", 429, "TOO_MANY_REQUESTS"));
    }

    const result = await admissionsService.recordActivity(
      parsed.data.lead_id,
      parsed.data.activity_type,
      parsed.data.metadata || {},
      params.hostelSlug,
    );
    return ApiResponse.success(result);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
