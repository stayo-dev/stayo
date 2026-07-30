import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renewalOfferService } from "@/src/services/tenants/renewal-offer-service";

/** POST — Generate a renewal offer for a specific agreement */
export async function POST(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { proposed_rent, proposed_security_deposit, proposed_maintenance, proposed_maintenance_type,
      proposed_duration_months, proposed_payment_frequency, proposed_start_date, effective_from, owner_notes } = body;

    if (!proposed_rent || !proposed_security_deposit || !proposed_duration_months) {
      return NextResponse.json({ error: "proposed_rent, proposed_security_deposit, and proposed_duration_months are required" }, { status: 400 });
    }

    const offer = await renewalOfferService.generateOffer(params.id, session.sub, {
      proposed_rent: Number(proposed_rent),
      proposed_security_deposit: Number(proposed_security_deposit),
      proposed_maintenance: proposed_maintenance ? Number(proposed_maintenance) : undefined,
      proposed_maintenance_type,
      proposed_duration_months: Number(proposed_duration_months),
      proposed_payment_frequency,
      proposed_start_date,
      effective_from,
      owner_notes,
    });

    return NextResponse.json({ offer }, { status: 201 });
  } catch (error: any) {
    const status = error.message?.startsWith("NOT_FOUND") ? 404
      : error.message?.startsWith("FORBIDDEN") ? 403
      : error.message?.startsWith("CONFLICT") ? 409
      : error.message?.startsWith("BAD_REQUEST") ? 400 : 500;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
}
