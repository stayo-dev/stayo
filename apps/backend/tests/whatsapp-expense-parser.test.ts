import { describe, expect, it } from "vitest";
import {
  parseExplicitSearchQuery,
  parseOwnerExpenseWriteCommand,
} from "@/lib/services/notifications/owner-whatsapp-assistant";

describe("WhatsApp owner expense parser", () => {
  it("parses template shortcut commands", () => {
    const parsed = parseOwnerExpenseWriteCommand("internet 1000");
    expect(parsed).toMatchObject({
      action: "CREATE_EXPENSE",
      title: "Internet",
      amount: 1000,
      category: "Internet",
      payment_method: "cash",
      template_key: "internet",
    });
  });

  it("parses explicit expense commands", () => {
    const parsed = parseOwnerExpenseWriteCommand("expense internet 1000");
    expect(parsed).toMatchObject({
      title: "Internet",
      amount: 1000,
      category: "Internet",
      payment_method: "cash",
    });
  });

  it("parses vendor and payment method after amount", () => {
    const parsed = parseOwnerExpenseWriteCommand("expense internet 1000 jio upi");
    expect(parsed).toMatchObject({
      title: "Internet",
      amount: 1000,
      category: "Internet",
      vendor_name: "Jio",
      payment_method: "upi",
    });
  });

  it("parses vendor before amount for salary", () => {
    const parsed = parseOwnerExpenseWriteCommand("salary ravi 15000");
    expect(parsed).toMatchObject({
      title: "Ravi Salary",
      amount: 15000,
      category: "Staff Salary",
      vendor_name: "Ravi",
      payment_method: "cash",
    });
  });

  it("treats expenses with an amount as expense capture, not reporting", () => {
    expect(parseOwnerExpenseWriteCommand("expenses 50")).toMatchObject({
      title: "Expense",
      amount: 50,
      category: "Miscellaneous",
    });
    expect(parseOwnerExpenseWriteCommand("expenses milk 50")).toMatchObject({
      title: "Milk",
      amount: 50,
      category: "Food & Groceries",
      template_key: "milk",
    });
    expect(parseOwnerExpenseWriteCommand("expenses 50 milk")).toMatchObject({
      title: "Milk",
      amount: 50,
      category: "Food & Groceries",
      template_key: "milk",
    });
  });

  it("parses natural paid and spent phrases", () => {
    expect(parseOwnerExpenseWriteCommand("paid milk 50")).toMatchObject({
      title: "Milk",
      amount: 50,
      category: "Food & Groceries",
    });
    expect(parseOwnerExpenseWriteCommand("spent 50 milk")).toMatchObject({
      title: "Milk",
      amount: 50,
      category: "Food & Groceries",
    });
  });

  it("infers title and category from owner wording", () => {
    expect(parseOwnerExpenseWriteCommand("jio 999")).toMatchObject({
      title: "Jio",
      amount: 999,
      category: "Internet",
      template_key: "jio",
    });
    expect(parseOwnerExpenseWriteCommand("ravi salary 15000")).toMatchObject({
      title: "Ravi Salary",
      amount: 15000,
      category: "Staff Salary",
      vendor_name: "Ravi",
      template_key: "salary",
    });
    expect(parseOwnerExpenseWriteCommand("internet bill 1000")).toMatchObject({
      title: "Internet Bill",
      amount: 1000,
      category: "Internet",
      template_key: "internet",
    });
  });

  it("keeps exact expense report commands out of capture parsing", () => {
    expect(parseOwnerExpenseWriteCommand("expenses")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("expenses today")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("expenses week")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("expenses month")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("expenses category internet")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("last 5 expenses")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("top categories")).toBeNull();
  });

  it("rejects missing or invalid amounts", () => {
    expect(parseOwnerExpenseWriteCommand("internet")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("internet zero")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("internet -100")).toBeNull();
    expect(parseOwnerExpenseWriteCommand("8008046952")).toBeNull();
  });

  it("parses explicit search command queries", () => {
    expect(parseExplicitSearchQuery("SEARCH Shiva")).toBe("Shiva");
    expect(parseExplicitSearchQuery("search G1")).toBe("G1");
    expect(parseExplicitSearchQuery("Search 8008046952")).toBe("8008046952");
    expect(parseExplicitSearchQuery("SEARCH")).toBeNull();
  });
});
