import { describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { expenseService } from "@/lib/services/expense-service";
import { deriveOperationalType, CATEGORY_TO_OPERATIONAL_TYPE } from "@/lib/services/expense-service";
import { createTestOwner } from "./factories/owner-factory";

describe("Expense operational_type — derived from category, never owner-supplied", () => {
  it("deriveOperationalType matches the canonical mapping for the documented examples", () => {
    expect(deriveOperationalType("Electricity")).toBe("Utility");
    expect(deriveOperationalType("Staff Salary")).toBe("Staff");
    expect(deriveOperationalType("Gas Cylinders")).toBe("Utility");
    expect(deriveOperationalType("Food & Groceries")).toBe("Operational");
    expect(deriveOperationalType("Maintenance & Repairs")).toBe("Maintenance");
  });

  it("deriveOperationalType normalizes aliases before lookup and falls back for unknown categories", () => {
    // "staff" is a known alias -> normalizes to "Staff Salary" -> "Staff"
    expect(deriveOperationalType("staff")).toBe("Staff");
    // Completely unrecognized/custom category text falls back to "Operational"
    expect(deriveOperationalType("Some Totally Custom Category")).toBe("Operational");
  });

  it("every canonical category has a mapped operational_type (no silent gaps)", () => {
    const categories = [
      "Food & Groceries", "Staff Salary", "Electricity", "Water", "Gas Cylinders", "Internet",
      "Cleaning Supplies", "Maintenance & Repairs", "Security", "Laundry", "Transportation",
      "Furniture & Equipment", "Licenses & Government", "Marketing", "Medical & Emergency", "Miscellaneous",
    ];
    for (const category of categories) {
      expect(CATEGORY_TO_OPERATIONAL_TYPE[category]).toBeTruthy();
    }
  });

  it("createExpense always derives operational_type from category, ignoring any client-supplied value", async () => {
    const owner = await createTestOwner();

    const electricity = await expenseService.createExpense({
      owner_id: owner.id, title: "EB Bill", amount: 5000, date: new Date(), category: "Electricity",
    });
    expect(electricity.operational_type).toBe("Utility");

    const staff = await expenseService.createExpense({
      owner_id: owner.id, title: "Cook salary", amount: 15000, date: new Date(), category: "Staff Salary",
    });
    expect(staff.operational_type).toBe("Staff");

    // Even if a caller sneaks a bogus operational_type through the body (the field no
    // longer exists on the typed signature, but nothing in the codebase reads it anyway
    // — createExpense derives from category unconditionally).
    const spoofed = await expenseService.createExpense({
      owner_id: owner.id, title: "Rice purchase", amount: 3000, date: new Date(), category: "Food & Groceries",
      operational_type: "Emergency",
    } as any);
    expect(spoofed.operational_type).toBe("Operational");
  });

  it("updateExpense recomputes operational_type when category changes, ignoring any client-supplied value", async () => {
    const owner = await createTestOwner();
    const expense = await expenseService.createExpense({
      owner_id: owner.id, title: "Vegetables", amount: 600, date: new Date(), category: "Food & Groceries",
    });
    expect(expense.operational_type).toBe("Operational");

    const recategorized = await expenseService.updateExpense(expense.id, owner.id, {
      category: "Maintenance & Repairs",
      operational_type: "Staff", // should be ignored — recomputed from the new category instead
    });
    expect(recategorized.category).toBe("Maintenance & Repairs");
    expect(recategorized.operational_type).toBe("Maintenance");
  });

  it("updateExpense leaves operational_type untouched when category is not part of the update", async () => {
    const owner = await createTestOwner();
    const expense = await expenseService.createExpense({
      owner_id: owner.id, title: "Gas 3 cylinders", amount: 10000, date: new Date(), category: "Gas Cylinders",
    });
    expect(expense.operational_type).toBe("Utility");

    const updated = await expenseService.updateExpense(expense.id, owner.id, { amount: 10500 });
    expect(updated.operational_type).toBe("Utility");
  });

  it("existing records with a stale/legacy operational_type work without migration until next category edit", async () => {
    const owner = await createTestOwner();
    const expense = await expenseService.createExpense({
      owner_id: owner.id, title: "Old record", amount: 1000, date: new Date(), category: "Internet",
    });
    expect(expense.operational_type).toBe("Utility");

    // Simulate a legacy row whose operational_type predates this mapping (e.g. seeded by
    // an older code path or hand-edited) — no migration should be required for it to
    // keep working normally.
    await prisma.expenses.update({ where: { id: expense.id }, data: { operational_type: "LegacyValue" } });
    const legacyRow = await prisma.expenses.findUnique({ where: { id: expense.id } });
    expect(legacyRow?.operational_type).toBe("LegacyValue");

    // Editing anything other than category leaves the legacy value alone...
    const untouched = await expenseService.updateExpense(expense.id, owner.id, { notes: "reviewed" });
    expect(untouched.operational_type).toBe("LegacyValue");

    // ...but editing the category recomputes it going forward.
    const fixed = await expenseService.updateExpense(expense.id, owner.id, { category: "Electricity" });
    expect(fixed.operational_type).toBe("Utility");
  });
});
