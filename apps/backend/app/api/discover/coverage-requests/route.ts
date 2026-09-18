export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

import { getSession } from "@/lib/auth";
import { checkFixedWindowLimit } from "@/lib/redis/rate-limit";
import { ApiResponse } from "@/src/lib/api-response";
import { handleCoverageRequest } from "@/src/services/discovery/coverage-request-handler";
import { coverageRequestService } from "@/src/services/discovery/coverage-request-service";

/** Ten a day per address is generous for a person and useless for a script. */
const MAX_ATTEMPTS = 10;
const WINDOW_SECONDS = 60 * 60;

function clientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}

/**
 * Record demand Stayo cannot serve yet — an uncovered area, or a hostel a
 * student thinks should be listed.
 *
 * Public by design: this fires for visitors who have no account and no
 * intention of making one, and requiring a session would throw away the signal
 * from exactly the people we most need to hear from.
 */
export async function POST(req: NextRequest) {
  let body: unknown = null;
  try {
    body = await req.json();
  } catch {
    body = null;
  }

  const result = await handleCoverageRequest(body, clientIp(req), {
    checkLimit: async (ip) => {
      // A Redis outage must not take the endpoint down — `checkFixedWindowLimit`
      // already returns `allowed: true` when Redis is unreachable. Losing a
      // demand signal is worse than admitting a duplicate.
      const limit = await checkFixedWindowLimit({
        scope: "coverage-request",
        identifier: ip,
        maxAttempts: MAX_ATTEMPTS,
        windowSeconds: WINDOW_SECONDS,
      });
      return { allowed: limit.allowed, retryAfterSeconds: limit.retryAfterSeconds };
    },
    resolveSeekerProfileId: async () => {
      const session = await getSession(req);
      // Owners and admins browsing the marketplace are not seekers; attributing
      // their request to a seeker profile would misreport who wants what.
      return session?.role === "TENANT" ? session.sub : null;
    },
    record: (input) => coverageRequestService.record(input),
  });

  if (result.status === 201) {
    return ApiResponse.success(result.body, undefined, { status: 201 });
  }
  return NextResponse.json({ success: false, ...result.body }, { status: result.status });
}
