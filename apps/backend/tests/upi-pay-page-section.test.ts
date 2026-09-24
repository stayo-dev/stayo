import { describe, it, expect } from "vitest";
import {
  esc,
  renderUpiPanel,
  renderClaimForm,
  upiClientScript,
} from "@/app/api/payments/pay/[token]/upi-section";

/**
 * The markup on `/pay/{token}` — the page tenants actually reach from a
 * WhatsApp rent reminder.
 *
 * It is server-rendered, framework-free HTML built by string concatenation, so
 * escaping is a real correctness concern rather than a framework's problem:
 * hostel and tenant names are interpolated straight into it.
 *
 * Pure: strings in, strings out. No database.
 */

const panel = {
  qrSvg: "<svg><rect/></svg>",
  uri: "upi://pay?pa=adithya%40okhdfcbank&pn=Sri%20Adithya&am=8500.00&cu=INR",
  appLinks: [
    { label: "Google Pay", href: "gpay://upi/pay?pa=adithya%40okhdfcbank" },
    { label: "PhonePe", href: "phonepe://pay?pa=adithya%40okhdfcbank" },
  ],
  hostelName: "Sri Adithya Boys Hostel",
};

describe("esc", () => {
  it("neutralises markup in a name", () => {
    expect(esc(`<script>alert(1)</script>`)).toBe(
      "&lt;script&gt;alert(1)&lt;/script&gt;",
    );
  });

  it("escapes quotes, because names land inside attributes", () => {
    expect(esc(`a" onload="x`)).toBe("a&quot; onload=&quot;x");
  });

  it("renders null and undefined as nothing, not as the words", () => {
    expect(esc(null)).toBe("");
    expect(esc(undefined)).toBe("");
  });
});

describe("renderUpiPanel", () => {
  it("always renders the QR, not only as a fallback", () => {
    // iOS has no UPI chooser, desktop cannot open upi://, and in-app browsers
    // block custom schemes — none of which this page can detect.
    const html = renderUpiPanel(panel);
    expect(html).toContain("<svg>");
    expect(html).toContain("upi-qr");
  });

  it("offers the intent link and the per-app iOS fallbacks together", () => {
    const html = renderUpiPanel(panel);
    expect(html).toContain("upi://pay?pa=adithya%40okhdfcbank");
    expect(html).toContain("gpay://upi/pay");
    expect(html).toContain("phonepe://pay");
  });

  it("escapes the hostel name where it is shown to the payer", () => {
    const html = renderUpiPanel({ ...panel, hostelName: '<img src=x onerror=1>' });
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });

  it("says so plainly when the hostel has no UPI ID", () => {
    // Not an edge case: 0 of 6 production hostels had one set when this
    // shipped. A broken QR would read as Stayo being broken.
    const html = renderUpiPanel({ ...panel, qrSvg: null, uri: null });
    expect(html).toContain("isn't set up yet");
    expect(html).not.toContain("upi-qr\"");
  });

  it("still lets an unconfigured hostel's tenant record a payment", () => {
    // They pay directly as they always have; the claim is what marks it paid.
    const html = renderUpiPanel({ ...panel, qrSvg: null, uri: null });
    expect(html).toMatch(/record it below/i);
  });

  it("offers a phone number to call when one is known", () => {
    const html = renderUpiPanel({ ...panel, qrSvg: null, uri: null, supportPhone: "+919876543210" });
    expect(html).toContain('href="tel:+919876543210"');
  });
});

describe("renderClaimForm", () => {
  it("requires the reference and makes the screenshot optional", () => {
    const html = renderClaimForm("Sri Adithya Boys Hostel");
    expect(html).toContain("UPI reference number");
    expect(html).toMatch(/Screenshot \(optional\)/);
  });

  it("explains why the reference matters, not just that it is needed", () => {
    // The UTR is the only part the owner can match against a bank statement.
    const html = renderClaimForm("Sri Adithya Boys Hostel");
    expect(html).toMatch(/bank statement/i);
  });

  it("never promises the rent is paid on submission alone", () => {
    // A claim is evidence, not money. Saying "paid" here would be a lie the
    // owner then has to walk back.
    const html = renderClaimForm("Sri Adithya Boys Hostel");
    expect(html).toMatch(/once .* confirms/i);
  });

  it("escapes the hostel name", () => {
    const html = renderClaimForm('<b>X</b>');
    expect(html).not.toContain("<b>X</b>");
  });
});

describe("upiClientScript", () => {
  it("embeds the token safely, as JSON rather than raw interpolation", () => {
    const script = upiClientScript('a"); alert(1); //');
    expect(script).toContain(JSON.stringify('a"); alert(1); //'));
    expect(script).not.toContain('var tokenValue = a");');
  });

  it("keeps the QR in step with the amount box", () => {
    // A tenant who edits the amount then scans a stale QR pays the wrong sum,
    // and with no gateway there is no callback to catch it.
    const script = upiClientScript("t");
    expect(script).toContain("refreshQr");
    expect(script).toContain("'qr'");
  });

  it("posts the claim rather than navigating away", () => {
    const script = upiClientScript("t");
    expect(script).toContain("'claim'");
    expect(script).toContain("preventDefault");
  });

  it("refuses an oversized screenshot before uploading it", () => {
    // Vercel functions cap the request body at 4.5 MB.
    const script = upiClientScript("t");
    expect(script).toContain("3 * 1024 * 1024");
  });

  it("loads no gateway script", () => {
    const script = upiClientScript("t");
    expect(script).not.toMatch(/razorpay|checkout\.js/i);
  });
});
