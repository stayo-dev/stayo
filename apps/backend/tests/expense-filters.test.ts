import { describe, expect, it } from "vitest";
import { expenseService } from "@/lib/services/expense-service";
import { createTestOwner } from "./factories/owner-factory";

describe("Expense recurring + amount-range filters", () => {
  it("filters by recurring flag without affecting other results", async () => {
    const owner = await createTestOwner();

    const recurring = await expenseService.createExpense({
      owner_id: owner.id,
      title: "Monthly Internet Bill",
      amount: 1200,
      date: new Date(),
      category: "Internet",
      is_recurring: true,
      recurring_frequency: "monthly",
    });

    const oneOff = await expenseService.createExpense({
      owner_id: owner.id,
      title: "One-time Repair",
      amount: 800,
      date: new Date(),
      category: "Maintenance & Repairs",
      is_recurring: false,
    });

    const recurringOnly = await expenseService.getAllExpenses(owner.id, { recurring: true });
    expect(recurringOnly.expenses.map((e: any) => e.id)).toEqual([recurring.id]);

    const nonRecurringOnly = await expenseService.getAllExpenses(owner.id, { recurring: false });
    expect(nonRecurringOnly.expenses.map((e: any) => e.id)).toEqual([oneOff.id]);

    const allExpenses = await expenseService.getAllExpenses(owner.id, {});
    const ids = allExpenses.expenses.map((e: any) => e.id);
    expect(ids).toEqual(expect.arrayContaining([recurring.id, oneOff.id]));
  });

  it("filters by amount range and composes with category + status filters", async () => {
    const owner = await createTestOwner();

    const cheap = await expenseService.createExpense({
      owner_id: owner.id,
      title: "Milk",
      amount: 100,
      date: new Date(),
      category: "Food & Groceries",
      status: "paid",
    });
    const mid = await expenseService.createExpense({
      owner_id: owner.id,
      title: "Rice bags",
      amount: 5000,
      date: new Date(),
      category: "Food & Groceries",
      status: "paid",
    });
    const expensive = await expenseService.createExpense({
      owner_id: owner.id,
      title: "Kitchen renovation",
      amount: 50000,
      date: new Date(),
      category: "Maintenance & Repairs",
      status: "pending",
    });

    const midRange = await expenseService.getAllExpenses(owner.id, { amountMin: 1000, amountMax: 10000 });
    expect(midRange.expenses.map((e: any) => e.id)).toEqual([mid.id]);

    const composed = await expenseService.getAllExpenses(owner.id, {
      amountMin: 1000,
      categories: ["Food & Groceries"],
      status: "paid",
    });
    expect(composed.expenses.map((e: any) => e.id)).toEqual([mid.id]);

    // amountMin > amountMax must yield an empty result, not throw
    const inverted = await expenseService.getAllExpenses(owner.id, { amountMin: 100000, amountMax: 1 });
    expect(inverted.expenses).toEqual([]);
    expect(inverted.total).toBe(0);

    // amountMin === amountMax matches exactly that amount (boundary inclusive)
    const exact = await expenseService.getAllExpenses(owner.id, { amountMin: 50000, amountMax: 50000 });
    expect(exact.expenses.map((e: any) => e.id)).toEqual([expensive.id]);

    void cheap;
  });

  it("leaves existing behavior unchanged when the new params are omitted", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id,
      title: "Wifi Bill",
      amount: 999,
      date: new Date(),
      category: "Internet",
    });

    const result = await expenseService.getAllExpenses(owner.id, { status: "paid" });
    expect(result.expenses.length).toBe(1);
    expect(result.total).toBe(1);
  });

  it("respects pagination when combined with the new filters (no post-fetch client-side filtering)", async () => {
    const owner = await createTestOwner();
    for (let i = 0; i < 5; i++) {
      await expenseService.createExpense({
        owner_id: owner.id,
        title: `Recurring item ${i}`,
        amount: 1000 + i,
        date: new Date(),
        category: "Miscellaneous",
        is_recurring: true,
      });
    }

    const page1 = await expenseService.getAllExpenses(owner.id, { recurring: true, limit: 2, offset: 0 });
    const page2 = await expenseService.getAllExpenses(owner.id, { recurring: true, limit: 2, offset: 2 });
    expect(page1.total).toBe(5);
    expect(page2.total).toBe(5);
    expect(page1.expenses.length).toBe(2);
    expect(page2.expenses.length).toBe(2);
    const page1Ids = page1.expenses.map((e: any) => e.id);
    const page2Ids = page2.expenses.map((e: any) => e.id);
    expect(page1Ids.some((id: string) => page2Ids.includes(id))).toBe(false);
  });

  it("computes an exact vendor_breakdown independent of page size", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id,
      title: "Rice",
      amount: 3000,
      date: new Date(),
      category: "Food & Groceries",
      vendor_name: "Sri Ganesh Traders",
    });
    await expenseService.createExpense({
      owner_id: owner.id,
      title: "Dal",
      amount: 1500,
      date: new Date(),
      category: "Food & Groceries",
      vendor_name: "Sri Ganesh Traders",
    });
    await expenseService.createExpense({
      owner_id: owner.id,
      title: "Milk",
      amount: 400,
      date: new Date(),
      category: "Food & Groceries",
      vendor_name: "Local Dairy",
    });

    const result = await expenseService.getAllExpenses(owner.id, { limit: 1 });
    const topVendor = result.vendor_breakdown[0];
    expect(topVendor.vendor).toBe("Sri Ganesh Traders");
    expect(topVendor.amount).toBe(4500);
    expect(topVendor.count).toBe(2);
  });
});
