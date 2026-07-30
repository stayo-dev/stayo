import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renewalOfferService } from "@/src/services/tenants/renewal-offer-service";
import type { RenewalStrategy } from "@/src/services/tenants/renewal-offer-service";

/** GET — List renewal offers for a hostel (owner pipeline view) */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const hostelId = req.nextUrl.searchParams.get("hostelId");
    if (!hostelId) return NextResponse.json({ error: "hostelId is required" }, { status: 400 });

    const status = req.nextUrl.searchParams.get("status") || undefined;
    const limit = Number(req.nextUrl.searchParams.get("limit") || 100);

    const result = await renewalOfferService.listOffers(session.sub, hostelId, { status, limit });
    return NextResponse.json(result);
  } catch (error: any) {
    const status = error.message?.startsWith("NOT_FOUND") ? 404
      : error.message?.startsWith("FORBIDDEN") ? 403 : 500;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
}

/** POST — Generate bulk renewal offers */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { hostelId, renewal_strategy, proposed_duration_months, proposed_rent, proposed_deposit,
      rent_increase_percent, category_rents, floor_rents, room_rents, filterCriteria, title } = body;

    if (!hostelId || !proposed_duration_months) {
      return NextResponse.json({ error: "hostelId and proposed_duration_months are required" }, { status: 400 });
    }

    const strategy = (renewal_strategy || "FLAT") as RenewalStrategy;
    if (strategy === "FLAT" && !proposed_rent) {
      return NextResponse.json({ error: "proposed_rent is required for FLAT strategy" }, { status: 400 });
    }
    if (strategy === "PERCENTAGE" && !rent_increase_percent) {
      return NextResponse.json({ error: "rent_increase_percent is required for PERCENTAGE strategy" }, { status: 400 });
    }
    if (strategy === "ROOM_CATEGORY" && !category_rents) {
      return NextResponse.json({ error: "category_rents is required for ROOM_CATEGORY strategy" }, { status: 400 });
    }
    if (strategy === "FLOOR_WISE" && !floor_rents) {
      return NextResponse.json({ error: "floor_rents is required for FLOOR_WISE strategy" }, { status: 400 });
    }
    if (strategy === "ROOM_WISE" && !room_rents) {
      return NextResponse.json({ error: "room_rents is required for ROOM_WISE strategy" }, { status: 400 });
    }

    const result = await renewalOfferService.generateBulkOffers({
      ownerId: session.sub,
      hostelId,
      renewal_strategy: strategy,
      proposed_duration_months: Number(proposed_duration_months),
      proposed_rent: proposed_rent ? Number(proposed_rent) : undefined,
      proposed_deposit: proposed_deposit ? Number(proposed_deposit) : undefined,
      rent_increase_percent: rent_increase_percent ? Number(rent_increase_percent) : undefined,
      category_rents,
      floor_rents,
      room_rents,
      filterCriteria,
      title,
    });

    return NextResponse.json(result, { status: 201 });
  } catch (error: any) {
    const status = error.message?.startsWith("NOT_FOUND") ? 404
      : error.message?.startsWith("FORBIDDEN") ? 403 : 500;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
}
