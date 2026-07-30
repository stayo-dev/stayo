export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { paymentService } from "@/src/services/payments/payment-service";
import { prisma } from "@/lib/db";
import { PAYMENT_DOMAIN } from "@/src/services/payments/financial-domain";

export async function GET(req: NextRequest) {
  try {
    // Vercel Cron Security: Ensure the request comes from Vercel
    const authHeader = req.headers.get("authorization");
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    console.info("[cron.reconcile-payments] Starting reconciliation sweep...");

    const platform = await paymentService.reconcilePendingAttempts({
      paymentDomain: PAYMENT_DOMAIN.PLATFORM_BILLING,
    });

    const hostels = await prisma.hostels.findMany({
      where: { status: { in: ["ACTIVE", "INACTIVE"] } },
      select: { id: true, owner_id: true },
    });

    const rentResults = [];
    for (const hostel of hostels) {
      rentResults.push({
        hostel_id: hostel.id,
        owner_id: hostel.owner_id,
        result: await paymentService.reconcilePendingAttempts({
          ownerId: hostel.owner_id,
          hostelId: hostel.id,
          paymentDomain: PAYMENT_DOMAIN.RENT_COLLECTION,
        }),
      });
    }

    const result = {
      platform,
      hostels_processed: rentResults.length,
      rent: rentResults,
    };

    console.info("[cron.reconcile-payments] Finished successfully.", result);

    return NextResponse.json({ success: true, data: result }, { status: 200 });
  } catch (error: any) {
    console.error("[cron.reconcile-payments] Failed:", error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
