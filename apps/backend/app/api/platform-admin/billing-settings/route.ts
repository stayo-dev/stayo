export const dynamic = "force-dynamic";
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { getSession, apiResponse, apiError } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { eventLog } from "@/lib/services/event-log-service";
import { requireAdmin, subscriptionErrorResponse } from "@/src/services/platform-billing/subscription-http";

/**
 * GET / PUT /api/platform-admin/billing-settings  (ADR-172, Phase 5)
 *
 * The Stayo payee details the owner billing page shows, stored on the existing
 * `platform_settings` JSON store, key `"billing"` — no new schema. The owner's
 * `GET /api/owner/subscription/payment-context` reads the same row, so
 * configuring here lights up the owner's payment screen automatically.
 *
 * NO GST configuration here.
 */
const KEY = "billing";

type BillingSettings = {
  upi_vpa: string | null;
  qr_image_url: string | null;
  account_name: string | null;
  note: string | null;
  bank: { account_name?: string; account_no?: string; ifsc?: string; bank_name?: string } | null;
};

function normalise(input: any): BillingSettings {
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  const bank = input?.bank && typeof input.bank === "object" ? input.bank : null;
  return {
    upi_vpa: str(input?.upi_vpa),
    qr_image_url: str(input?.qr_image_url),
    account_name: str(input?.account_name),
    note: str(input?.note),
    bank: bank
      ? {
          account_name: str(bank.account_name) ?? undefined,
          account_no: str(bank.account_no) ?? undefined,
          ifsc: str(bank.ifsc) ?? undefined,
          bank_name: str(bank.bank_name) ?? undefined,
        }
      : null,
  };
}

export async function GET(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const row = await prisma.platform_settings.findUnique({ where: { key: KEY } });
    return apiResponse({ settings: normalise(row?.value ?? {}), configured: Boolean(row?.value) });
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.billing-settings.get");
  }
}

export async function PUT(req: NextRequest) {
  const session = await getSession(req);
  try {
    requireAdmin(session);
    const body = await req.json().catch(() => ({}));
    const next = normalise(body);

    // A UPI VPA looks like `name@bank`. Basic shape check only — never validated
    // against a real provider here.
    if (next.upi_vpa && !/^[\w.\-]{2,}@[a-zA-Z]{2,}$/.test(next.upi_vpa)) {
      return apiError("That doesn't look like a UPI VPA (e.g. stayo@hdfcbank).", "VALIDATION_ERROR", 400);
    }

    const existing = await prisma.platform_settings.findUnique({ where: { key: KEY } });
    const row = await prisma.platform_settings.upsert({
      where: { key: KEY },
      create: { key: KEY, value: next as any, updated_at: new Date() },
      update: { value: next as any, updated_at: new Date() },
    });

    await eventLog.log("BILLING_SETTINGS_CHANGED", null, {
      admin_id: (session as any).sub,
      had_previous: Boolean(existing),
      fields_set: Object.entries(next)
        .filter(([, v]) => v != null && (typeof v !== "object" || Object.keys(v).length))
        .map(([k]) => k),
    });

    return apiResponse({ settings: row.value });
  } catch (error) {
    return subscriptionErrorResponse(error, "platform-admin.billing-settings.put");
  }
}
