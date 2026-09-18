import type { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import type { RecordCoverageRequestInput } from "./coverage-request-rules";

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

    // A referral notifies nobody: the contact we hold is the owner's, and we
    // are the ones who will call them.
    return {
      id: row.id,
      willNotify: input.kind === "AREA" && Boolean(input.contactPhone || input.contactEmail),
    };
  },
};
