/**
 * Who signed, from where, on what, and when.
 *
 * PURE MODULE — no Prisma, no pdf-lib, no I/O.
 *
 * Lifted out of `agreement-generation-service` so the document composer can
 * stamp the same details the PDF prints without importing the PDF service,
 * which imports the composer in turn. The tenant's reader and the generated
 * PDF must agree on this: an audit trail that differs between the copy someone
 * read and the copy that was filed is worse than none.
 */

export function sanitizeIp(ip: string | null | undefined): string {
  if (!ip || ip === "unknown") return "N/A";
  if (ip.includes(",")) {
    return ip.split(",")[0].trim();
  }
  return ip.trim();
}

export function parseUserAgent(ua: string | null | undefined): { device: string; os: string; browser: string } {
  if (!ua || ua === "unknown" || ua === "N/A") {
    return { device: "Unknown Device", os: "Unknown OS", browser: "Unknown Browser" };
  }

  let device = "Desktop";
  let os = "Unknown OS";
  let browser = "Unknown Browser";

  const uaLower = ua.toLowerCase();

  // Detect Device Type
  if (/mobi|android|iphone|ipad|ipod|blackberry|iemobile|opera mini/i.test(uaLower)) {
    if (/ipad|tablet/i.test(uaLower)) {
      device = "Tablet";
    } else {
      device = "Mobile";
    }
  }

  // Detect OS
  if (/android/i.test(uaLower)) {
    os = "Android";
    const match = ua.match(/Android\s+([0-9\.]+)/i);
    if (match) os += ` ${match[1]}`;
  } else if (/iphone|ipad|ipod/i.test(uaLower)) {
    os = "iOS";
    const match = ua.match(/OS\s+([0-9_]+)/i);
    if (match) os += ` ${match[1].replace(/_/g, ".")}`;
  } else if (/windows/i.test(uaLower)) {
    os = "Windows";
    if (/phone/i.test(uaLower)) os = "Windows Phone";
  } else if (/macintosh|mac os x/i.test(uaLower)) {
    os = "macOS";
  } else if (/linux/i.test(uaLower)) {
    os = "Linux";
  }

  // Detect Browser
  if (/edg/i.test(uaLower)) {
    browser = "Edge";
  } else if (/chrome|crios/i.test(uaLower)) {
    browser = "Chrome";
  } else if (/safari/i.test(uaLower)) {
    browser = "Safari";
  } else if (/firefox|fxios/i.test(uaLower)) {
    browser = "Firefox";
  } else if (/opr/i.test(uaLower)) {
    browser = "Opera";
  }

  return { device, os, browser };
}

/** "Mobile (Android 14, Chrome)" — one line, as the PDF prints it. */
export function describeDevice(userAgent: string | null | undefined): string {
  const { device, os, browser } = parseUserAgent(userAgent);
  return `${device} (${os}, ${browser})`;
}
