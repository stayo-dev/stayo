import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { expenseService } from "@/lib/services/expense-service";
import { dashboardService } from "@/lib/services/dashboard-service";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";

describe("Expense Scope Validation Integration", () => {
  it("enforces scope rules on creation and update", async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    // 1. Creating a BUSINESS expense (without hostel_id) succeeds
    const bExp = await expenseService.createExpense({
      owner_id: owner.id,
      title: "Software Subscription",
      amount: 1500,
      date: new Date(),
      category: "Software",
      payment_method: "upi",
      expense_scope: "BUSINESS",
    });
    expect(bExp.expense_scope).toBe("BUSINESS");
    expect(bExp.hostel_id).toBeNull();

    // 2. Creating a HOSTEL expense (with hostel_id) succeeds
    const hExp = await expenseService.createExpense({
      owner_id: owner.id,
      title: "Electricity Bill",
      amount: 5000,
      date: new Date(),
      category: "Electricity",
      payment_method: "bank_transfer",
      expense_scope: "HOSTEL",
      hostel_id: hostel.id,
    });
    expect(hExp.expense_scope).toBe("HOSTEL");
    expect(hExp.hostel_id).toBe(hostel.id);

    // 3. Creating a BUSINESS expense WITH a hostel_id fails
    await expect(
      expenseService.createExpense({
        owner_id: owner.id,
        title: "Invalid Business Expense",
        amount: 100,
        date: new Date(),
        category: "Miscellaneous",
        payment_method: "cash",
        expense_scope: "BUSINESS",
        hostel_id: hostel.id,
      })
    ).rejects.toThrow("Business expenses must not have a hostel ID");

    // 4. Creating a HOSTEL expense WITHOUT a hostel_id fails
    await expect(
      expenseService.createExpense({
        owner_id: owner.id,
        title: "Invalid Hostel Expense",
        amount: 200,
        date: new Date(),
        category: "Miscellaneous",
        payment_method: "cash",
        expense_scope: "HOSTEL",
      })
    ).rejects.toThrow("Hostel expenses must have a valid hostel ID");

    // 5. Updating a BUSINESS expense to add a hostel_id fails
    await expect(
      expenseService.updateExpense(bExp.id, owner.id, { hostel_id: hostel.id })
    ).rejects.toThrow("Business expenses must not have a hostel ID");

    // 6. Updating a HOSTEL expense to remove hostel_id fails
    await expect(
      expenseService.updateExpense(hExp.id, owner.id, { hostel_id: null })
    ).rejects.toThrow("Hostel expenses must have a valid hostel ID");

    // 7. Updating a BUSINESS expense to scope HOSTEL without hostel_id fails
    await expect(
      expenseService.updateExpense(bExp.id, owner.id, { expense_scope: "HOSTEL" })
    ).rejects.toThrow("Hostel expenses must have a valid hostel ID");

    // 8. Updating a HOSTEL expense to scope BUSINESS with hostel_id fails
    await expect(
      expenseService.updateExpense(hExp.id, owner.id, { expense_scope: "BUSINESS" })
    ).rejects.toThrow("Business expenses must not have a hostel ID");

    // 9. Correctly transition when both are updated compatibly
    const updatedB = await expenseService.updateExpense(bExp.id, owner.id, {
      expense_scope: "HOSTEL",
      hostel_id: hostel.id,
    });
    expect(updatedB.expense_scope).toBe("HOSTEL");
    expect(updatedB.hostel_id).toBe(hostel.id);
  });

  it("verifies dashboard analytics queries filter by expense_scope correctly", async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);

    // Business expense (global)
    await expenseService.createExpense({
      owner_id: owner.id,
      title: "Global Accountant Fee",
      amount: 12000,
      date: new Date(),
      category: "Professional Fees",
      payment_method: "bank_transfer",
      expense_scope: "BUSINESS",
    });

    // Hostel expense (specific to our hostel)
    await expenseService.createExpense({
      owner_id: owner.id,
      title: "Hostel Gas Cylinder",
      amount: 1100,
      date: new Date(),
      category: "Gas",
      payment_method: "cash",
      expense_scope: "HOSTEL",
      hostel_id: hostel.id,
    });

    // Get hostel dashboard stats
    const stats = await dashboardService.getOwnerStats(owner.id, hostel.id);
    
    // The hostel-scoped expenses should only include the hostel-specific one (1100), not the business one (12000)
    expect(stats.expenses_this_month).toBe(1100);
  });
});
