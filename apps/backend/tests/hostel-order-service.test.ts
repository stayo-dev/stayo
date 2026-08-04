import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { hostelOrderService, HostelOrderError } from "@/lib/services/hostel-order-service";
import { portfolioService } from "@/lib/services/portfolio-service";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";

async function orderOf(ownerId: string): Promise<{ id: string; display_order: number | null; name: string }[]> {
  const rows = await prisma.hostels.findMany({
    where: { owner_id: ownerId },
    select: { id: true, display_order: true, name: true },
    orderBy: [{ display_order: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });
  return rows;
}

describe("Hostel display order (ADR-042)", () => {
  it("persists the given order as 0..n-1", async () => {
    const owner = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "AAA" });
    const b = await createTestHostel(owner.id, { name: "BBB" });
    const c = await createTestHostel(owner.id, { name: "CCC" });

    const result = await hostelOrderService.reorder(owner.id, [c.id, a.id, b.id]);

    expect(result.order).toEqual([
      { id: c.id, display_order: 0 },
      { id: a.id, display_order: 1 },
      { id: b.id, display_order: 2 },
    ]);

    const rows = await orderOf(owner.id);
    expect(rows.map((r) => r.id)).toEqual([c.id, a.id, b.id]);
  });

  it("leaves display_order NULL until the owner actually reorders", async () => {
    const owner = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "Zulu" });
    const b = await createTestHostel(owner.id, { name: "Alpha" });

    const rows = await orderOf(owner.id);
    expect(rows.every((r) => r.display_order === null)).toBe(true);
    // NULLs sort last, then by name — i.e. exactly the pre-existing behaviour.
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it("rejects a hostel the owner does not own, and writes nothing", async () => {
    const owner = await createTestOwner();
    const stranger = await createTestOwner();
    const mine = await createTestHostel(owner.id, { name: "Mine" });
    const theirs = await createTestHostel(stranger.id, { name: "Theirs" });

    await expect(hostelOrderService.reorder(owner.id, [theirs.id, mine.id])).rejects.toMatchObject({
      code: "FORBIDDEN",
    });

    const rows = await orderOf(owner.id);
    expect(rows.every((r) => r.display_order === null)).toBe(true);

    const theirRow = await prisma.hostels.findUnique({ where: { id: theirs.id }, select: { display_order: true } });
    expect(theirRow?.display_order).toBeNull();
  });

  it("rejects a partial list rather than best-effort applying it", async () => {
    const owner = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "A" });
    await createTestHostel(owner.id, { name: "B" });

    await expect(hostelOrderService.reorder(owner.id, [a.id])).rejects.toMatchObject({
      code: "STALE_ORDER",
    });

    const rows = await orderOf(owner.id);
    expect(rows.every((r) => r.display_order === null)).toBe(true);
  });

  it("rejects duplicate ids", async () => {
    const owner = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "A" });
    await createTestHostel(owner.id, { name: "B" });

    await expect(hostelOrderService.reorder(owner.id, [a.id, a.id])).rejects.toBeInstanceOf(HostelOrderError);
  });

  it("rejects an empty order", async () => {
    const owner = await createTestOwner();
    await createTestHostel(owner.id, { name: "A" });

    await expect(hostelOrderService.reorder(owner.id, [])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
    });
  });

  it("is idempotent — reapplying the same order changes nothing", async () => {
    const owner = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "A" });
    const b = await createTestHostel(owner.id, { name: "B" });

    await hostelOrderService.reorder(owner.id, [b.id, a.id]);
    await hostelOrderService.reorder(owner.id, [b.id, a.id]);

    const rows = await orderOf(owner.id);
    expect(rows.map((r) => r.id)).toEqual([b.id, a.id]);
    expect(rows.map((r) => r.display_order)).toEqual([0, 1]);
  });

  it("one owner's ordering does not disturb another owner's", async () => {
    const owner = await createTestOwner();
    const other = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "A" });
    const b = await createTestHostel(owner.id, { name: "B" });
    const x = await createTestHostel(other.id, { name: "X" });
    const y = await createTestHostel(other.id, { name: "Y" });

    await hostelOrderService.reorder(owner.id, [b.id, a.id]);

    const otherRows = await orderOf(other.id);
    expect(otherRows.every((r) => r.display_order === null)).toBe(true);
    expect(otherRows.map((r) => r.id)).toEqual([x.id, y.id]);
  });

  it("portfolio summary returns hostels in the owner's chosen order", async () => {
    const owner = await createTestOwner();
    const a = await createTestHostel(owner.id, { name: "AAA" });
    const b = await createTestHostel(owner.id, { name: "BBB" });

    const before = await portfolioService.getPortfolioSummary(owner.id);
    expect(before.hostels.map((h) => h.hostel_id)).toEqual([a.id, b.id]);
    expect(before.hostels.every((h) => h.display_order === null)).toBe(true);

    await hostelOrderService.reorder(owner.id, [b.id, a.id]);

    const after = await portfolioService.getPortfolioSummary(owner.id);
    expect(after.hostels.map((h) => h.hostel_id)).toEqual([b.id, a.id]);
    expect(after.hostels.map((h) => h.display_order)).toEqual([0, 1]);
  });
});
