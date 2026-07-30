import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renewalOfferService } from "@/src/services/tenants/renewal-offer-service";

/** GET — Get the active renewal offer for the logged-in tenant */
export async function GET(req: NextRequest) {
  try {
    const session = await getSession(req);
    if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const offer = await renewalOfferService.getActiveOfferForTenant(session.sub);
    return NextResponse.json({ offer });
  } catch (error: any) {
    const status = error.message?.startsWith("NOT_FOUND") ? 404 : 500;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
}
