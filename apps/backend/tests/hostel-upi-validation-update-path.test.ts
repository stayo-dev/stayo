import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * The UPI ID must be validated on the path the settings screen actually uses.
 *
 * `hostel-upi-validation.test.ts` covers `hostelPolicyService`, reached by
 * `PATCH /hostels/:id/preferences`. But `MoreHostelIdentityPage` — the screen
 * with the UPI ID box — saves through `PATCH /hostels/:id`, which calls
 * `propertyService.updateHostel` and spread the value straight to Prisma.
 *
 * So the first round of validation guarded a path owners never take, which is
 * the same shape as "a filter that never filtered": a check that exists, reads
 * as protection, and lets every real value through. Both paths are now covered.
 *
 * Pure: `@/lib/db` is mocked. No database.
 */

const profileFindUnique = vi.fn();
const hostelUpdateMany = vi.fn();
const hostelFindFirst = vi.fn();
const hostelUpdate = vi.fn();

vi.mock("@/lib/db", () => ({
  prisma: {
    profile: { findUnique: (...a: any[]) => profileFindUnique(...a) },
    hostels: {
      updateMany: (...a: any[]) => hostelUpdateMany(...a),
      findFirst: (...a: any[]) => hostelFindFirst(...a),
      update: (...a: any[]) => hostelUpdate(...a),
      findUnique: vi.fn().mockResolvedValue({ id: "hostel-1", name: "Sri Adithya Boys Hostel" }),
      findMany: vi.fn().mockResolvedValue([{ id: "hostel-1" }]),
    },
    roomAllocation: { count: vi.fn().mockResolvedValue(0) },
    $transaction: async (fn: any) => (typeof fn === "function" ? fn({}) : Promise.all(fn)),
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
  getLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}));

import { propertyService } from "@/lib/services/property-service";

beforeEach(() => {
  profileFindUnique.mockReset().mockResolvedValue({ id: "owner-1" });
  hostelUpdateMany.mockReset().mockResolvedValue({ count: 1 });
  hostelFindFirst.mockReset().mockResolvedValue({ id: "hostel-1" });
  hostelUpdate.mockReset().mockResolvedValue({ id: "hostel-1" });
});

describe("updateHostel — UPI ID", () => {
  it("rejects an email address on the path the settings screen uses", async () => {
    // The exact value owners paste. Shape-identical to a VPA apart from the
    // dotted handle.
    await expect(
      propertyService.updateHostel("owner-1", { upi_id: "owner@gmail.com" }),
    ).rejects.toThrow(/UPI/i);
  });

  it("rejects a value with no handle at all", async () => {
    await expect(
      propertyService.updateHostel("owner-1", { upi_id: "adithya" }),
    ).rejects.toThrow(/UPI/i);
  });

  /**
   * `updateHostel` is deeply DB-coupled past the validation step, and mocking
   * the whole of it would test the mock. These assert the narrower, true thing:
   * a valid value is not rejected *for being a UPI ID*. Whatever the unmocked
   * depths do afterwards is not this test's subject.
   */
  const rejectedForUpi = async (data: Record<string, unknown>) => {
    try {
      await propertyService.updateHostel("owner-1", data);
      return false;
    } catch (err: any) {
      return /UPI/i.test(String(err?.message));
    }
  };

  it("accepts a real VPA", async () => {
    expect(await rejectedForUpi({ upi_id: "adithya@okhdfcbank" })).toBe(false);
  });

  it("accepts clearing the UPI ID", async () => {
    // An owner removing it must not be blocked by a validator that treats
    // empty as invalid — most hostels have none set.
    expect(await rejectedForUpi({ upi_id: null })).toBe(false);
    expect(await rejectedForUpi({ upi_id: "" })).toBe(false);
  });

  it("trims a pasted value rather than refusing it outright", async () => {
    // Pasting from WhatsApp carries whitespace. Rejecting that is technically
    // correct and practically hostile, so it is trimmed and then checked.
    expect(await rejectedForUpi({ upi_id: "  adithya@okhdfcbank  " })).toBe(false);
  });

  it("does not object when no UPI ID is sent at all", async () => {
    expect(await rejectedForUpi({ name: "Sri Adithya Boys Hostel" })).toBe(false);
  });
});
