export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { ApiResponse } from "@/src/lib/api-response";
import { parseCoverageDetails } from "@/src/services/discovery/coverage-request-rules";
import { coverageRequestService } from "@/src/services/discovery/coverage-request-service";

const MAX_ATTEMPTS = 20;
const WINDOW_SECONDS = 60 * 60;

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Complete a referral that was already saved — the owner's number, or the area
 * when the student did not have one.
 *
 * Public, and deliberately so: the whole design is that the referral is banked
 * first and this second step is optional, which only works if it needs no
 * account. The id is an unguessable uuid and the service fills blanks only, so
 * this cannot overwrite an earlier answer.
 */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const limit = await checkFixedWindowLimit({
      scope: "coverage-request-detail",
      identifier: clientIp(req),
      maxAttempts: MAX_ATTEMPTS,
      windowSeconds: WINDOW_SECONDS,
    });
    if (!limit.allowed) {
      return NextResponse.json(
        { success: false, error: "RATE_LIMITED", retry_after_seconds: limit.retryAfterSeconds },
        { status: 429 },
      );
    }

    const body = await req.json().catch(() => null);
    const parsed = parseCoverageDetails(body);
    if (!parsed.ok) {
      return NextResponse.json({ success: false, error: parsed.error }, { status: 400 });
    }

    const result = await coverageRequestService.attachDetails(params.id, parsed.value);
    // A row that is gone, already answered, or never a referral reports the
    // same thing: there was nothing to add. The student is told "thanks"
    // either way — arguing with them about it would help nobody.
    return ApiResponse.success({ updated: result.updated });
  } catch (error) {
    return ApiResponse.error(error);
  }
}
