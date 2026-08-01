import crypto from "crypto";

export const CSRF_COOKIE_NAME = "hms_csrf";
export const CSRF_HEADER_NAME = "x-csrf-token";

export function generateCsrfToken() {
  return crypto.randomBytes(32).toString("hex");
}

function sharedCookieDomain() {
  const explicit = String(process.env.COOKIE_DOMAIN || "").trim();
  if (explicit) return explicit;

  const frontend = process.env.NEXT_PUBLIC_FRONTEND_URL || process.env.FRONTEND_URL;
  const backend =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXT_PUBLIC_API_URL ||
    process.env.API_URL ||
    process.env.BACKEND_URL;
  if (!frontend || !backend) return undefined;

  try {
    const frontendHost = new URL(frontend).hostname;
    const backendHost = new URL(backend).hostname;
    if (
      frontendHost === "localhost" ||
      backendHost === "localhost" ||
      frontendHost.endsWith(".vercel.app") ||
      backendHost.endsWith(".vercel.app")
    ) {
      return undefined;
    }
    const frontendParts = frontendHost.split(".");
    const backendParts = backendHost.split(".");
    const frontendRoot = frontendParts.slice(-2).join(".");
    const backendRoot = backendParts.slice(-2).join(".");
    if (frontendRoot && frontendRoot === backendRoot) return `.${frontendRoot}`;
  } catch {
    return undefined;
  }

  return undefined;
}

/**
 * `isSecureRequest` overrides the NODE_ENV guess. A `Secure` cookie sent over
 * plain http is silently discarded by the browser, which leaves the client
 * holding a CSRF header with no matching cookie and fails every unsafe request
 * with no way to recover — the "Security check failed" an owner saw when
 * sending an invitation from a production build served over http.
 */
export function getCsrfCookieOptions(maxAge: number, options: { isSecureRequest?: boolean } = {}) {
  const isProd = process.env.NODE_ENV === "production";
  const domain = sharedCookieDomain();
  return {
    httpOnly: false,
    secure: options.isSecureRequest ?? isProd,
    sameSite: "lax" as const,
    maxAge,
    path: "/",
    ...(domain ? { domain } : {}),
  };
}

export function setCsrfCookie(
  response: { cookies: { set: Function }; headers?: { set: Function } },
  maxAge: number,
  options: { isSecureRequest?: boolean } = {},
) {
  const token = generateCsrfToken();
  response.cookies.set(CSRF_COOKIE_NAME, token, getCsrfCookieOptions(maxAge, options));
  response.headers?.set(CSRF_HEADER_NAME, token);
}

export function clearCsrfCookie(response: { cookies: { set: Function } }) {
  const options = getCsrfCookieOptions(0);
  response.cookies.set(CSRF_COOKIE_NAME, "", {
    ...options,
    expires: new Date(0),
  });
}

export function isUnsafeMethod(method: string) {
  return ["POST", "PUT", "PATCH", "DELETE"].includes(method.toUpperCase());
}

export function isValidCsrfPair(cookieToken?: string | null, headerToken?: string | null) {
  if (!cookieToken || !headerToken) return false;
  if (cookieToken.length < 32 || headerToken.length < 32) return false;
  const cookieBuffer = Buffer.from(cookieToken);
  const headerBuffer = Buffer.from(headerToken);
  if (cookieBuffer.length !== headerBuffer.length) return false;
  return crypto.timingSafeEqual(cookieBuffer, headerBuffer);
}


/**
 * Every `hms_csrf` value in a Cookie header.
 *
 * A browser can legitimately hold more than one: a host-only cookie plus a
 * `Domain=.example.com` one left behind by an earlier deploy configuration.
 * Both are sent, and reading only the first meant comparing against a token the
 * client had never seen — a permanent 403 for that browser until its cookies
 * were cleared.
 */
export function csrfCookieValues(cookieHeader?: string | null): string[] {
  if (!cookieHeader) return [];
  return String(cookieHeader)
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${CSRF_COOKIE_NAME}=`))
    .map((part) => part.slice(CSRF_COOKIE_NAME.length + 1))
    .filter(Boolean);
}

/**
 * Double-submit check tolerant of duplicate cookies: the header must match one
 * of the tokens this browser actually sent.
 *
 * This does not weaken the guarantee. Double-submit rests on a cross-site
 * attacker being unable to *read* or *set* the header; which of our own cookies
 * it matches is immaterial, and every candidate here was issued by us.
 */
export function matchesAnyCsrfCookie(cookieHeader: string | null | undefined, headerToken?: string | null): boolean {
  if (!headerToken) return false;
  return csrfCookieValues(cookieHeader).some((cookieToken) => isValidCsrfPair(cookieToken, headerToken));
}
