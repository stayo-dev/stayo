import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { renewalOfferService } from "@/src/services/tenants/renewal-offer-service";

/** PATCH — Revise an offer (owner creates revised version, supersedes old) */
export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const session = await getSession(req);
    if (!session?.sub) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await req.json();
    const { proposed_rent, proposed_security_deposit, proposed_duration_months,
      proposed_maintenance, proposed_maintenance_type, proposed_payment_frequency,
      proposed_start_date, effective_from, owner_notes } = body;

    if (!proposed_rent || !proposed_security_deposit || !proposed_duration_months) {
      return NextResponse.json({ error: "proposed_rent, proposed_security_deposit, and proposed_duration_months are required" }, { status: 400 });
    }

    const revised = await renewalOfferService.reviseOffer(params.id, session.sub, {
      proposed_rent: Number(proposed_rent),
      proposed_security_deposit: Number(proposed_security_deposit),
      proposed_duration_months: Number(proposed_duration_months),
      proposed_maintenance: proposed_maintenance ? Number(proposed_maintenance) : undefined,
      proposed_maintenance_type,
      proposed_payment_frequency,
      proposed_start_date,
      effective_from,
      owner_notes,
    });

    return NextResponse.json({ offer: revised });
  } catch (error: any) {
    const status = error.message?.startsWith("NOT_FOUND") ? 404
      : error.message?.startsWith("FORBIDDEN") ? 403
      : error.message?.startsWith("BAD_REQUEST") ? 400 : 500;
    return NextResponse.json({ error: { message: error.message } }, { status });
  }
}
