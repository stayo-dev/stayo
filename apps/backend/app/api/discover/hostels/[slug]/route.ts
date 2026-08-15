export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { discoveryService } from "@/src/services/discovery/discovery-service";
import { ApiResponse } from "@/src/lib/api-response";

/**
 * Public listing detail. 404s for anything not currently discoverable — a
 * suspended or unverified hostel must not stay reachable by direct URL after it
 * drops out of search.
 */
export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  try {
    const listing = await discoveryService.getListing(params.slug);
    return ApiResponse.success(listing);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
