/**
 * The UPI payment instruction, as a string.
 *
 * **PURE MODULE — no I/O.** This is the entire payment mechanism now that the
 * gateway is disconnected: there is no provider to validate anything, no
 * callback to tell us a payment failed, and no server-side record that the
 * tenant ever opened their UPI app. A malformed intent produces a QR that fails
 * *inside the tenant's phone*, where nobody on our side can see it, and the
 * tenant reasonably concludes Stayo is broken.
 *
 * So every rule about what a UPI intent may say lives here, with no database
 * anywhere near it, and is tested directly — the same reason the export period
 * rules live in their own pure module.
 *
 * Format is NPCI's UPI deep-link scheme:
 *
 *     upi://pay?pa=<vpa>&pn=<payee>&am=<rupees>&cu=INR&tn=<note>
 *
 * See `docs/superpowers/specs/2026-09-23-upi-collection-gateway-disconnect-design.md`.
 */

/** Longest payee name / note most UPI apps display without mangling. */
const MAX_DISPLAY = 50;

/**
 * A UPI handle is `name@handle` — and specifically NOT an email address.
 *
 * Owners paste email addresses into this field constantly, and `owner@gmail.com`
 * is indistinguishable from a VPA by shape alone except that real UPI handles
 * carry no dot. Rejecting the dotted handle is what stops rent being addressed
 * to nobody.
 */
const VPA_PATTERN = /^[a-zA-Z0-9](?:[a-zA-Z0-9._-]*[a-zA-Z0-9])?@[a-zA-Z][a-zA-Z0-9]*$/;

export function isValidVpa(vpa: string): boolean {
  if (typeof vpa !== "string" || !vpa) return false;
  // A VPA that needs trimming is a VPA that was pasted; validate what was
  // actually given rather than silently repairing it, so the owner fixes it.
  if (vpa !== vpa.trim()) return false;
  return VPA_PATTERN.test(vpa);
}

/**
 * Integer paise as the decimal rupee string UPI expects.
 *
 * Never locale-formatted: `toLocaleString` would insert the Indian digit
 * grouping, and a comma inside `am=` silently truncates the amount.
 */
export function formatUpiAmount(amountPaise: number): string {
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    throw new Error("VALIDATION: A UPI amount must be a positive number of paise");
  }
  return (Math.round(amountPaise) / 100).toFixed(2);
}

/** Strip what breaks the URI or the app's display, then clamp. */
function cleanDisplayText(raw: string): string {
  return String(raw ?? "")
    // `&` and `=` would be read as further URI parameters; `#` truncates the
    // rest of the string; the others are simply mangled by common apps.
    .replace(/[&=#?%+<>"'\\/]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_DISPLAY)
    .trim();
}

/** The transaction note, e.g. "Rent Sept 2026". May legitimately be empty. */
export function sanitiseUpiNote(raw: string): string {
  return cleanDisplayText(raw);
}

/**
 * Who the tenant sees they are paying.
 *
 * The HOSTEL name, never the owner's personal name: "Sri Adithya Boys Hostel"
 * is what the tenant recognises, and an unfamiliar individual's name appearing
 * in a UPI confirmation screen reads like a scam — which is exactly when a
 * tenant abandons the payment.
 */
export function upiPayeeName(hostelName: string): string {
  return cleanDisplayText(hostelName) || "Hostel";
}

export type UpiIntent = {
  vpa: string;
  payeeName: string;
  /** Integer paise, or null for an open QR the tenant fills in themselves. */
  amountPaise: number | null;
  note?: string;
};

/**
 * The `upi://pay` URI, for both the QR image and the tap-to-pay link.
 *
 * Parameter order is fixed so the same input always yields the same string: a
 * cached QR image and the link rendered beside it must not be able to disagree.
 *
 * Throws rather than returning a partial URI. A half-formed intent becomes a QR
 * that fails where nobody can observe it; an exception fails here, where the
 * owner can be told their UPI ID is wrong.
 */
export function buildUpiUri(intent: UpiIntent): string {
  if (!isValidVpa(intent.vpa)) {
    throw new Error("VALIDATION: A valid UPI ID (name@handle) is required");
  }

  const parts: string[] = [
    `pa=${encodeURIComponent(intent.vpa)}`,
    `pn=${encodeURIComponent(upiPayeeName(intent.payeeName))}`,
  ];

  // An absent amount is an open QR, which is legitimate. A zero amount is not —
  // it would present as a fixed ₹0 request.
  if (intent.amountPaise !== null && intent.amountPaise !== undefined) {
    parts.push(`am=${formatUpiAmount(intent.amountPaise)}`);
  }

  parts.push("cu=INR");

  const note = sanitiseUpiNote(intent.note ?? "");
  if (note) parts.push(`tn=${encodeURIComponent(note)}`);

  return `upi://pay?${parts.join("&")}`;
}
