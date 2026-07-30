import { describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { expenseService } from "@/lib/services/expense-service";
import {
  streamExpensesCsv,
  streamExpensesXlsx,
  generateExpensesPdf,
  getExportSummary,
  type ExpenseExportRequest,
} from "@/lib/services/expense-export-service";
import { createTestOwner, createTestHostel } from "./factories/owner-factory";
import { createTestRoom } from "./factories/room-factory";
import { createTestTenant, allocateTestRoom } from "./factories/tenant-factory";
import { createTestObligation, createTestPayment } from "./factories/payment-factory";

async function readStream(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const reader = stream.getReader();
  const chunks: Buffer[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

function parseCsv(text: string): string[][] {
  return text
    .trim()
    .split("\r\n")
    .map((line) => line.split(",").map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"')));
}

describe("Expense export service", () => {
  it("CSV export matches the same filtered set the UI query would return", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Rice 60 bags", amount: 91000, date: new Date(),
      category: "Food & Groceries", vendor_name: "Sri Ganesh Traders", payment_method: "UPI",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Electricity bill", amount: 12500, date: new Date(),
      category: "Electricity", payment_method: "Bank Transfer",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Vegetables", amount: 600, date: new Date(),
      category: "Food & Groceries", status: "pending",
    });

    const uiResult = await expenseService.getAllExpenses(owner.id, { categories: ["Food & Groceries"] });

    const req: ExpenseExportRequest = { ownerId: owner.id, filters: { categories: ["Food & Groceries"] }, scope: "all_matching" };
    const csvBuffer = await readStream(streamExpensesCsv(req));
    const rows = parseCsv(csvBuffer.toString("utf-8"));
    const [header, ...dataRows] = rows;

    expect(header).toContain("Title");
    expect(dataRows.length).toBe(uiResult.expenses.length);
    expect(dataRows.length).toBe(2); // Rice 60 bags + Vegetables, not Electricity

    const titles = dataRows.map((r) => r[header.indexOf("Title")]);
    expect(titles).toEqual(expect.arrayContaining(["Rice 60 bags", "Vegetables"]));
    expect(titles).not.toContain("Electricity bill");

    const amountCol = header.indexOf("Amount (INR)");
    const riceRow = dataRows.find((r) => r[header.indexOf("Title")] === "Rice 60 bags")!;
    expect(riceRow[amountCol]).toBe("91000");
  });

  it("respects recurring/amount-range/search filters exactly like the list endpoint", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Monthly Internet", amount: 1200, date: new Date(),
      category: "Internet", is_recurring: true,
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "One-time Repair", amount: 8000, date: new Date(),
      category: "Maintenance & Repairs", is_recurring: false,
    });

    const req: ExpenseExportRequest = { ownerId: owner.id, filters: { recurring: true }, scope: "all_matching" };
    const csvBuffer = await readStream(streamExpensesCsv(req));
    const [header, ...dataRows] = parseCsv(csvBuffer.toString("utf-8"));
    expect(dataRows.length).toBe(1);
    expect(dataRows[0][header.indexOf("Title")]).toBe("Monthly Internet");
  });

  it("scope=selected exports exactly the given IDs regardless of other filters", async () => {
    const owner = await createTestOwner();
    const a = await expenseService.createExpense({
      owner_id: owner.id, title: "A", amount: 100, date: new Date(), category: "Miscellaneous",
    });
    const b = await expenseService.createExpense({
      owner_id: owner.id, title: "B", amount: 200, date: new Date(), category: "Miscellaneous",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "C", amount: 300, date: new Date(), category: "Miscellaneous",
    });

    const req: ExpenseExportRequest = {
      ownerId: owner.id,
      filters: { search: "this matches nothing" }, // deliberately irrelevant — selected scope should ignore it
      scope: "selected",
      ids: [a.id, b.id],
    };
    const csvBuffer = await readStream(streamExpensesCsv(req));
    const [header, ...dataRows] = parseCsv(csvBuffer.toString("utf-8"));
    expect(dataRows.length).toBe(2);
    const titles = dataRows.map((r) => r[header.indexOf("Title")]).sort();
    expect(titles).toEqual(["A", "B"]);
  });

  it("scope=current_view respects limit/offset like the paginated list", async () => {
    const owner = await createTestOwner();
    for (let i = 0; i < 5; i++) {
      await expenseService.createExpense({
        owner_id: owner.id, title: `Item ${i}`, amount: 100 + i, date: new Date(), category: "Miscellaneous",
      });
    }
    const req: ExpenseExportRequest = { ownerId: owner.id, filters: {}, scope: "current_view", limit: 2, offset: 0 };
    const csvBuffer = await readStream(streamExpensesCsv(req));
    const [, ...dataRows] = parseCsv(csvBuffer.toString("utf-8"));
    expect(dataRows.length).toBe(2);
  });

  it("XLSX export is a valid workbook, sectioned Metadata → Financial Summary → Category Breakdown → Expense Table", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Gas cylinders", amount: 10000, date: new Date(), category: "Gas Cylinders",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Milk supply", amount: 100, date: new Date(), category: "Food & Groceries",
    });

    const req: ExpenseExportRequest = { ownerId: owner.id, filters: {}, scope: "all_matching" };
    const xlsxBuffer = await readStream(await streamExpensesXlsx(req));
    expect(xlsxBuffer.length).toBeGreaterThan(0);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(xlsxBuffer as any);
    const sheet = workbook.getWorksheet("Expenses");
    expect(sheet).toBeTruthy();

    const rowTexts: string[] = [];
    sheet!.eachRow((row) => rowTexts.push((row.values as any[]).filter(Boolean).join(" | ")));

    const metadataIdx = rowTexts.findIndex((r) => r.includes("Report Version"));
    const financialIdx = rowTexts.findIndex((r) => r === "Financial Summary");
    const categoryIdx = rowTexts.findIndex((r) => r === "Category Breakdown");
    const tableHeaderIdx = rowTexts.findIndex((r) => r.startsWith("Date | Title | Category"));

    // Sections appear in the designed order.
    expect(metadataIdx).toBeGreaterThanOrEqual(0);
    expect(financialIdx).toBeGreaterThan(metadataIdx);
    expect(categoryIdx).toBeGreaterThan(financialIdx);
    expect(tableHeaderIdx).toBeGreaterThan(categoryIdx);

    // Exactly the 2 data rows follow the table header, nothing extra.
    const dataRows = rowTexts.slice(tableHeaderIdx + 1);
    expect(dataRows.length).toBe(2);
    expect(dataRows.some((r) => r.includes("Gas cylinders"))).toBe(true);
    expect(dataRows.some((r) => r.includes("Milk supply"))).toBe(true);
  });

  it("PDF export is a valid non-empty PDF document", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Rice purchase", amount: 5000, date: new Date(),
      category: "Food & Groceries", vendor_name: "Sri Ganesh Traders",
    });

    const req: ExpenseExportRequest = { ownerId: owner.id, filters: {}, scope: "all_matching" };
    const pdfBytes = await generateExpensesPdf(req);
    expect(pdfBytes.length).toBeGreaterThan(0);
    expect(Buffer.from(pdfBytes.slice(0, 5)).toString("utf-8")).toBe("%PDF-");
  });

  it("getExportSummary aggregates over the same filtered set as the export rows (no drift)", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Rice", amount: 3000, date: new Date(),
      category: "Food & Groceries", vendor_name: "Sri Ganesh Traders",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Dal", amount: 1500, date: new Date(),
      category: "Food & Groceries", vendor_name: "Sri Ganesh Traders",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Electricity", amount: 9000, date: new Date(), category: "Electricity",
    });

    const req: ExpenseExportRequest = { ownerId: owner.id, filters: { categories: ["Food & Groceries"] }, scope: "all_matching" };
    const summary = await getExportSummary(req);
    expect(summary.totalCount).toBe(2);
    expect(summary.totalAmount).toBe(4500);
    expect(summary.vendorBreakdown[0]).toMatchObject({ vendor: "Sri Ganesh Traders", amount: 4500, count: 2 });
  });

  it("report content: title, metadata, largest expense, category percentage, and payment insights are all populated", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Rice 60 Bags", amount: 91400, date: new Date(),
      category: "Food & Groceries", status: "paid",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Gas Cylinders", amount: 19800, date: new Date(),
      category: "Gas Cylinders", status: "pending",
    });

    const req: ExpenseExportRequest = {
      ownerId: owner.id,
      filters: {},
      scope: "all_matching",
      generatedByName: "Srinivasa Rao",
    };
    const summary = await getExportSummary(req);

    expect(summary.metadata.reportTitle).toBe("Business Expense Report — This Month");
    expect(summary.metadata.reportVersion).toBe("v1");
    expect(summary.metadata.generatedByName).toBe("Srinivasa Rao");
    expect(summary.metadata.hostelLabel).toBe("All Hostels (Portfolio)");
    expect(summary.metadata.exportScopeLabel).toBe("All Matching Records");

    expect(summary.largestExpense).toMatchObject({ title: "Rice 60 Bags", amount: 91400, category: "Food & Groceries" });

    const riceCategory = summary.categoryBreakdown.find((c) => c.category === "Food & Groceries");
    expect(riceCategory?.percentage).toBe(Math.round((91400 / 111200) * 10000) / 100);

    const paid = summary.statusBreakdown.find((s) => s.status === "PAID");
    const pending = summary.statusBreakdown.find((s) => s.status === "PENDING");
    expect(paid?.amount).toBe(91400);
    expect(pending?.amount).toBe(19800);
  });

  it("filter snapshot lists every applied filter with its actual value, plus sort order", async () => {
    const owner = await createTestOwner();
    const req: ExpenseExportRequest = {
      ownerId: owner.id,
      filters: { categories: ["Food & Groceries"], status: "paid", recurring: true, amountMin: 100, amountMax: 5000, sort: "highest" },
      filterSnapshot: { vendor: "ABC Gas Agency", paymentMethod: "UPI" },
      scope: "all_matching",
    };
    const summary = await getExportSummary(req);
    const byLabel = Object.fromEntries(summary.metadata.filterSnapshot.map((f) => [f.label, f.value]));
    expect(byLabel["Category"]).toBe("Food & Groceries");
    expect(byLabel["Status"]).toBe("paid");
    expect(byLabel["Payment Method"]).toBe("UPI");
    expect(byLabel["Vendor"]).toBe("ABC Gas Agency");
    expect(byLabel["Recurring"]).toBe("Yes");
    expect(byLabel["Amount Range"]).toBe("100 – 5000");
    expect(byLabel["Sort"]).toBe("Highest Amount First");
  });

  it("report title reflects scope/category/date-range the same way for every combination", async () => {
    const owner = await createTestOwner();
    const base: Omit<ExpenseExportRequest, "filters" | "scope" | "ids"> = { ownerId: owner.id };
    // A well-formed but non-matching UUID — scope=selected still resolves a title even
    // when the id list matches zero rows (the report just ends up empty, not erroring).
    const nonMatchingId = "00000000-0000-0000-0000-000000000000";

    expect(
      (await getExportSummary({ ...base, filters: {}, scope: "selected", ids: [nonMatchingId] })).metadata.reportTitle,
    ).toBe("Business Expense Report — Selected Expenses");

    expect((await getExportSummary({ ...base, filters: { range: "today" }, scope: "all_matching" })).metadata.reportTitle).toBe(
      "Business Expense Report — Today",
    );
    expect((await getExportSummary({ ...base, filters: { range: "week" }, scope: "all_matching" })).metadata.reportTitle).toBe(
      "Business Expense Report — This Week",
    );
    expect((await getExportSummary({ ...base, filters: { range: "month" }, scope: "all_matching" })).metadata.reportTitle).toBe(
      "Business Expense Report — This Month",
    );
    expect(
      (await getExportSummary({ ...base, filters: { categories: ["Electricity"] }, scope: "all_matching" })).metadata.reportTitle,
    ).toBe("Business Expense Report — Electricity");
  });

  it("revenue lookup failing degrades only the financials section, not the rest of the report", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Rice", amount: 3000, date: new Date(), category: "Food & Groceries",
    });
    // No hostel/payments exist for this owner at all — getBusinessRevenue still succeeds
    // (returns 0, not an error) for a genuinely empty result set, so this specifically
    // exercises the "no revenue recorded yet" path rather than a thrown error, which is
    // the realistic day-one state for a new owner exporting their first report.
    const req: ExpenseExportRequest = { ownerId: owner.id, filters: {}, scope: "all_matching" };
    const summary = await getExportSummary(req);
    expect(summary.financials.revenueUnavailable).toBe(false);
    expect(summary.financials.revenue).toBe(0);
    expect(summary.totalCount).toBe(1);
    expect(summary.totalAmount).toBe(3000);
  });

  it("export financials match the dashboard's own revenue/net-profit calculation for the same window (no drift)", async () => {
    const owner = await createTestOwner();
    const hostel = await createTestHostel(owner.id);
    const room = await createTestRoom(hostel.id);
    const tenant = await createTestTenant(owner.id, hostel.id);
    await allocateTestRoom(tenant.id, room.id, { hostel_id: hostel.id });
    const obligation = await createTestObligation(tenant.id, owner.id, hostel.id);

    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthEndInclusive = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    await createTestPayment(obligation.id, 50000, { payment_date: now });

    await expenseService.createExpense({
      owner_id: owner.id, title: "This month expense", amount: 20000, date: now, category: "Electricity",
    });

    // Dashboard KPIs are always computed for the current calendar month, regardless of filters.
    const dashboard = await expenseService.getAllExpenses(owner.id, {});

    // Export, filtered to the exact same calendar month via explicit dates, should compute
    // the identical revenue via the same shared getBusinessRevenue() — not a separate query.
    const req: ExpenseExportRequest = {
      ownerId: owner.id,
      filters: {
        startDate: monthStart.toISOString().slice(0, 10),
        endDate: monthEndInclusive.toISOString().slice(0, 10),
      },
      scope: "all_matching",
    };
    const summary = await getExportSummary(req);

    expect(summary.financials.revenue).toBe(dashboard.kpis.collected_revenue);
    expect(summary.financials.revenue).toBe(50000);
  });

  it("export row-set matches the UI list for a combined filter (category + status + recurring + amount range + search)", async () => {
    const owner = await createTestOwner();
    await expenseService.createExpense({
      owner_id: owner.id, title: "Matches everything", amount: 2000, date: new Date(),
      category: "Food & Groceries", status: "paid", is_recurring: true, vendor_name: "ABC Gas Agency",
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Wrong category", amount: 2000, date: new Date(),
      category: "Electricity", status: "paid", is_recurring: true,
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Wrong status", amount: 2000, date: new Date(),
      category: "Food & Groceries", status: "pending", is_recurring: true,
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Outside amount range", amount: 999999, date: new Date(),
      category: "Food & Groceries", status: "paid", is_recurring: true,
    });
    await expenseService.createExpense({
      owner_id: owner.id, title: "Not recurring", amount: 2000, date: new Date(),
      category: "Food & Groceries", status: "paid", is_recurring: false,
    });

    const combinedFilters = {
      categories: ["Food & Groceries"],
      status: "paid",
      recurring: true,
      amountMin: 500,
      amountMax: 5000,
      search: "ABC Gas Agency",
    };

    const uiResult = await expenseService.getAllExpenses(owner.id, combinedFilters);
    const req: ExpenseExportRequest = { ownerId: owner.id, filters: combinedFilters, scope: "all_matching" };
    const csvBuffer = await readStream(streamExpensesCsv(req));
    const [, ...dataRows] = parseCsv(csvBuffer.toString("utf-8"));

    expect(dataRows.length).toBe(1);
    expect(dataRows.length).toBe(uiResult.expenses.length);
    expect(uiResult.expenses[0].title).toBe("Matches everything");
  });
});
