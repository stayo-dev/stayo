import { describe, expect, it } from "vitest";
import {
  buildSubscriptionInvoiceContent,
  formatInvoiceDate,
  formatPaiseInr,
  paymentMethodLabel,
  type SubscriptionInvoiceContentInput,
} from "@/lib/pdf/subscription-invoice-content";

const BASE: SubscriptionInvoiceContentInput = {
  invoiceNumber: "SUB-2026-A1B2C3D4E5",
  issuedAt: new Date("2026-09-10T08:30:00.000Z"),
  billingName: "Ravi Kumar",
  billingEmail: "ravi@example.com",
  billingPhone: "+919876543210",
  billingAddress: "12 MG Road, Bengaluru, Karnataka, 560001",
  planName: "Growth",
  billingPeriodStart: new Date("2026-09-10T00:00:00.000Z"),
  billingPeriodEnd: new Date("2026-10-10T00:00:00.000Z"),
  amountPaise: 249900,
  planAmountPaise: 249900,
  taxPaise: 0,
  currency: "INR",
  paymentMethod: "UPI_MANUAL",
  transactionReference: "UPI-2299-8890",
};

describe("formatPaiseInr — integer paise, Indian grouping", () => {
  it.each([
    [0, "₹0.00"],
    [149900, "₹1,499.00"],
    [200000, "₹2,000.00"],
    [249900, "₹2,499.00"],
    [799900, "₹7,999.00"],
    [4499900, "₹44,999.00"],
    [10000000, "₹1,00,000.00"],
    [12345678, "₹1,23,456.78"],
    [1, "₹0.01"],
  ])("%d paise → %s", (paise, expected) => {
    expect(formatPaiseInr(paise)).toBe(expected);
  });

  it("never produces a floating-point artefact", () => {
    // 0.1 + 0.2 style drift is impossible here — paise are split by integer div/mod.
    expect(formatPaiseInr(10)).toBe("₹0.10");
    expect(formatPaiseInr(99)).toBe("₹0.99");
    expect(formatPaiseInr(100)).toBe("₹1.00");
  });
});

describe("formatInvoiceDate", () => {
  it("renders a UTC date, no time", () => {
    expect(formatInvoiceDate(new Date("2026-09-10T23:59:00.000Z"))).toBe("10 September 2026");
  });
  it("handles a bare ISO string", () => {
    expect(formatInvoiceDate("2026-01-01")).toBe("1 January 2026");
  });
});

describe("paymentMethodLabel", () => {
  it("labels the supported methods and stays future-ready for GATEWAY", () => {
    expect(paymentMethodLabel("UPI_MANUAL")).toBe("UPI");
    expect(paymentMethodLabel("CASH")).toBe("Cash");
    expect(paymentMethodLabel("GATEWAY")).toBe("Online payment");
  });
});

describe("buildSubscriptionInvoiceContent", () => {
  it("carries the backend invoice number verbatim — never mints one", () => {
    const c = buildSubscriptionInvoiceContent(BASE);
    expect(c.invoiceNumber).toBe("SUB-2026-A1B2C3D4E5");
  });

  it("uses the stored paise values and totals them with integer arithmetic", () => {
    const c = buildSubscriptionInvoiceContent(BASE);
    expect(c.amountPaise).toBe(249900);
    expect(c.taxPaise).toBe(0);
    expect(c.totalPaise).toBe(249900);
    expect(c.summary.subtotal.value).toBe("₹2,499.00");
    expect(c.summary.total.value).toBe("₹2,499.00");
  });

  it("tax is always ₹0.00 and never labelled or implied as GST", () => {
    const c = buildSubscriptionInvoiceContent(BASE);
    expect(c.summary.tax.value).toBe("₹0.00");
    expect(c.summary.tax.label).toBe("Tax");

    const blob = JSON.stringify(c).toLowerCase();
    expect(blob).not.toContain("gst");
    expect(blob).not.toContain("gstin");
    expect(blob).not.toContain("18%");
    expect(blob).not.toContain("tax invoice");
    expect(blob).not.toContain("cgst");
    expect(blob).not.toContain("sgst");
  });

  it("includes the transaction reference when present", () => {
    const c = buildSubscriptionInvoiceContent(BASE);
    expect(c.payment.transactionReference).toBe("UPI-2299-8890");
  });

  it("omits the transaction reference when absent (e.g. cash)", () => {
    const c = buildSubscriptionInvoiceContent({
      ...BASE,
      paymentMethod: "CASH",
      transactionReference: null,
    });
    expect(c.payment.transactionReference).toBeNull();
    expect(c.payment.methodLabel).toBe("Cash");
  });

  it("renders a prorated upgrade amount exactly as stored (no recompute)", () => {
    const c = buildSubscriptionInvoiceContent({ ...BASE, planName: "Professional", amountPaise: 133733 });
    expect(c.amountPaise).toBe(133733);
    expect(c.summary.total.value).toBe("₹1,337.33");
  });

  it("falls back gracefully when billing identity is thin", () => {
    const c = buildSubscriptionInvoiceContent({
      ...BASE,
      billingName: null,
      billingEmail: null,
      billingPhone: null,
      billingAddress: null,
      planName: null,
    });
    expect(c.billTo.name).toBe("Account holder");
    expect(c.billTo.email).toBeNull();
    expect(c.subscription.planName).toBe("Stayo subscription");
  });

  it("has the Stayo subscription-invoice header", () => {
    const c = buildSubscriptionInvoiceContent(BASE);
    expect(c.brandName).toBe("Stayo");
    expect(c.docTitle).toBe("Subscription Invoice");
  });

  describe("extra-bed breakdown (Phase 6.6)", () => {
    it("no extra beds: summary.extraBeds is null, summary.plan equals the total", () => {
      const c = buildSubscriptionInvoiceContent(BASE);
      expect(c.summary.extraBeds).toBeNull();
      expect(c.summary.plan.value).toBe("₹2,499.00");
      expect(c.subscription.extraBedsLabel).toBeNull();
    });

    it("shows plan + extra-bed amounts separately and they reconcile to the total", () => {
      const c = buildSubscriptionInvoiceContent({
        ...BASE,
        amountPaise: 259900, // 249900 plan + 10000 (10 beds @ ₹10)
        planAmountPaise: 249900,
        extraBeds: 10,
        extraBedUnitPricePaise: 1000,
        extraBedAmountPaise: 10000,
      });
      expect(c.summary.plan.value).toBe("₹2,499.00");
      expect(c.summary.extraBeds).not.toBeNull();
      expect(c.summary.extraBeds!.value).toBe("₹100.00");
      expect(c.summary.subtotal.value).toBe("₹2,599.00");
      expect(c.summary.total.value).toBe("₹2,599.00");
      expect(c.subscription.extraBedsLabel).toBe("10 extra beds @ ₹10.00/bed");
    });

    it("a snapshotted unit price is used verbatim, never recomputed from a live plan", () => {
      // Even if the "current" plan price were different, the content builder
      // only ever sees what's passed in — the invoice's own stored snapshot.
      const c = buildSubscriptionInvoiceContent({
        ...BASE,
        amountPaise: 269900,
        planAmountPaise: 249900,
        extraBeds: 4,
        extraBedUnitPricePaise: 5000, // a historical/unusual snapshot, not ₹10
        extraBedAmountPaise: 20000,
      });
      expect(c.subscription.extraBedsLabel).toBe("4 extra beds @ ₹50.00/bed");
      expect(c.summary.extraBeds!.value).toBe("₹200.00");
    });

    it("singular label for exactly 1 extra bed", () => {
      const c = buildSubscriptionInvoiceContent({
        ...BASE,
        amountPaise: 259900,
        planAmountPaise: 249900,
        extraBeds: 1,
        extraBedUnitPricePaise: 1000,
        extraBedAmountPaise: 1000,
      });
      expect(c.subscription.extraBedsLabel).toBe("1 extra bed @ ₹10.00/bed");
    });
  });
});
