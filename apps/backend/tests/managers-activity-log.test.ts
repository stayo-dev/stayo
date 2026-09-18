import { describe, expect, it, vi, beforeEach } from "vitest";

const { logMock } = vi.hoisted(() => ({ logMock: vi.fn() }));
vi.mock("@/lib/services/activity.service", () => ({
  activityService: { log: logMock },
}));

import { recordManagerActivity } from "@/src/services/managers/manager-activity";

const HOSTEL_A = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("recordManagerActivity", () => {
  it("writes through the existing generic activity_logs writer — no second audit table", async () => {
    await recordManagerActivity({
      actorProfileId: "manager-profile-1",
      actorRole: "MANAGER",
      actorName: "Rahul Kumar",
      hostelId: HOSTEL_A,
      actionType: "HOSTEL_UPDATED",
      entityType: "HOSTEL",
      entityId: HOSTEL_A,
      before: { monthly_rent: 6500 },
      after: { monthly_rent: 7000 },
    });

    expect(logMock).toHaveBeenCalledTimes(1);
    const call = logMock.mock.calls[0][0];
    expect(call.userId).toBe("manager-profile-1");
    expect(call.actionType).toBe("HOSTEL_UPDATED");
    expect(call.entityType).toBe("HOSTEL");
    // Established convention (migrations/082_activity_logs_hostel_index.sql):
    // the hostel MUST live at metadata.hostel_id for the feed's index to apply.
    expect(call.metadata.hostel_id).toBe(HOSTEL_A);
  });

  it("diffs before/after into changed_fields, one entry per changed leaf", async () => {
    await recordManagerActivity({
      actorProfileId: "manager-profile-1",
      actorRole: "MANAGER",
      hostelId: HOSTEL_A,
      actionType: "HOSTEL_UPDATED",
      entityType: "HOSTEL",
      before: { monthly_rent: 6500, city: "Hyderabad" },
      after: { monthly_rent: 7000, city: "Hyderabad" },
    });

    const changed = logMock.mock.calls[0][0].metadata.changed_fields;
    expect(changed).toEqual([{ field: "monthly_rent", from: 6500, to: 7000 }]);
  });

  it("omits changed_fields entirely when no before/after is given (e.g. an assignment event)", async () => {
    await recordManagerActivity({
      actorProfileId: "admin-1",
      actorRole: "ADMIN",
      hostelId: HOSTEL_A,
      actionType: "HOSTEL_ASSIGNED",
      entityType: "MANAGER_HOSTEL_ASSIGNMENT",
    });

    expect(logMock.mock.calls[0][0].metadata.changed_fields).toBeUndefined();
  });
});
