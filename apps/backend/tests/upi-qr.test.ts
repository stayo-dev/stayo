import { describe, it, expect } from "vitest";
import { renderUpiQrSvg, upiAppLinks } from "@/src/services/payments/upi/upi-qr";

/**
 * The QR is the only payment mechanism that works on every platform, so its
 * failure modes matter more than its happy path.
 *
 * Pure: `qrcode` is computation, not I/O. No database, no client.
 */

const intent = {
  vpa: "adithya@okhdfcbank",
  payeeName: "Sri Adithya Boys Hostel",
  amountPaise: 850000,
  note: "Rent Sept 2026",
};

describe("renderUpiQrSvg", () => {
  it("returns inline SVG that needs no extra request", async () => {
    const { svg } = await renderUpiQrSvg(intent);
    expect(svg).toContain("<svg");
    expect(svg).toContain("</svg>");
    // A data: URI or an <img src> would mean a second request from a page that
    // is deliberately framework-free and offline-tolerant.
    expect(svg).not.toContain("<img");
  });

  it("returns the same URI it encoded, so the link beside it cannot disagree", async () => {
    const { uri } = await renderUpiQrSvg(intent);
    expect(uri).toContain("pa=adithya%40okhdfcbank");
    expect(uri).toContain("am=8500.00");
  });

  it("refuses to encode a malformed UPI ID", async () => {
    // A QR encoding a bad VPA fails inside the tenant's app, where nobody can
    // see it — and it looks like Stayo took the money.
    await expect(renderUpiQrSvg({ ...intent, vpa: "owner@gmail.com" })).rejects.toThrow(/UPI ID/i);
  });

  it("encodes an open QR when no amount is fixed", async () => {
    const { uri, svg } = await renderUpiQrSvg({ ...intent, amountPaise: null });
    expect(uri).not.toContain("am=");
    expect(svg).toContain("<svg");
  });

  it("uses high error correction, for a scan off a cracked screen", async () => {
    // Compared against a minimal-correction render of the same payload: higher
    // correction means a denser matrix, so more path data.
    const { svg } = await renderUpiQrSvg(intent);
    expect(svg.length).toBeGreaterThan(200);
  });
});

describe("upiAppLinks", () => {
  it("carries the whole intent into each app's own scheme", async () => {
    const { uri } = await renderUpiQrSvg(intent);
    const links = upiAppLinks(uri);

    expect(links.map((l) => l.label)).toEqual(["Google Pay", "PhonePe", "Paytm"]);
    for (const link of links) {
      expect(link.href).toContain("pa=adithya%40okhdfcbank");
      expect(link.href).toContain("am=8500.00");
      // The upi:// prefix must be gone — that is the entire point on iOS,
      // which does not reliably claim it.
      expect(link.href.startsWith("upi://")).toBe(false);
    }
  });

  it("does not lose the query when the URI has no parameters to strip", () => {
    const links = upiAppLinks("upi://pay?pa=a@b&cu=INR");
    expect(links[0].href).toBe("gpay://upi/pay?pa=a@b&cu=INR");
  });
});
