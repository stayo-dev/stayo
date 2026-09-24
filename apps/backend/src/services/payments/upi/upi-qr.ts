import QRCode from "qrcode";
import { buildUpiUri, type UpiIntent } from "./upi-intent";

/**
 * The UPI QR, as inline SVG.
 *
 * SVG rather than a PNG data URI because the page this lands on
 * (`app/api/payments/pay/[token]/route.ts`) is deliberately framework-free,
 * server-rendered HTML: inline SVG needs no extra request, no client library,
 * and stays sharp on every screen density. `qrcode` is already a dependency —
 * four PDF and agreement modules use it — so this adds nothing to the bundle.
 *
 * **The QR is rendered on every platform, always.** It is the only mechanism
 * that works everywhere: iOS has no UPI app chooser, desktop cannot open
 * `upi://` at all, and in-app browsers (WhatsApp, Instagram — the primary way
 * tenants arrive here) routinely block custom schemes. The page cannot detect
 * any of those failures, so the fallback must already be on screen rather than
 * offered after something goes wrong.
 *
 * Error correction is deliberately HIGH: this QR gets scanned off a cracked
 * phone screen, at an angle, in a hostel corridor.
 */

export type UpiQrOptions = {
  /** Rendered edge length in px. The page scales it with CSS regardless. */
  size?: number;
};

const DEFAULT_SIZE = 240;

/**
 * Inline `<svg>` encoding the UPI intent.
 *
 * Throws when the intent cannot be built — a QR encoding a malformed VPA is
 * worse than no QR, because it fails inside the tenant's app where nobody can
 * see it and it looks like Stayo took the money.
 */
export async function renderUpiQrSvg(
  intent: UpiIntent,
  options: UpiQrOptions = {},
): Promise<{ svg: string; uri: string }> {
  const uri = buildUpiUri(intent);

  const svg = await QRCode.toString(uri, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 1,
    width: options.size ?? DEFAULT_SIZE,
  });

  return { svg, uri };
}

/**
 * Per-app deep links, for iOS.
 *
 * Android resolves `upi://pay` through the system intent chooser and needs
 * none of this. iOS has no such chooser and does not reliably claim `upi://`,
 * so the only way to reach an app there is its own scheme. This list is
 * therefore an iOS workaround, not a feature — and it is best-effort: if the
 * app is not installed the link silently does nothing, which is exactly why
 * the QR is always rendered alongside.
 */
export function upiAppLinks(uri: string): { label: string; href: string }[] {
  const query = uri.replace(/^upi:\/\/pay\?/, "");
  return [
    { label: "Google Pay", href: `gpay://upi/pay?${query}` },
    { label: "PhonePe", href: `phonepe://pay?${query}` },
    { label: "Paytm", href: `paytmmp://pay?${query}` },
  ];
}
