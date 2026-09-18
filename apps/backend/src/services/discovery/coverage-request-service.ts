import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  buildPlatformLeadFromReferral,
  referralNote,
} from "@/src/services/marketing/platform-listing-leads";
import type { RecordCoverageRequestInput } from "./coverage-request-rules";

/**
 * A student referral becomes a sales lead on the owner, deduped by hostel name
 * exactly as the Discover demand path does (discovery-service.ts).
 *
 * Never fatal to the caller: the coverage request itself is already committed,
 * and losing a student's signal because the sales side failed would be the
 * wrong trade.
 */
async function raiseReferralLead(hostelName: string, ownerContact: string | null): Promise<void> {
  const open = await prisma.platform_leads.findFirst({
    where: { hostel_name: hostelName, status: { notIn: ["LOST", "LIVE"] } },
    orderBy: { created_at: "desc" },
    select: { id: true, notes: true },
  });

  if (open) {
    await prisma.platform_leads.update({
      where: { id: open.id },
      data: { notes: referralNote(open.notes, ownerContact), updated_at: new Date() },
    });
    return;
  }

  await prisma.platform_leads.create({
    data: {
      ...buildPlatformLeadFromReferral({ hostelName, ownerContact }),
      tracking_token: crypto.randomUUID(),
    },
  });
}

export const coverageRequestService = {
  /**
   * Persist one supply request.
   *
   * `lib/db` exports `prisma: any`, so the payload is pinned with `satisfies`
   * — without it a missing required field only surfaces at runtime.
   */
  async record(input: RecordCoverageRequestInput): Promise<{ id: string; willNotify: boolean }> {
    const data = {
      kind: input.kind,
      area_query: input.areaQuery,
      normalized_query: input.normalizedQuery,
      hostel_name: input.hostelName,
      owner_contact: input.ownerContact,
      contact_phone: input.contactPhone,
      contact_email: input.contactEmail,
      source: input.source,
      seeker_profile_id: input.seekerProfileId,
    } satisfies Prisma.coverage_requestsUncheckedCreateInput;

    const row = await prisma.coverage_requests.create({ data, select: { id: true } });

    // A named hostel is an owner worth approaching, so it joins the sales
    // pipeline labelled STUDENT_REFERRAL — never as an owner who applied.
    if (input.kind === "HOSTEL" && input.hostelName) {
      await raiseReferralLead(input.hostelName, input.ownerContact).catch(() => undefined);
    }

    // A referral notifies nobody: the contact we hold is the owner's, and we
    // are the ones who will call them.
    return {
      id: row.id,
      willNotify: input.kind === "AREA" && Boolean(input.contactPhone || input.contactEmail),
    };
  },
};
