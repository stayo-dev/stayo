import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  buildPlatformLeadFromReferral,
  referralNote,
} from "@/src/services/marketing/platform-listing-leads";
import type { CoverageDetails, RecordCoverageRequestInput } from "./coverage-request-rules";

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

  /**
   * Complete a referral that was already saved: the owner's number, or the
   * area when the student did not have one.
   *
   * **Fills blanks only.** The id is an unguessable uuid, but this endpoint is
   * public, so a second write must never be able to overwrite a first — a
   * `null` guard in the `where` makes a late or replayed request a no-op
   * rather than a way to edit somebody else's referral.
   */
  async attachDetails(id: string, details: CoverageDetails): Promise<{ updated: boolean }> {
    const row = await prisma.coverage_requests.findFirst({
      where: { id, kind: "HOSTEL" },
      select: { id: true, hostel_name: true, owner_contact: true, area_query: true },
    });
    if (!row) return { updated: false };

    const data: Record<string, string> = {};
    if (details.ownerContact && !row.owner_contact) data.owner_contact = details.ownerContact;
    if (details.areaQuery && !row.area_query) {
      data.area_query = details.areaQuery;
      if (details.normalizedQuery) data.normalized_query = details.normalizedQuery;
    }
    if (Object.keys(data).length === 0) return { updated: false };

    await prisma.coverage_requests.update({ where: { id: row.id }, data });

    // The number is the entire point of the second step — it has to reach the
    // sales lead, not just sit on the referral row.
    if (data.owner_contact && row.hostel_name) {
      await (async () => {
        const open = await prisma.platform_leads.findFirst({
          where: { hostel_name: row.hostel_name, status: { notIn: ["LOST", "LIVE"] } },
          orderBy: { created_at: "desc" },
          select: { id: true, notes: true },
        });
        if (!open) return;
        await prisma.platform_leads.update({
          where: { id: open.id },
          data: { notes: referralNote(open.notes, data.owner_contact), updated_at: new Date() },
        });
      })().catch(() => undefined);
    }

    return { updated: true };
  },
};
