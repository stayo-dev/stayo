export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { discoveryService, type DiscoverSort } from "@/src/services/discovery/discovery-service";
import { ApiResponse } from "@/src/lib/api-response";

const SORTS: DiscoverSort[] = ["recommended", "price_low", "newest"];

function intParam(value: string | null, fallback?: number) {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Public hostel search. Unauthenticated by design — browsing is the top of the
 * funnel and must be crawlable; only enquiring needs an account.
 */
export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;

    const sortParam = sp.get("sort") as DiscoverSort | null;
    const sharingParam = sp.get("sharing");

    const result = await discoveryService.search({
      q: sp.get("q") ?? undefined,
      city: sp.get("city") ?? undefined,
      minPrice: intParam(sp.get("min_price")),
      maxPrice: intParam(sp.get("max_price")),
      sharing: sharingParam
        ? sharingParam
            .split(",")
            .map((value) => Number.parseInt(value, 10))
            .filter((value) => Number.isFinite(value) && value > 0)
        : undefined,
      hostelType: sp.get("hostel_type") ?? undefined,
      foodIncluded: sp.get("food_included") === "true",
      hasVacancy: sp.get("has_vacancy") === "true",
      sort: sortParam && SORTS.includes(sortParam) ? sortParam : undefined,
      limit: intParam(sp.get("limit")),
      offset: intParam(sp.get("offset")),
    });

    return ApiResponse.success(result);
  } catch (error) {
    return ApiResponse.error(error);
  }
}
