import { describe, expect, it, vi } from "vitest";
import { renewalTimelineService } from "@/src/services/tenants/renewal-timeline-service";

describe("RenewalTimelineService.registerEvent", () => {
  it("writes a timeline row via the provided tx client, mapping camelCase params to snake_case columns", async () => {
    const create = vi.fn().mockResolvedValue({ id: "event-1" });
    const tx = { renewalTimelineEvent: { create } };

    await renewalTimelineService.registerEvent(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      agreementId: "agreement-1",
      offerId: "offer-1",
      eventType: "OFFER_SENT",
      actorType: "OWNER",
      actorId: "owner-1",
      reason: "Sent to tenant",
      metadata: { proposedRent: 8800 },
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        hostel_id: "hostel-1",
        tenant_id: "tenant-1",
        agreement_id: "agreement-1",
        offer_id: "offer-1",
        event_type: "OFFER_SENT",
        actor_type: "OWNER",
        actor_id: "owner-1",
        reason: "Sent to tenant",
        metadata: { proposedRent: 8800 },
      },
    });
  });

  it("defaults optional fields to null when omitted", async () => {
    const create = vi.fn().mockResolvedValue({ id: "event-2" });
    const tx = { renewalTimelineEvent: { create } };

    await renewalTimelineService.registerEvent(tx, {
      hostelId: "hostel-1",
      tenantId: "tenant-1",
      eventType: "RENEWAL_ACTIVATED",
      actorType: "SYSTEM",
    });

    expect(create).toHaveBeenCalledWith({
      data: {
        hostel_id: "hostel-1",
        tenant_id: "tenant-1",
        agreement_id: null,
        offer_id: null,
        event_type: "RENEWAL_ACTIVATED",
        actor_type: "SYSTEM",
        actor_id: null,
        reason: null,
        metadata: null,
      },
    });
  });

  it("propagates write failures instead of swallowing them (must roll back with the caller's transaction)", async () => {
    const create = vi.fn().mockRejectedValue(new Error("db down"));
    const tx = { renewalTimelineEvent: { create } };

    await expect(
      renewalTimelineService.registerEvent(tx, {
        hostelId: "hostel-1",
        tenantId: "tenant-1",
        eventType: "OFFER_CREATED",
        actorType: "OWNER",
      })
    ).rejects.toThrow("db down");
  });
});

describe("RenewalTimelineService.getTimeline", () => {
  it("queries by tenantId, agreementId, or offerId, ordered oldest-first", async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: "event-1" }]);
    const db = { renewalTimelineEvent: { findMany } };

    const result = await renewalTimelineService.getTimeline(db, { agreementId: "agreement-1" });

    expect(findMany).toHaveBeenCalledWith({
      where: { agreement_id: "agreement-1" },
      orderBy: { created_at: "asc" },
      take: 200,
    });
    expect(result).toEqual([{ id: "event-1" }]);
  });

  it("combines multiple provided filters", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { renewalTimelineEvent: { findMany } };

    await renewalTimelineService.getTimeline(db, { tenantId: "tenant-1", offerId: "offer-1", limit: 50 });

    expect(findMany).toHaveBeenCalledWith({
      where: { tenant_id: "tenant-1", offer_id: "offer-1" },
      orderBy: { created_at: "asc" },
      take: 50,
    });
  });
});
