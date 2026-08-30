import { readFileSync } from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  buildReceiptContent,
  joinParts,
  methodLabel,
  monogramFor,
  rupees,
  settlementLabel,
  type ReceiptContentInput,
} from "@/lib/pdf/receipt-content";

const base = (over: Partial<ReceiptContentInput> = {}): ReceiptContentInput => ({
  hostel_name: "Shoeb's Mansion",
  hostel_address: null,
  hostel_city: "Hyderabad",
  hostel_state: "Telangana",
  hostel_pincode: "500032",
  hostel_phone: "+91 99638 23824",
  hostel_gst: null,
  receipt_number: "SAH-2026-00001",
  issued_at_display: "26 Aug 2026",
  payment_date_display: "26 Aug 2026",
  payment_method: "CASH",
  transaction_id: null,
  reference_number: null,
  tenant_name: "B. Vineeth",
  tenant_phone: "+91 94922 54188",
  tenant_email: "vineeth@example.com",
  room_no: "102",
  room_floor: "1",
  settlement_allocations: [
    { type: "SECURITY_DEPOSIT", label: "Security Deposit", allocated: 16000, rent_month_display: null },
  ],
  future_credit_allocated: 0,
  total_transaction_paid: 16000,
  outstanding_balance_after: 82500,
  future_credit_balance_after: 0,
  verification_url: "https://yourstayo.com/verify/receipt?t=abc",
  footer: null,
  ...over,
});

describe("money and text primitives", () => {
  it("prints a real rupee sign, never 'Rs.'", () => {
    // The old template rewrote ₹ to "Rs. " because pdf-lib's standard fonts
    // are WinAnsi and cannot encode it. The renderer embeds Inter instead.
    expect(rupees(16000)).toBe("₹16,000");
    expect(rupees(16000)).not.toContain("Rs");
    expect(rupees(124500)).toBe("₹1,24,500");
    expect(rupees(0)).toBe("₹0");
  });

  it("joins only the parts that exist", () => {
    // The receipt in production read ", Hyderabad" — an empty street line
    // joined to a city.
    expect(joinParts([null, "Hyderabad", "Telangana"])).toBe("Hyderabad, Telangana");
    expect(joinParts(["", "  ", null, undefined])).toBe("");
    expect(joinParts(["Room 102", "Floor 1"], " · ")).toBe("Room 102 · Floor 1");
  });

  it("builds a monogram from whatever the hostel is called", () => {
    expect(monogramFor("Shoeb's Mansion")).toBe("SM");
    expect(monogramFor("Sunrise Residency Boys Hostel")).toBe("SRB");
    expect(monogramFor("")).toBe("H");
  });

  it("says the payment method the way a person would", () => {
    expect(methodLabel("CASH")).toBe("Cash");
    expect(methodLabel("NET_BANKING")).toBe("Net banking");
    expect(methodLabel("razorpay")).toBe("Online");
    expect(methodLabel(null)).toBeNull();
  });
});

describe("settlement lines speak plainly", () => {
  it("translates obligation types out of engine vocabulary", () => {
    expect(settlementLabel("SECURITY_DEPOSIT", "Security Deposit", null)).toBe("Security deposit");
    expect(settlementLabel("MAINTENANCE", "x", null)).toBe("Maintenance");
    expect(settlementLabel("LATE_FEE", "x", null)).toBe("Late fee");
    expect(settlementLabel("RENT", "x", "June 2026")).toBe("Rent — June 2026");
    expect(settlementLabel("RENT", "x", null)).toBe("Rent");
  });

  it("heads the section with a question the reader has", () => {
    // Not "SETTLEMENT BREAKDOWN" / "ALLOCATED AMOUNT" — internal wording that
    // the financial read model is explicit must not reach a reader.
    const content = buildReceiptContent(base());
    expect(content.settlementHeading).toBe("What this payment settled");
    expect(JSON.stringify(content)).not.toContain("ALLOCATED");
    expect(JSON.stringify(content)).not.toMatch(/allocation/i);
  });

  it("drops allocations worth nothing", () => {
    const content = buildReceiptContent(
      base({
        settlement_allocations: [
          { type: "RENT", label: "Rent", allocated: 8500, rent_month_display: "June 2026" },
          { type: "MAINTENANCE", label: "Maintenance", allocated: 0, rent_month_display: null },
        ],
      })
    );
    expect(content.settlement.map((line) => line.label)).toEqual(["Rent — June 2026"]);
  });

  it("explains money that was received but not yet owed", () => {
    const content = buildReceiptContent(base({ future_credit_allocated: 4500 }));
    const credit = content.settlement.find((line) => line.label.includes("credit"));
    expect(credit?.amount).toBe("₹4,500");
    // Without the note, a credit reads as an unexplained gap in the sum.
    expect(credit?.note).toBe("Applied automatically to your next bill");
  });
});

describe("fields that do not apply are removed, not printed as N/A", () => {
  it("omits the transaction id on a cash payment", () => {
    // The production receipt printed "TRANSACTION ID: N/A" for cash.
    const content = buildReceiptContent(base({ payment_method: "CASH", transaction_id: null }));
    const labels = content.meta.map((entry) => entry.label);
    expect(labels).toEqual(["Issued", "Paid on", "Method"]);
    expect(JSON.stringify(content.meta)).not.toContain("N/A");
  });

  it("shows the transaction id and reference when a payment has them", () => {
    const content = buildReceiptContent(
      base({ payment_method: "UPI", transaction_id: "pay_Q1", reference_number: "UTR-9" })
    );
    expect(content.meta.map((entry) => entry.label)).toContain("Transaction ID");
    expect(content.meta.map((entry) => entry.label)).toContain("Reference");
  });

  it("treats a literal 'N/A' from upstream as absent", () => {
    const content = buildReceiptContent(base({ transaction_id: "N/A" }));
    expect(content.meta.map((entry) => entry.label)).not.toContain("Transaction ID");
  });

  it("omits a zero outstanding balance and a zero credit", () => {
    const settled = buildReceiptContent(
      base({ outstanding_balance_after: 0, future_credit_balance_after: 0 })
    );
    expect(settled.position).toEqual([]);

    const both = buildReceiptContent(
      base({ outstanding_balance_after: 82500, future_credit_balance_after: 4500 })
    );
    expect(both.position.map((entry) => entry.label)).toEqual(["Still outstanding", "Credit in hand"]);
  });
});

describe("branding: the hostel issues it, Stayo carries it", () => {
  it("takes the issuer entirely from data", () => {
    const content = buildReceiptContent(base({ hostel_name: "Sunrise Residency" }));
    expect(content.issuerName).toBe("Sunrise Residency");
    expect(content.footerLeft).toBe("Sunrise Residency · +91 99638 23824");
  });

  it("attributes the platform without displacing the hostel", () => {
    const content = buildReceiptContent(base());
    expect(content.footerRight).toBe("Powered by Stayo");
    expect(content.footerLeft.startsWith("Shoeb's Mansion")).toBe(true);
  });

  it("carries no retired identity, whatever the input", () => {
    // `scripts/check-production-branding.mjs` forbids these, but only ever
    // scanned apps/frontend/dist — which is how they survived on every receipt
    // this backend issued. Pinned here so the source itself stays clean.
    const sources = ["lib/pdf/receipt-content.ts", "lib/pdf/receipt-template-pdf-lib.ts"].map((file) =>
      readFileSync(path.resolve(__dirname, "..", file), "utf8")
    );

    for (const source of sources) {
      expect(source).not.toMatch(/Sri\s*Sunrise/i);
      expect(source).not.toMatch(/examplehostel/i);
      expect(source).not.toMatch(/stayo\.app/i);
      expect(source).not.toMatch(/spchidiri2006/i);
    }

    // And nothing survives into the rendered content either.
    const content = JSON.stringify(buildReceiptContent(base({ hostel_name: "" })));
    expect(content).not.toMatch(/Sri\s*Sunrise/i);
    expect(content).not.toContain("HMS");
  });

  it("speaks to the reader, not to an engineer, about verification", () => {
    const content = buildReceiptContent(base());
    expect(content.verifyNote).toBe("Scan to confirm this receipt is genuine");
    expect(JSON.stringify(content)).not.toContain("HMAC");
    // The template version was printed on the face of the old receipt.
    expect(JSON.stringify(content)).not.toMatch(/v\d+\.\d+\.\d+/);
  });
});
