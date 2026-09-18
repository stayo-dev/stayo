export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";

import { ApiResponse } from "@/src/lib/api-response";
import { homepageFeatureService } from "@/src/services/discovery/homepage-feature-service";

/**
 * The homepage line-up: admin-curated when a line-up exists, the default
 * recommended sort when it does not.
 *
 * Public, like the rest of browse — this is the top of the funnel and has to be
 * crawlable.
 */
export async function GET(_req: NextRequest) {
  try {
    const payload = await homepageFeatureService.homepageListings();
    return ApiResponse.success(payload);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
