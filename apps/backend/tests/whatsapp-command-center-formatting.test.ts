import { describe, expect, it } from "vitest";
import { formatRentSummary, type RentSummaryInput } from "@/lib/services/notifications/command-center/rent-summary";
import {
  formatInstalmentPlan,
  type InstalmentRow,
} from "@/lib/services/notifications/command-center/installment-plan";
import {
  formatLastReceipt,
  formatNoPayments,
  formatPaymentConfirmation,
  formatReceiptDelivery,
  formatReceiptUnavailable,
} from "@/lib/services/notifications/command-center/receipt";
import { possessive, rupees, shortDate } from "@/lib/services/notifications/command-center/voice";

const subject = { name: "Aarav Sharma", hostelName: "Sunrise Residency", roomNo: "204" };

const rent = (over: Partial<RentSummaryInput> = {}): RentSummaryInput => ({
  audience: "RESIDENT",
  subject,
  payableNow: 8000,
  overdueAmount: 0,
  lateFeesDue: 0,
  overdueDays: 0,
  components: [{ label: "Rent — August 2026", amount: 8000, dueDate: "2026-08-05", overdueDays: 0 }],
  nextDue: null,
  instalment: null,
  fullySettled: false,
  ...over,
});

describe("voice", () => {
  it("formats money in Indian grouping, without paise", () => {
    expect(rupees(8000)).toBe("₹8,000");
    expect(rupees(124500)).toBe("₹1,24,500");
    expect(rupees(0)).toBe("₹0");
  });

  it("returns null rather than the string N/A for a missing date", () => {
    // `@/lib/format` yields "N/A" on null; nothing readable may ever print it.
    expect(shortDate(null)).toBeNull();
    expect(shortDate(undefined)).toBeNull();
    expect(shortDate("not a date")).toBeNull();
    expect(shortDate("2026-08-05")).toContain("2026");
  });

  it("speaks to a resident in the second person and about a resident in the third", () => {
    expect(possessive("RESIDENT", subject)).toBe("your");
    expect(possessive("GUARDIAN", subject)).toBe("Aarav Sharma's");
    expect(possessive("GUARDIAN", { ...subject, name: "Anders" })).toBe("Anders'");
  });
});

describe("RENT summary", () => {
  it("never says 'your rent' to a guardian", () => {
    const text = formatRentSummary(rent({ audience: "GUARDIAN", overdueAmount: 8000, overdueDays: 12 }));
    expect(text).not.toContain("Your rent");
    expect(text).toContain("Aarav Sharma's rent is *overdue*");
  });

  it("names the hostel — the authority anchor on every money message", () => {
    const text = formatRentSummary(rent({ audience: "GUARDIAN" }));
    expect(text).toContain("Sunrise Residency");
    // ...and signs off as the hostel, never as "HMS".
    expect(text).toContain("— Sunrise Residency, via Stayo");
    expect(text).not.toContain("HMS");
  });

  it("states one payable number, and itemises it whenever it is a sum", () => {
    const text = formatRentSummary(
      rent({
        payableNow: 24000,
        components: [
          { label: "Rent — June 2026", amount: 8000, dueDate: "2026-06-05", overdueDays: 70 },
          { label: "Rent — July 2026", amount: 8000, dueDate: "2026-07-05", overdueDays: 40 },
          { label: "Rent — August 2026", amount: 8000, dueDate: "2026-08-05", overdueDays: 10 },
        ],
        overdueAmount: 24000,
        overdueDays: 70,
      })
    );

    expect(text).toContain("*₹24,000* — 70 days late");
    expect(text).toContain("Rent — June 2026 — ₹8,000");
    expect(text).toContain("Rent — August 2026 — ₹8,000");
  });

  it("does not itemise a single component — there is nothing to reconcile", () => {
    const text = formatRentSummary(rent());
    expect(text).toContain("*₹8,000* due");
    expect(text).not.toContain("• Rent");
  });

  it("surfaces a late fee rather than burying it in the total", () => {
    const text = formatRentSummary(rent({ payableNow: 8400, lateFeesDue: 400, overdueAmount: 8400, overdueDays: 12 }));
    expect(text).toContain("Includes ₹400 late fee");
  });

  it("shows instalment position, which no message used to", () => {
    const text = formatRentSummary(rent({ instalment: { sequence: 3, total: 12 } }));
    expect(text).toContain("Instalment 3 of 12");
  });

  it("drops the vanity metrics the old balance wall carried", () => {
    const text = formatRentSummary(rent({ instalment: { sequence: 3, total: 12 } }));
    expect(text).not.toContain("█");        // the paid ÷ billed progress bar
    expect(text).not.toContain("░");
    expect(text).not.toContain("Lifetime"); // irrelevant to paying today
    expect(text).not.toContain("━━");       // four wasted lines per screen
  });

  it("says plainly when nothing is due, without inventing a next bill", () => {
    const text = formatRentSummary(rent({ payableNow: 0, components: [] }));
    expect(text).toContain("Nothing is due right now.");
    expect(text).not.toContain("N/A");
  });

  it("reports a fully settled account as settled", () => {
    const text = formatRentSummary(rent({ payableNow: 0, components: [], fullySettled: true, audience: "GUARDIAN" }));
    expect(text).toContain("fully settled");
  });

  it("agrees its units with its numbers", () => {
    const oneDay = formatRentSummary(rent({ overdueAmount: 8000, overdueDays: 1 }));
    expect(oneDay).toContain("1 day late");
    expect(oneDay).not.toContain("1 days");
  });
});

describe("PLAN — instalment progress", () => {
  const row = (over: Partial<InstalmentRow>): InstalmentRow => ({
    sequence: 1,
    label: "April 2026",
    amount: 8000,
    paid: 8000,
    outstanding: 0,
    dueDate: "2026-04-05",
    state: "PAID",
    overdueDays: 0,
    ...over,
  });

  it("shows position, money and state for each instalment", () => {
    const text = formatInstalmentPlan({
      audience: "GUARDIAN",
      subject,
      rows: [
        row({ sequence: 1 }),
        row({ sequence: 2, label: "May 2026", state: "OVERDUE", paid: 0, outstanding: 8000, overdueDays: 12 }),
        row({ sequence: 3, label: "June 2026", state: "UPCOMING", paid: 0, outstanding: 8000, dueDate: "2026-06-05" }),
      ],
      totalInstalments: 12,
      totalContractAmount: 96000,
      totalPaid: 8000,
    });

    expect(text).toContain("Instalment plan · 12 instalments");
    expect(text).toContain("*1/12*");
    expect(text).toContain("Paid");
    expect(text).toContain("₹8,000 due — 12 days late");
    expect(text).toContain("Paid so far: *₹8,000* of ₹96,000");
    expect(text).toContain("Remaining: 2 instalments");
  });

  it("keeps the open instalments in view when the plan is too long to print", () => {
    const rows: InstalmentRow[] = Array.from({ length: 24 }, (_, i) =>
      row({
        sequence: i + 1,
        label: `Month ${i + 1}`,
        state: i < 20 ? "PAID" : "UPCOMING",
        paid: i < 20 ? 8000 : 0,
        outstanding: i < 20 ? 0 : 8000,
      })
    );

    const text = formatInstalmentPlan({
      audience: "GUARDIAN",
      subject,
      rows,
      totalInstalments: 24,
      totalContractAmount: 192000,
      totalPaid: 160000,
    });

    // Every still-open instalment must appear — those are the ones with money on them.
    for (const n of [21, 22, 23, 24]) {
      expect(text, `instalment ${n}`).toContain(`*${n}/24*`);
    }
    // ...and the elision is stated, not silent.
    expect(text).toMatch(/earlier instalments? paid and settled/);
  });

  it("acknowledges the whole history when everything is paid", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row({ sequence: i + 1, label: `Month ${i + 1}` }));
    const text = formatInstalmentPlan({
      audience: "RESIDENT",
      subject,
      rows,
      totalInstalments: 12,
      totalContractAmount: 96000,
      totalPaid: 96000,
    });

    expect(text).toContain("All instalments settled.");
  });

  it("says so plainly when no schedule exists yet", () => {
    const text = formatInstalmentPlan({
      audience: "GUARDIAN",
      subject,
      rows: [],
      totalInstalments: null,
      totalContractAmount: null,
      totalPaid: 0,
    });

    expect(text).toContain("No instalment schedule has been raised yet");
    expect(text).not.toContain("N/A");
  });
});

describe("RECEIPT and payment confirmation", () => {
  const payment = {
    amount: 8000,
    paidOn: "2026-08-05",
    towards: "Rent — August 2026",
    reference: "RCPT-2026-00412",
    receiptUrl: null,
    method: "UPI",
  };

  it("states the payment, what it was for, and where it leaves them", () => {
    const text = formatLastReceipt({
      audience: "GUARDIAN",
      subject,
      payment,
      totalPaid: 24000,
      stillDue: 8000,
    });

    expect(text).toContain("*₹8,000* received on");
    expect(text).toContain("Towards: Rent — August 2026");
    expect(text).toContain("Reference: RCPT-2026-00412");
    expect(text).toContain("Still due: *₹8,000*");
  });

  it("points a guardian with no payments at what to do next, not at a dead end", () => {
    const text = formatLastReceipt({
      audience: "GUARDIAN",
      subject,
      payment: null,
      totalPaid: 0,
      stillDue: 8000,
    });

    expect(text).toContain("Aarav Sharma's account");
    expect(text).toContain("Send PAY");
  });

  it("thanks, then states the new position — the message the old flow never sent", () => {
    const text = formatPaymentConfirmation({
      audience: "GUARDIAN",
      subject,
      payment,
      totalPaid: 24000,
      stillDue: 0,
    });

    expect(text).toContain("Payment received — thank you.");
    expect(text).toContain("Aarav Sharma is fully paid up");
  });

  it("does not claim settlement when money is still owed", () => {
    const text = formatPaymentConfirmation({
      audience: "RESIDENT",
      subject,
      payment,
      totalPaid: 16000,
      stillDue: 8000,
    });

    expect(text).toContain("Still due: *₹8,000*");
    expect(text).not.toContain("fully paid up");
  });
});

describe("receipt delivery", () => {
  const payment = {
    amount: 8000,
    paidOn: "2026-08-05",
    towards: "Rent — August 2026",
    reference: "RCPT-2026-00412",
    receiptUrl: null,
    method: "UPI",
  };

  it("says which receipt is attached, so two are tellable apart later", () => {
    const text = formatReceiptDelivery({
      audience: "GUARDIAN",
      subject,
      payment,
      receiptNumber: "RCPT-2026-00412",
    });

    expect(text).toContain("Receipt *RCPT-2026-00412*");
    expect(text).toContain("₹8,000 received on");
    expect(text).toContain("Towards: Rent — August 2026");
    expect(text).toContain("Method: UPI");
    expect(text).toContain("— Sunrise Residency, via Stayo");
  });

  it("stays inside WhatsApp's document-caption ceiling", () => {
    const text = formatReceiptDelivery({
      audience: "GUARDIAN",
      subject,
      payment,
      receiptNumber: "RCPT-2026-00412",
    });
    // The caption rides on the document itself; Meta caps it at 1024.
    expect(text.length).toBeLessThanOrEqual(1024);
  });

  it("names the payment when the document cannot be produced", () => {
    // Naming it is the only thing that helps — the reader can quote it.
    const text = formatReceiptUnavailable({ audience: "GUARDIAN", subject, payment });

    expect(text).toContain("could not be produced");
    expect(text).toContain("₹8,000");
    expect(text).toContain("Rent — August 2026");
    expect(text).toContain("quote this payment to the hostel");
    expect(text.toLowerCase()).not.toContain("sorry");
  });

  it("tells a guardian with no payments in the third person", () => {
    const text = formatNoPayments({ audience: "GUARDIAN", subject });
    expect(text).toContain("Aarav Sharma's account");
    expect(text).toContain("Send *PAY*");
  });

  it("tells a resident the same thing in the second person", () => {
    const text = formatNoPayments({ audience: "RESIDENT", subject });
    expect(text).toContain("your account");
  });
});
