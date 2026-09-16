import crypto from "crypto";
import { prisma } from "../../../lib/db";
import { eventLog } from "../../../lib/services/event-log-service";

/**
 * Shared "create a platform_leads row, respecting the one-active-lead-per-
 * phone rule" logic — originally only in POST /api/leads/self-serve, now
 * also used by POST /api/platform-admin/owners (Admin -> Add Owner). Kept in
 * one place so the duplicate-detection/race-retry behavior (migration 078's
 * partial unique index) can never drift between the two acquisition
 * channels.
 */
export type CreatePlatformLeadInput = {
  name: string;
  hostel_name: string;
  phone: string; // already normalized (normalizeWhatsAppPhone)
  google_email?: string | null;
  city?: string | null;
  bed_count?: number | null;
  pain_point?: string | null;
  current_tooling?: string | null;
  phone_verified: boolean;
  acquisition_source: "WEBSITE" | "DIRECT_ADMIN";
};

export type CreatePlatformLeadResult =
  | { duplicate: false; lead: any }
  | { duplicate: true; lead: any };

async function findActiveLeadByPhone(phone: string) {
  return prisma.platform_leads.findFirst({
    where: { phone, status: { not: "LOST" } },
    orderBy: { created_at: "desc" },
  });
}

export async function createPlatformLead(input: CreatePlatformLeadInput): Promise<CreatePlatformLeadResult> {
  const existingLead = await findActiveLeadByPhone(input.phone);
  if (existingLead) {
    await eventLog.log("LEAD_DUPLICATE_BLOCKED", null, { lead_id: existingLead.id, phone: input.phone });
    return { duplicate: true, lead: existingLead };
  }

  try {
    const lead = await prisma.platform_leads.create({
      data: {
        name: input.name,
        hostel_name: input.hostel_name,
        phone: input.phone,
        google_email: input.google_email || null,
        phone_verified: input.phone_verified,
        city: input.city || null,
        bed_count: input.bed_count ?? null,
        pain_point: input.pain_point || null,
        current_tooling: input.current_tooling || null,
        status: "NEW",
        acquisition_source: input.acquisition_source,
        tracking_token: crypto.randomBytes(32).toString("hex"),
      },
    });
    await eventLog.log("LEAD_CREATED", null, {
      lead_id: lead.id,
      hostel_name: lead.hostel_name,
      acquisition_source: input.acquisition_source,
    });
    return { duplicate: false, lead };
  } catch (err: any) {
    if (err?.code !== "P2002") throw err;
    // Lost the race: another request created a non-LOST row for this exact
    // phone between findActiveLeadByPhone and this insert.
    const raced = await findActiveLeadByPhone(input.phone);
    if (raced) {
      await eventLog.log("LEAD_DUPLICATE_BLOCKED", null, { lead_id: raced.id, phone: input.phone, race: true });
      return { duplicate: true, lead: raced };
    }
    throw err;
  }
}
